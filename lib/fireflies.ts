/**
 * Fireflies — the notetaker in most of NDI's own meetings — read through its API with
 * Michael Burian's key (FIREFLIES_API_KEY): every meeting his Fireflies recorded, with
 * its calendar event, its people, Fireflies' summary and action items, and who said what.
 *
 *   before a meeting   the same meeting before (its series: the same title or calendar
 *                      event) and the latest meetings with the same people — their summaries
 *                      and action items — go into her brief, whether or not anybody
 *                      prepared her (lib/prepare.ts, app/api/ava/upcoming);
 *   after a meeting    once Fireflies has written it up, its summary, actions, attendees
 *                      and link are kept with the meeting, and its transcript becomes
 *                      passages she searches in the client's later meetings — not in her
 *                      digest, not in their document list (lib/knowledge.ts).
 *
 * Only what that account recorded. Nothing is sent to Fireflies; it is only read.
 */
import { asMeeting, db, hasDb, isoNow, rows, type MeetingRow } from "./db";
import { getClient } from "./clients";
import { rememberPeople } from "./contacts";
import { record } from "./history";
import { addMeetingRecord } from "./knowledge";

const URL = "https://api.fireflies.ai/graphql";

const key = () => (process.env.FIREFLIES_API_KEY || process.env.fireflies_api_key || "").trim();

export function hasFireflies(): boolean {
  return Boolean(key());
}

/** One meeting as Fireflies has it. */
export type FirefliesMeeting = {
  id: string;
  title: string;
  dateString: string;
  duration: number | null;
  organizer_email: string | null;
  calendar_id: string | null;
  cal_id: string | null;
  meeting_link: string | null;
  transcript_url: string | null;
  participants: string[] | null;
  meeting_attendees: { displayName: string | null; email: string | null }[] | null;
  summary: { overview: string | null; action_items: string | null; keywords: string[] | null; short_summary: string | null } | null;
  sentences?: { speaker_name: string | null; text: string | null }[] | null;
};

const FIELDS = `id title dateString duration organizer_email calendar_id cal_id meeting_link transcript_url participants
  meeting_attendees { displayName email }
  summary { overview action_items keywords short_summary }`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] };
  if (!res.ok || json.errors?.length || !json.data) {
    throw new Error(`Fireflies: ${json.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
  }
  return json.data;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
/** A Google event's id without its instance ("abc_20261015T090000Z" → "abc"): the series. */
const seriesOf = (id: string | null | undefined) => (id ?? "").split("_")[0].trim().toLowerCase();
const linkOf = (url: string | null | undefined) => (url ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
const at = (m: FirefliesMeeting) => Date.parse(m.dateString);

/** The same meeting: its calendar series, or failing that its exact title. */
function sameSeries(m: MeetingRow, f: FirefliesMeeting): boolean {
  const ours = seriesOf(m.event_id);
  if (ours && (seriesOf(f.calendar_id) === ours || seriesOf(f.cal_id) === ours)) return true;
  return norm(f.title) === norm(m.title);
}

/** Whose account the key is (Michael's): in every meeting it recorded, so no sign of the same people. */
let owner: Promise<string> | null = null;
const ownerEmail = () =>
  (owner ??= gql<{ user: { email: string | null } }>(`{ user { email } }`, {})
    .then((d) => (d.user.email ?? "").toLowerCase())
    .catch(() => {
      owner = null;
      return "";
    }));

/** Who to look for: the invite's people — not her, not rooms, not the account's owner. */
async function peopleOf(m: MeetingRow): Promise<string[]> {
  const mine = await ownerEmail();
  return [...new Set([m.organizer, ...(m.guests ?? []).map((g) => g.email)].map((e) => (e ?? "").trim().toLowerCase()))]
    .filter((e) => e.includes("@") && e !== mine && !e.startsWith("ava@") && !e.includes("resource.calendar.google.com"))
    .slice(0, 25);
}

export type Earlier = { series: FirefliesMeeting[]; withPeople: FirefliesMeeting[] };

const earlierCache = new Map<string, { at: number; value: Earlier }>();

/**
 * What Fireflies has from before this meeting: the last three of its series, and the last
 * three other meetings in the past month with any of its people. Kept a quarter of an hour.
 */
export async function earlierFromFireflies(m: MeetingRow): Promise<Earlier> {
  const empty = { series: [], withPeople: [] };
  if (!hasFireflies()) return empty;
  const cached = earlierCache.get(m.id);
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.value;

  const before = new Date(m.starts_at.getTime() - 10 * 60_000).toISOString();
  const { transcripts: titled } = await gql<{ transcripts: FirefliesMeeting[] }>(
    `query ($keyword: String, $toDate: DateTime) { transcripts(keyword: $keyword, scope: "title", toDate: $toDate, limit: 15) { ${FIELDS} } }`,
    { keyword: m.title.slice(0, 250), toDate: before },
  );
  // Only those Fireflies wrote up: one too short to summarise says nothing.
  const series = titled
    .filter((f) => sameSeries(m, f) && at(f) < m.starts_at.getTime() - 10 * 60_000 && f.summary?.overview)
    .sort((a, b) => at(b) - at(a))
    .slice(0, 3);

  let withPeople: FirefliesMeeting[] = [];
  const people = await peopleOf(m);
  if (people.length) {
    const { transcripts } = await gql<{ transcripts: FirefliesMeeting[] }>(
      `query ($participants: [String!], $fromDate: DateTime, $toDate: DateTime) { transcripts(participants: $participants, fromDate: $fromDate, toDate: $toDate, limit: 15) { ${FIELDS} } }`,
      { participants: people, fromDate: new Date(m.starts_at.getTime() - 30 * 86_400_000).toISOString(), toDate: before },
    );
    const taken = new Set(series.map((s) => s.id));
    withPeople = transcripts
      .filter((f) => !taken.has(f.id) && !sameSeries(m, f) && f.summary?.overview)
      .sort((a, b) => at(b) - at(a))
      .slice(0, 3);
  }

  const value = { series, withPeople };
  earlierCache.set(m.id, { at: Date.now(), value });
  return value;
}

const day = (f: FirefliesMeeting) => new Date(f.dateString).toUTCString().slice(0, 16);

function oneMeeting(f: FirefliesMeeting): string {
  const people = (f.meeting_attendees ?? []).map((a) => a.displayName || a.email).filter(Boolean).join(", ");
  return [
    `### ${f.title} — ${day(f)}${f.duration ? ` (${Math.round(f.duration)} min)` : ""}`,
    people ? `People: ${people}` : "",
    `Summary: ${(f.summary?.overview || f.summary?.short_summary || "(none)").trim().slice(0, 1800)}`,
    f.summary?.action_items?.trim() ? `Action items:\n${f.summary.action_items.trim().slice(0, 1500)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** For her brief: what Fireflies has from before, as text. Empty when it has nothing. */
export function earlierText(e: Earlier | null | undefined): string {
  if (!e || (!e.series.length && !e.withPeople.length)) return "";
  return [
    e.series.length ? `The same meeting before, newest first:\n${e.series.map(oneMeeting).join("\n\n")}` : "",
    e.withPeople.length ? `Other recent meetings with the same people:\n${e.withPeople.map(oneMeeting).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ after */

/** Fireflies' recording of this meeting, if it was there: its calendar event first, then its link, then its title. */
export async function recordingOf(m: MeetingRow): Promise<FirefliesMeeting | null> {
  const start = m.starts_at.getTime();
  const end = (m.ends_at ?? m.starts_at).getTime();
  const { transcripts } = await gql<{ transcripts: FirefliesMeeting[] }>(
    `query ($fromDate: DateTime, $toDate: DateTime) { transcripts(fromDate: $fromDate, toDate: $toDate, limit: 50) { ${FIELDS} } }`,
    { fromDate: new Date(start - 2 * 3_600_000).toISOString(), toDate: new Date(end + 2 * 3_600_000).toISOString() },
  );
  const near = (f: FirefliesMeeting, ms: number) => Math.abs(at(f) - start) <= ms;
  const ours = seriesOf(m.event_id);
  const link = linkOf(m.meeting_url);
  return (
    transcripts.find((f) => ours && (seriesOf(f.cal_id) === ours || seriesOf(f.calendar_id) === ours) && near(f, 3 * 3_600_000)) ??
    transcripts.find((f) => link && linkOf(f.meeting_link) === link && near(f, 3 * 3_600_000)) ??
    transcripts.find((f) => norm(f.title) === norm(m.title) && near(f, 90 * 60_000)) ??
    null
  );
}

async function fullRecording(id: string): Promise<FirefliesMeeting> {
  const { transcript } = await gql<{ transcript: FirefliesMeeting }>(
    `query ($id: String!) { transcript(id: $id) { ${FIELDS} sentences { speaker_name text } } }`,
    { id },
  );
  return transcript;
}

/** Who said what, one line per turn: consecutive sentences of one speaker joined. */
export function transcriptText(f: FirefliesMeeting): string {
  const lines: string[] = [];
  let speaker = "";
  let said = "";
  for (const s of f.sentences ?? []) {
    const who = (s.speaker_name || "Someone").trim();
    const text = (s.text || "").trim();
    if (!text) continue;
    if (who === speaker) said += ` ${text}`;
    else {
      if (said) lines.push(`${speaker}: ${said}`);
      speaker = who;
      said = text;
    }
  }
  if (said) lines.push(`${speaker}: ${said}`);
  return lines.join("\n");
}

/** Kept with a meeting, in its notes: what Fireflies made of it. */
export type FirefliesNotes = {
  id: string;
  url: string | null;
  title: string;
  date: string;
  overview: string;
  actions: string;
  keywords: string[];
  attendees: { name: string | null; email: string | null }[];
  knowledgeId: string | null;
  importedAt: string;
};

/** Meetings already looked for, and when: Fireflies takes a while to write one up. */
const lookedAt = new Map<string, number>();
const LOOK_EVERY_MS = 10 * 60_000;
/** After this long, a meeting Fireflies has no recording of is let go. */
const GIVE_UP_MS = 8 * 3_600_000;

/**
 * Brings in what Fireflies made of her clients' meetings that have just finished — a few
 * each time it is called (once a minute, with her runner's calendar read). Each meeting is
 * looked for every ten minutes until Fireflies has written it up, for eight hours at most.
 */
export async function importFinished(limit = 2): Promise<void> {
  if (!hasFireflies() || !hasDb()) return;
  const now = Date.now();
  const found = await rows<Record<string, unknown>[]>(
    db()
      .from("meetings")
      .select("*")
      .not("client_id", "is", null)
      .not("status", "in", "(cancelled,declined)")
      .gte("starts_at", new Date(now - GIVE_UP_MS).toISOString())
      .lte("starts_at", new Date(now - 10 * 60_000).toISOString())
      .order("starts_at", { ascending: false })
      .limit(40),
  );
  const due = found
    .map(asMeeting)
    .filter((m) => {
      const notes = m.notes as { fireflies?: unknown } | null;
      if (notes?.fireflies) return false;
      const over = (m.ended_at ?? m.ends_at ?? m.starts_at).getTime();
      if (over > now - 5 * 60_000) return false;
      return now - (lookedAt.get(m.id) ?? 0) >= LOOK_EVERY_MS;
    })
    .slice(0, limit);

  for (const m of due) {
    lookedAt.set(m.id, now);
    try {
      const recording = await recordingOf(m);
      // Not recorded, or not written up yet: looked for again in ten minutes.
      if (!recording?.summary?.overview) continue;
      await keep(m, await fullRecording(recording.id));
    } catch (e) {
      console.warn(`[fireflies] ${m.title}:`, e instanceof Error ? e.message : e);
    }
  }
}

async function keep(m: MeetingRow, f: FirefliesMeeting): Promise<void> {
  const client = m.client_id ? await getClient(m.client_id) : null;
  if (!client) return;
  const text = transcriptText(f);
  const overview = (f.summary?.overview ?? "").trim();
  const actions = (f.summary?.action_items ?? "").trim();

  // Her later meetings with this client can search who said what in this one.
  let knowledgeId: string | null = null;
  if (text.length > 200) {
    try {
      const doc = await addMeetingRecord({
        client,
        title: `${m.title} — ${day(f)} (Fireflies)`,
        source: f.transcript_url,
        text: [`Meeting: ${m.title}, ${day(f)}`, overview && `Summary: ${overview}`, actions && `Action items:\n${actions}`, "", text].filter(Boolean).join("\n"),
        summary: [overview, actions && `Action items:\n${actions}`].filter(Boolean).join("\n\n").slice(0, 4000),
      });
      knowledgeId = doc.id;
    } catch (e) {
      console.warn(`[fireflies] transcript of ${m.title} not kept:`, e instanceof Error ? e.message : e);
    }
  }

  const fireflies: FirefliesNotes = {
    id: f.id,
    url: f.transcript_url,
    title: f.title,
    date: f.dateString,
    overview,
    actions,
    keywords: f.summary?.keywords ?? [],
    attendees: (f.meeting_attendees ?? []).map((a) => ({ name: a.displayName, email: a.email })),
    knowledgeId,
    importedAt: isoNow(),
  };
  const current = await rows<{ notes: Record<string, unknown> | null } | null>(db().from("meetings").select("notes").eq("id", m.id).maybeSingle());
  await rows(
    db()
      .from("meetings")
      .update({ notes: { ...(current?.notes ?? {}), fireflies }, updated_at: isoNow() })
      .eq("id", m.id),
  );
  await record({ meeting_id: m.id, kind: "fireflies", by: "Ava", detail: { url: f.transcript_url, actions: actions ? actions.split("\n").filter(Boolean).length : 0, searchable: Boolean(knowledgeId) } });
  // Who was there, by name, on the client's Who's who — there to be written about.
  await rememberPeople(client.id, fireflies.attendees).catch(() => undefined);
  console.log(`[fireflies] kept ${m.title} (${day(f)})${knowledgeId ? ", transcript searchable" : ""}`);
}
