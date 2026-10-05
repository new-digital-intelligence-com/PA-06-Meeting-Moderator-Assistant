/**
 * Her schedule, by client: the meetings on her calendar, copied into Postgres so each
 * client can see theirs and prepare her for them.
 *
 * Her calendar is shared by every client — one Ava, one Google account — so each invite
 * is given to a client by its organiser (lib/clients.ts). An invite from nobody's company
 * is "skipped": she does not go, and admins see it listed.
 */
import { db, type Client, type MeetingRow, type Prep } from "./db";
import { matchClient } from "./clients";
import type { GoogleClient } from "./google";
import { redisOrMongoKey } from "./store";
import { avaInvites, type Invite } from "./workspace";

const DAYS_AHEAD = 14;
const PAGE = 250;
const SYNCED = "calendar:synced";

/** Reads her calendar and brings the meetings table up to date with it. */
export async function syncCalendar(google: GoogleClient): Promise<{ invites: Invite[]; meetings: MeetingRow[]; clients: Client[] }> {
  const [invites, clients] = await Promise.all([avaInvites(google, DAYS_AHEAD * 24, PAGE), db()<Client[]>`select * from clients`]);
  const rows = invites.map((i) => {
    // A paused client's meetings stay theirs, marked paused: she skips them, they keep their preparation.
    const client = matchClient(clients, i.organizerEmail, true);
    return {
      client_id: client?.id ?? null,
      event_id: i.id,
      title: i.title.slice(0, 300),
      starts_at: new Date(i.start).toISOString(),
      ends_at: new Date(i.end).toISOString(),
      meeting_url: i.meetingUrl,
      organizer: i.organizerEmail || null,
      organizer_name: i.organizer && i.organizer !== i.organizerEmail ? i.organizer : null,
      guests: i.guests,
      description: i.description.slice(0, 20_000),
      status: !client ? "skipped" : client.status === "active" ? "upcoming" : "paused",
    };
  });

  let meetings: MeetingRow[] = [];
  if (rows.length) {
    meetings = await db()<MeetingRow[]>`
      insert into meetings (client_id, event_id, title, starts_at, ends_at, meeting_url, organizer, organizer_name, guests, description, status)
      select x.client_id, x.event_id, x.title, x.starts_at, x.ends_at, x.meeting_url, x.organizer, x.organizer_name,
        coalesce(x.guests, '[]'::jsonb), x.description, x.status
      from jsonb_to_recordset(${db().json(rows)}::jsonb) as x(
        client_id uuid, event_id text, title text, starts_at timestamptz, ends_at timestamptz, meeting_url text,
        organizer text, organizer_name text, guests jsonb, description text, status text)
      on conflict (event_id) do update set
        client_id = excluded.client_id, title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        meeting_url = excluded.meeting_url, organizer = excluded.organizer, organizer_name = excluded.organizer_name,
        guests = excluded.guests, description = excluded.description,
        status = case when meetings.status = 'ended' then 'ended' else excluded.status end,
        updated_at = now()
      returning *`;
    meetings.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
  }

  // Gone from her calendar — cancelled, or she was taken off the invite. Only when the
  // whole window was read: a cut-off list would cancel what it did not reach.
  if (invites.length < PAGE) {
    await db()`
      update meetings set status = 'cancelled', updated_at = now()
      where status in ('upcoming', 'skipped', 'paused') and starts_at > now() and starts_at < now() + ${`${DAYS_AHEAD} days`}::interval
        and not (event_id = any(${db().array(invites.map((i) => i.id))}::text[]))`;
  }
  await redisOrMongoKey(SYNCED).write(String(Date.now()));
  return { invites, meetings, clients };
}

/** The same, unless it was done in the last `maxAgeMs` — pages call this; her runner syncs every minute anyway. */
export async function syncIfStale(google: GoogleClient, maxAgeMs = 60_000): Promise<void> {
  const last = Number((await redisOrMongoKey(SYNCED).read()) ?? 0);
  if (Date.now() - last < maxAgeMs) return;
  await syncCalendar(google);
}

/* ---------------------------------------------------------------- queries */

/** A client's meetings: the next two weeks, and the last thirty days. */
export async function clientMeetings(clientId: string): Promise<MeetingRow[]> {
  return db()<MeetingRow[]>`
    select * from meetings
    where client_id = ${clientId} and status <> 'cancelled' and starts_at > now() - interval '30 days'
    order by starts_at`;
}

export async function clientMeeting(clientId: string, id: string): Promise<MeetingRow | null> {
  const [m] = await db()<MeetingRow[]>`select * from meetings where id = ${id} and client_id = ${clientId}`;
  return m ?? null;
}

/** Invites she got from organisers who are nobody's client — for admins. */
export async function skippedInvites(): Promise<MeetingRow[]> {
  return db()<MeetingRow[]>`
    select * from meetings where status = 'skipped' and starts_at > now() - interval '7 days' order by starts_at desc limit 50`;
}

export function cleanPrep(input: unknown): Prep {
  const o = (input ?? {}) as Record<string, unknown>;
  const field = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 8_000) : "");
  return { goal: field("goal"), agenda: field("agenda"), people: field("people"), avoid: field("avoid"), notes: field("notes") };
}

export async function savePrep(clientId: string, id: string, prep: Prep): Promise<MeetingRow | null> {
  const [m] = await db()<MeetingRow[]>`
    update meetings set prep = ${db().json(prep)}::jsonb, prep_at = now(), updated_at = now()
    where id = ${id} and client_id = ${clientId} returning *`;
  return m ?? null;
}

/** The notes she wrote after a client's meeting, kept with it so the client can read them back. */
export async function saveNotes(
  meetingId: string,
  notes: { to?: string; subject?: string; body?: string; summary?: string; sentAt?: number; actions?: unknown[] },
): Promise<void> {
  await db()`
    update meetings set notes = coalesce(notes, '{}'::jsonb) || ${db().json(JSON.parse(JSON.stringify(notes)))}::jsonb, status = 'ended',
      ended_at = coalesce(ended_at, now()), updated_at = now()
    where id = ${meetingId}`;
}
