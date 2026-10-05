-- Ava's clients, what she knows about each, and their meetings. Postgres (Supabase), with
-- pgvector for searching a client's documents by meaning.
--
-- Safe to run again: every statement only creates what is missing. Apply it with
--   node db/migrate.mjs            (reads DATABASE_URL from .env.local)
-- or paste it into Supabase's SQL editor.

create extension if not exists vector;

-- A company Ava works for. Invites whose organiser is on one of its domains (or is one of
-- its exact addresses, for personal accounts) are its meetings.
create table if not exists clients (
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
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by text
);

-- People who can sign in to a client's portal. One client per address.
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  email text not null unique,
  name text,
  role text not null default 'owner',
  invited_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Meetings on Ava's calendar, one row per occurrence. client_id is null for invites from
-- somebody who is not a client: she skips those, and admin lists them.
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
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
create index if not exists meetings_client_starts on meetings (client_id, starts_at);

-- A document, a link or a Drive file a client gave Ava. meeting_id set: only for that
-- meeting's preparation.
create table if not exists knowledge (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  meeting_id uuid references meetings(id) on delete cascade,
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
create index if not exists knowledge_client on knowledge (client_id, created_at desc);

-- The passages Ava searches during a meeting (text-embedding-3-small: 1536 dimensions).
create table if not exists chunks (
  id bigserial primary key,
  knowledge_id uuid not null references knowledge(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  meeting_id uuid references meetings(id) on delete cascade,
  position integer not null,
  content text not null,
  embedding vector(1536) not null
);
create index if not exists chunks_client on chunks (client_id);
create index if not exists chunks_embedding on chunks using hnsw (embedding vector_cosine_ops);

-- Sign-in links sent by email: only a hash is kept, each works once.
create table if not exists login_tokens (
  hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- NDI is client number one, so meetings NDI people invite her to keep working.
insert into clients (name, domains, created_by)
select 'NDI', array['new-digital-intelligence.com'], 'setup'
where not exists (select 1 from clients where 'new-digital-intelligence.com' = any(domains));
