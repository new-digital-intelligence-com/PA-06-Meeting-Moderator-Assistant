/**
 * Her schedule, by client: the meetings on her calendar, copied into Supabase so each
 * client can see theirs and prepare her for them.
 *
 * Her calendar is shared by every client — one Ava, one Google account — so each invite
 * is given to a client by its organiser (lib/clients.ts). An invite from nobody's company
 * is "skipped": she does not go, and admins see it listed.
 */
import { asMeeting, db, isoNow, rows, type Client, type MeetingRow, type Prep } from "./db";
import { allClients, clientPeople, matchClient } from "./clients";
import type { GoogleClient } from "./google";
import { changeKey, record, type HistoryEntry, type HistoryKind } from "./history";
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
  const [invites, clients, people] = await Promise.all([avaInvites(google, DAYS_AHEAD * 24, PAGE), allClients(), clientPeople()]);
  const found = invites.map((i) => {
    // A paused client's meetings stay theirs, marked paused: she skips them, they keep their preparation.
    const client = matchClient(clients, people, i.organizerEmail, true);
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

  // What the table says about the same stretch of time, to tell what the host changed.
  const known = await rows<Raw[]>(
    db()
      .from("meetings")
      .select("id, event_id, title, starts_at, ends_at, meeting_url, guests, description, status, organizer")
      .gte("starts_at", new Date(Date.now() - 3 * 60 * 60_000).toISOString())
      .lte("starts_at", new Date(Date.now() + (DAYS_AHEAD + 1) * 24 * 60 * 60_000).toISOString())
      .not("event_id", "like", "now-%"),
  ).catch(() => null);

  const complete = invites.length < PAGE;
  const synced = await rows<Raw[]>(
    db().rpc("sync_meetings", {
      p_rows: found,
      p_seen: invites.map((i) => i.id),
      // Gone from her calendar — cancelled, or she was taken off the invite. Only when the
      // whole window was read: a cut-off list would cancel what it did not reach.
      p_complete: complete,
      p_days: DAYS_AHEAD,
    }),
  );
  const meetings = synced.map(asMeeting).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
  if (known) await record(calendarChanges(known, found, meetings, complete));
  await redisOrMongoKey(SYNCED).write(String(Date.now()));
  return { invites, meetings, clients };
}

type Found = { event_id: string; title: string; starts_at: string; ends_at: string; meeting_url: string; organizer: string | null; guests: { email: string; name?: string }[]; description: string; status: string };

/**
 * What changed on her calendar since it was last read, meeting by meeting — the host's
 * doing: new invites, moved, renamed, a new description, guests or link, called off, back.
 */
function calendarChanges(known: Raw[], found: Found[], synced: MeetingRow[], complete: boolean): HistoryEntry[] {
  const before = new Map(known.map((k) => [String(k.event_id), k]));
  const ids = new Map(synced.map((m) => [m.event_id, m.id]));
  const seen = new Set(found.map((f) => f.event_id));
  const time = (v: unknown) => (v ? new Date(String(v)).getTime() : 0);
  const emails = (g: unknown) => new Set(((g as { email: string }[] | null) ?? []).map((x) => x.email.toLowerCase()));
  const out: HistoryEntry[] = [];
  const add = (eventId: string, meetingId: string | undefined, kind: HistoryKind, by: string | null, detail: Record<string, unknown>) => {
    if (meetingId) out.push({ meeting_id: meetingId, kind, by, detail, key: changeKey(eventId, kind, detail) });
  };

  for (const f of found) {
    const old = before.get(f.event_id);
    const id = ids.get(f.event_id) ?? (old?.id as string | undefined);
    const by = f.organizer;
    if (!old) {
      add(f.event_id, id, "invited", by, { title: f.title, starts_at: f.starts_at, ends_at: f.ends_at, guests: f.guests.length });
      continue;
    }
    if (old.status === "cancelled" && f.status !== "cancelled") add(f.event_id, id, "restored", by, { starts_at: f.starts_at });
    if (time(old.starts_at) !== time(f.starts_at) || time(old.ends_at) !== time(f.ends_at)) {
      add(f.event_id, id, "moved", by, { from: { starts_at: old.starts_at, ends_at: old.ends_at }, to: { starts_at: f.starts_at, ends_at: f.ends_at } });
    }
    if (String(old.title ?? "") !== f.title) add(f.event_id, id, "renamed", by, { from: old.title, to: f.title });
    if (String(old.description ?? "") !== f.description) {
      add(f.event_id, id, "described", by, { from: String(old.description ?? "").slice(0, 4000), to: f.description.slice(0, 4000) });
    }
    if (String(old.meeting_url ?? "") !== (f.meeting_url ?? "")) add(f.event_id, id, "link", by, { from: old.meeting_url, to: f.meeting_url });
    const was = emails(old.guests);
    const now = emails(f.guests);
    const added = [...now].filter((e) => !was.has(e));
    const removed = [...was].filter((e) => !now.has(e));
    if (added.length || removed.length) add(f.event_id, id, "guests", by, { added, removed });
  }

  // Called off: gone from a calendar read in full — deleted by the host, or she was taken off it.
  if (complete) {
    for (const old of known) {
      const eventId = String(old.event_id);
      if (seen.has(eventId) || !["upcoming", "skipped", "paused"].includes(String(old.status))) continue;
      if (time(old.starts_at) <= Date.now()) continue;
      add(eventId, old.id as string, "cancelled", (old.organizer as string | null) ?? null, { title: old.title, starts_at: old.starts_at });
    }
  }
  return out;
}

/** The same, unless it was done in the last `maxAgeMs` — pages call this; her runner syncs every minute anyway. */
export async function syncIfStale(google: GoogleClient, maxAgeMs = 60_000): Promise<void> {
  const last = Number((await redisOrMongoKey(SYNCED).read()) ?? 0);
  if (Date.now() - last < maxAgeMs) return;
  await syncCalendar(google);
}

/* ---------------------------------------------------------------- queries */

/**
 * A client's meetings: the next two weeks, and the last thirty days — the called-off ones
 * too, which the page lists apart, with their history.
 */
export async function clientMeetings(clientId: string): Promise<MeetingRow[]> {
  const found = await rows<Raw[]>(
    db()
      .from("meetings")
      .select("*")
      .eq("client_id", clientId)
      .gt("starts_at", daysAgo(30))
      .order("starts_at"),
  );
  return found.map(asMeeting);
}

export async function clientMeeting(clientId: string, id: string): Promise<MeetingRow | null> {
  const m = await rows<Raw | null>(db().from("meetings").select("*").eq("id", id).eq("client_id", clientId).maybeSingle());
  return m ? asMeeting(m) : null;
}

/**
 * A meeting she is sent to right now from the client's page — one that is not on her
 * calendar, kept like the others so its notes are filed with it and it shows in their
 * past meetings. `now-…` marks it as not from her calendar, which never names one so.
 */
export async function startNowMeeting(clientId: string, m: { title: string; meetingUrl: string; by: string; note: string }): Promise<MeetingRow> {
  const now = isoNow();
  return asMeeting(
    await rows<Raw>(
      db()
        .from("meetings")
        .insert({
          client_id: clientId,
          event_id: `now-${crypto.randomUUID()}`,
          title: m.title.slice(0, 300),
          starts_at: now,
          meeting_url: m.meetingUrl,
          organizer: m.by,
          description: m.note.slice(0, 20_000),
          status: "upcoming",
          updated_at: now,
        })
        .select("*")
        .single(),
    ),
  );
}

export async function dropNowMeeting(clientId: string, id: string): Promise<void> {
  await rows(db().from("meetings").delete().eq("id", id).eq("client_id", clientId).like("event_id", "now-%"));
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
