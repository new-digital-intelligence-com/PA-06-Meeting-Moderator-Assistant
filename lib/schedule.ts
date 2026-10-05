/**
 * Her schedule, by client: the meetings on her calendar, copied into Supabase so each
 * client can see theirs and prepare her for them.
 *
 * Her calendar is shared by every client — one Ava, one Google account — so each invite
 * is given to a client by its organiser (lib/clients.ts). An invite from nobody's company
 * is "skipped": she does not go, and admins see it listed.
 */
import { asMeeting, db, isoNow, rows, type Client, type MeetingRow, type Prep } from "./db";
import { allClients, matchClient } from "./clients";
import type { GoogleClient } from "./google";
import { redisOrMongoKey } from "./store";
import { avaInvites, type Invite } from "./workspace";

const DAYS_AHEAD = 14;
const PAGE = 250;
const SYNCED = "calendar:synced";

type Raw = Record<string, unknown>;
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();

/**
 * Reads her calendar and brings the meetings table up to date with it — through
 * "pa-06".sync_meetings() (db/schema.sql), which adds and updates in one go, keeps a
 * finished meeting finished, and marks what has gone from her calendar as cancelled.
 */
export async function syncCalendar(google: GoogleClient): Promise<{ invites: Invite[]; meetings: MeetingRow[]; clients: Client[] }> {
  const [invites, clients] = await Promise.all([avaInvites(google, DAYS_AHEAD * 24, PAGE), allClients()]);
  const found = invites.map((i) => {
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

  const synced = await rows<Raw[]>(
    db().rpc("sync_meetings", {
      p_rows: found,
      p_seen: invites.map((i) => i.id),
      // Gone from her calendar — cancelled, or she was taken off the invite. Only when the
      // whole window was read: a cut-off list would cancel what it did not reach.
      p_complete: invites.length < PAGE,
      p_days: DAYS_AHEAD,
    }),
  );
  const meetings = synced.map(asMeeting).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
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
  const found = await rows<Raw[]>(
    db()
      .from("meetings")
      .select("*")
      .eq("client_id", clientId)
      .neq("status", "cancelled")
      .gt("starts_at", daysAgo(30))
      .order("starts_at"),
  );
  return found.map(asMeeting);
}

export async function clientMeeting(clientId: string, id: string): Promise<MeetingRow | null> {
  const m = await rows<Raw | null>(db().from("meetings").select("*").eq("id", id).eq("client_id", clientId).maybeSingle());
  return m ? asMeeting(m) : null;
}

/** Invites she got from organisers who are nobody's client — for admins. */
export async function skippedInvites(): Promise<MeetingRow[]> {
  const found = await rows<Raw[]>(
    db()
      .from("meetings")
      .select("*")
      .eq("status", "skipped")
      .gt("starts_at", daysAgo(7))
      .order("starts_at", { ascending: false })
      .limit(50),
  );
  return found.map(asMeeting);
}

export function cleanPrep(input: unknown): Prep {
  const o = (input ?? {}) as Record<string, unknown>;
  const field = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 8_000) : "");
  return { goal: field("goal"), agenda: field("agenda"), people: field("people"), avoid: field("avoid"), notes: field("notes") };
}

export async function savePrep(clientId: string, id: string, prep: Prep): Promise<MeetingRow | null> {
  const now = isoNow();
  const m = await rows<Raw | null>(
    db().from("meetings").update({ prep, prep_at: now, updated_at: now }).eq("id", id).eq("client_id", clientId).select("*").maybeSingle(),
  );
  return m ? asMeeting(m) : null;
}

/** The notes she wrote after a client's meeting, kept with it so the client can read them back. */
export async function saveNotes(
  meetingId: string,
  notes: { to?: string; subject?: string; body?: string; summary?: string; sentAt?: number; actions?: unknown[] },
): Promise<void> {
  const current = await rows<{ notes: Raw | null; ended_at: string | null } | null>(
    db().from("meetings").select("notes, ended_at").eq("id", meetingId).maybeSingle(),
  );
  if (!current) return;
  const now = isoNow();
  await rows(
    db()
      .from("meetings")
      .update({
        // Added to what is there: the write-up first, then when it was sent.
        notes: { ...(current.notes ?? {}), ...JSON.parse(JSON.stringify(notes)) },
        status: "ended",
        ended_at: current.ended_at ?? now,
        updated_at: now,
      })
      .eq("id", meetingId),
  );
}
