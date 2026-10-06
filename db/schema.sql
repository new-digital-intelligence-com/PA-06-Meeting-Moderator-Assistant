-- Ava's clients, what she knows about each, and their meetings — in the team's shared
-- Supabase project ("pocs"), all in her own schema, "pa-06". Nothing outside it is
-- created or changed, except switching pgvector on if nobody has yet.
--
-- Paste all of it into Supabase's SQL editor and run it. It is safe to run again.
-- Then: Project Settings → Data API → Exposed schemas → add pa-06 → Save.
--
-- The app reaches it through the Data API with the project's secret key, from the server
-- only. The browser roles (anon, authenticated) get nothing here.

begin;
-- Finds pgvector wherever it is installed (public or extensions).
set local search_path to public, extensions;

-- pgvector, for searching documents by meaning. Does nothing if it is already on.
create extension if not exists vector with schema extensions;

create schema if not exists "pa-06";

-- A company Ava works for. Invites whose organiser is on one of its domains (or is one of
-- its exact addresses, for personal accounts) are its meetings.
create table if not exists "pa-06".clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domains text[] not null default '{}',
  addresses text[] not null default '{}',
  -- Standing instructions from the client: who they are, their tone, what to avoid.
  instructions text not null default '',
  -- What Ava took from all their documents, rewritten as each one arrives.
  digest text not null default '',
  digest_at timestamptz,
  -- Their folder in NDI's shared drive, where the original files are kept.
  drive_folder_id text,
  -- Their company's logo, on Cloudinary.
  logo_url text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by text
);
-- For a schema made before logos: the only line it needs.
alter table "pa-06".clients add column if not exists logo_url text;

-- People who can sign in to a client's portal. One client per address.
create table if not exists "pa-06".members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references "pa-06".clients(id) on delete cascade,
  email text not null unique,
  name text,
  role text not null default 'owner',
  invited_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Meetings on Ava's calendar, one row per occurrence. client_id is null for invites from
-- somebody who is not a client: she skips those, and admin lists them.
create table if not exists "pa-06".meetings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references "pa-06".clients(id) on delete cascade,
  event_id text not null unique,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  meeting_url text,
  organizer text,
  organizer_name text,
  guests jsonb not null default '[]',
  description text not null default '',
  status text not null default 'upcoming',
  -- The client's preparation: goal, agenda, people, avoid, notes.
  prep jsonb not null default '{}',
  prep_at timestamptz,
  -- Ava's brief for this meeting, written from the prep, the invite and the knowledge.
  brief text,
  brief_at timestamptz,
  -- After the meeting: the summary email, actions and summary.
  notes jsonb,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_client_starts on "pa-06".meetings (client_id, starts_at);

-- A document, a link or a Drive file a client gave Ava. meeting_id set: only for that
-- meeting's preparation.
create table if not exists "pa-06".knowledge (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references "pa-06".clients(id) on delete cascade,
  meeting_id uuid references "pa-06".meetings(id) on delete cascade,
  kind text not null,
  title text not null,
  mime text,
  source text,
  drive_file_id text,
  status text not null default 'processing',
  error text,
  chars integer not null default 0,
  summary text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists knowledge_client on "pa-06".knowledge (client_id, created_at desc);

-- The passages Ava searches during a meeting (text-embedding-3-small: 1536 dimensions).
create table if not exists "pa-06".chunks (
  id bigserial primary key,
  knowledge_id uuid not null references "pa-06".knowledge(id) on delete cascade,
  client_id uuid not null references "pa-06".clients(id) on delete cascade,
  meeting_id uuid references "pa-06".meetings(id) on delete cascade,
  position integer not null,
  content text not null,
  embedding vector(1536) not null
);
create index if not exists chunks_client on "pa-06".chunks (client_id);
create index if not exists chunks_embedding on "pa-06".chunks using hnsw (embedding vector_cosine_ops);

-- Sign-in links sent by email: only a hash is kept, each works once.
create table if not exists "pa-06".login_tokens (
  hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Her search: the passages closest in meaning to a question, from one client's documents
-- and one meeting's own. The app calls it as rpc("match_chunks").
create or replace function "pa-06".match_chunks(
  query_embedding vector(1536),
  p_client uuid,
  p_meeting uuid default null,
  match_count int default 6
)
returns table (title text, content text, score double precision, meeting boolean)
language plpgsql
set search_path = "pa-06", public, extensions
as $$
begin
  -- The index finds the nearest passages of every client first and filters after:
  -- looking at more of them keeps a small client's passages in the running.
  perform set_config('hnsw.ef_search', '200', true);
  return query
    select k.title, c.content, 1 - (c.embedding <=> query_embedding), c.meeting_id is not null
    from "pa-06".chunks c
    join "pa-06".knowledge k on k.id = c.knowledge_id
    where c.client_id = p_client and (c.meeting_id is null or c.meeting_id = p_meeting)
    order by c.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- Her calendar copied in: new invites added, changed ones updated (a finished meeting
-- stays finished) and — when her whole calendar was read (p_complete) — meetings gone
-- from it marked cancelled. Returns the meetings it was given. rpc("sync_meetings").
create or replace function "pa-06".sync_meetings(p_rows jsonb, p_seen text[], p_complete boolean, p_days int)
returns setof "pa-06".meetings
language plpgsql
set search_path = "pa-06", public
as $$
begin
  return query
    with synced as (
      insert into "pa-06".meetings as m
        (client_id, event_id, title, starts_at, ends_at, meeting_url, organizer, organizer_name, guests, description, status)
      select x.client_id, x.event_id, x.title, x.starts_at, x.ends_at, x.meeting_url, x.organizer, x.organizer_name,
        coalesce(x.guests, '[]'::jsonb), x.description, x.status
      from jsonb_to_recordset(p_rows) as x(
        client_id uuid, event_id text, title text, starts_at timestamptz, ends_at timestamptz, meeting_url text,
        organizer text, organizer_name text, guests jsonb, description text, status text)
      on conflict (event_id) do update set
        client_id = excluded.client_id, title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        meeting_url = excluded.meeting_url, organizer = excluded.organizer, organizer_name = excluded.organizer_name,
        guests = excluded.guests, description = excluded.description,
        status = case when m.status = 'ended' then 'ended' else excluded.status end,
        updated_at = now()
      returning m.*
    )
    select * from synced;

  if p_complete then
    update "pa-06".meetings x
    set status = 'cancelled', updated_at = now()
    where x.status in ('upcoming', 'skipped', 'paused')
      and x.starts_at > now() and x.starts_at < now() + make_interval(days => p_days)
      and not (x.event_id = any(p_seen));
  end if;
end;
$$;

-- The admin page's numbers for every client. rpc("client_summaries").
create or replace function "pa-06".client_summaries()
returns table (id uuid, members int, documents int, upcoming int, last_meeting timestamptz)
language sql
stable
set search_path = "pa-06", public
as $$
  select c.id,
    (select count(*)::int from "pa-06".members m where m.client_id = c.id),
    (select count(*)::int from "pa-06".knowledge k where k.client_id = c.id and k.meeting_id is null),
    (select count(*)::int from "pa-06".meetings x where x.client_id = c.id and x.starts_at > now() and x.status <> 'cancelled'),
    (select max(x.starts_at) from "pa-06".meetings x where x.client_id = c.id and x.starts_at <= now() and x.status <> 'cancelled')
  from "pa-06".clients c
$$;

-- Only the server's key gets in. Row security on, with no policies, shuts the browser
-- roles out; the secret key's role (service_role) is not bound by it.
alter table "pa-06".clients enable row level security;
alter table "pa-06".members enable row level security;
alter table "pa-06".meetings enable row level security;
alter table "pa-06".knowledge enable row level security;
alter table "pa-06".chunks enable row level security;
alter table "pa-06".login_tokens enable row level security;

revoke all on schema "pa-06" from public;
revoke execute on all functions in schema "pa-06" from public;
grant usage on schema "pa-06" to service_role;
grant all on all tables in schema "pa-06" to service_role;
grant all on all sequences in schema "pa-06" to service_role;
grant execute on all functions in schema "pa-06" to service_role;
-- The same for whatever is added to the schema later.
alter default privileges in schema "pa-06" grant all on tables to service_role;
alter default privileges in schema "pa-06" grant all on sequences to service_role;
alter default privileges in schema "pa-06" grant execute on functions to service_role;

-- NDI is client number one, so meetings NDI people invite her to keep working.
insert into "pa-06".clients (name, domains, created_by)
select 'NDI', array['new-digital-intelligence.com'], 'setup'
where not exists (select 1 from "pa-06".clients where 'new-digital-intelligence.com' = any(domains));

commit;

-- The Data API reads the new schema now rather than in a moment.
notify pgrst, 'reload schema';
