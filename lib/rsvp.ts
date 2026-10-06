/**
 * Her answers to invites. One meeting at a time for each client, and no more at once than
 * her server has seats for (lib/meeting.ts) — two clients' meetings can run side by side,
 * two of one client's cannot. An invite that would break either gets a no, with the reason
 * in the note the host reads in the reply email; every other invite from a client gets a yes.
 *
 * Which of two clashing meetings she keeps: one she has already said yes to, then the one
 * that has been at that time longest — invited first, or moved there first — so a host
 * never loses her because somebody else moved their meeting onto hers.
 *
 * Planned on every read of her calendar (lib/schedule.ts), so the pages show it at once;
 * sent only from her runner's read, once a minute — one sender, so no host gets the same
 * answer twice. Invites she does not go to anyway — nobody's client, a paused client's,
 * without a Google Meet link — are not answered here.
 */
import type { GoogleClient } from "./google";
import { redisOrMongoKey } from "./store";

export type Answer = "accepted" | "declined";

export type Candidate = {
  /** The invite's event id — each occurrence of a recurring meeting has its own. */
  id: string;
  /** The recurring meeting it is an occurrence of. */
  series: string | null;
  start: number;
  end: number;
  /** Her answer on her calendar now: needsAction, accepted, tentative or declined. */
  response: string;
  /** Since when it has been at this time: invited, or last moved. */
  since: number;
  /** Her address on it — what she answers as; null when she cannot answer it. */
  self: string | null;
  /** Whose meeting: one at a time for each client. */
  client: string | null;
};

/** The answers she sent herself, by event id — an occurrence's, or a whole series'. */
export type Given = Record<string, { answer: Answer; at: number }>;

export type Planned = Map<string, { answer: Answer; clash?: string }>;

export type Reply = {
  /** What is answered: one occurrence, or a whole series. */
  target: string;
  answer: Answer;
  /** The occurrences on her calendar it answers for. */
  ids: string[];
  self: string;
  /** What the host reads with it. Empty for a yes — which also clears an earlier no's note. */
  note: string;
};

/** Never which meeting she is booked for: that may be another client's. */
export const NOTE = {
  one: "Sorry, I can't join this one: I'm already booked at that time. If it moves to a time I'm free, I'll accept.",
  series: "Sorry, I can't join these: I'm already booked at those times. If they move to a time I'm free, I'll accept.",
};

type Span = { start: number; end: number };
const overlap = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** The most of these meetings running at the same moment within `c` — back to back is one after the other. */
function deepest(c: Span, others: Span[]): number {
  const edges = others.flatMap((o) => [
    { at: Math.max(o.start, c.start), d: 1 },
    { at: Math.min(o.end, c.end), d: -1 },
  ]);
  // An ending and a start at the same moment: the ending first.
  edges.sort((a, b) => a.at - b.at || a.d - b.d);
  let now = 0;
  let most = 0;
  for (const e of edges) most = Math.max(most, (now += e.d));
  return most;
}

/** A no she gave herself — to this occurrence, or to its series. Any other no on her calendar was somebody's choice, and stands. */
export function declinedByHer(c: Candidate, given: Given): boolean {
  return given[c.id]?.answer === "declined" || (c.series !== null && given[c.series]?.answer === "declined");
}

/**
 * Her answer to each meeting she would go to, with `seats` meetings at once at most. A no
 * somebody else gave on her calendar stands and holds no time; the rest are taken in order
 * — what she has said yes to, then what has been at its time longest — each kept unless it
 * overlaps one already kept for the same client, or would make more meetings at once than
 * she has seats. Meetings back to back do not overlap.
 */
export function plan(candidates: Candidate[], given: Given, seats = 1): Planned {
  const open = candidates.filter((c) => c.response !== "declined" || declinedByHer(c, given));
  const order = [...open].sort(
    (a, b) =>
      Number(b.response === "accepted") - Number(a.response === "accepted") ||
      a.since - b.since ||
      a.start - b.start ||
      a.id.localeCompare(b.id),
  );
  const kept: Candidate[] = [];
  const out: Planned = new Map();
  for (const c of order) {
    const during = kept.filter((k) => overlap(k, c));
    const clash =
      during.find((k) => c.client !== null && k.client === c.client) ?? (deepest(c, during) + 1 > Math.max(1, seats) ? during[0] : undefined);
    if (clash) {
      out.set(c.id, { answer: "declined", clash: clash.id });
    } else {
      kept.push(c);
      out.set(c.id, { answer: "accepted" });
    }
  }
  return out;
}

/**
 * What to send so her calendar says what was planned — nothing where it already does. A
 * recurring meeting is answered as a whole, one email to its host rather than one per
 * occurrence; an occurrence that clashes is then declined on its own.
 */
export function replies(candidates: Candidate[], planned: Planned): Reply[] {
  const out: Reply[] = [];
  const series = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const want = planned.get(c.id)?.answer;
    if (!want || !c.self) continue;
    if (c.series) {
      series.set(c.series, [...(series.get(c.series) ?? []), c]);
    } else if (c.response !== want) {
      out.push({ target: c.id, answer: want, ids: [c.id], self: c.self, note: want === "declined" ? NOTE.one : "" });
    }
  }
  for (const [id, all] of series) {
    const yes = all.filter((c) => planned.get(c.id)!.answer === "accepted");
    const no = all.filter((c) => planned.get(c.id)!.answer === "declined");
    if (!yes.length) {
      // Every occurrence she can see clashes: the series gets one no.
      if (no.some((c) => c.response !== "declined")) out.push({ target: id, answer: "declined", ids: no.map((c) => c.id), self: no[0].self!, note: NOTE.series });
      continue;
    }
    const whole = yes.some((c) => c.response !== "accepted");
    if (whole) out.push({ target: id, answer: "accepted", ids: yes.map((c) => c.id), self: yes[0].self!, note: "" });
    // After a yes to the whole series, its clashing occurrences again: the yes may have covered them.
    for (const c of no) {
      if (whole || c.response !== "declined") out.push({ target: c.id, answer: "declined", ids: [c.id], self: c.self!, note: NOTE.one });
    }
  }
  return out;
}

/**
 * Sends them: only her own answer and its note, with the rest of the guest list left as the
 * host has it, and Google emails the host. What went out is added to `given`.
 */
export async function send(google: GoogleClient, list: Reply[], given: Given): Promise<{ reply: Reply; error?: string }[]> {
  const out: { reply: Reply; error?: string }[] = [];
  for (const reply of list) {
    try {
      await google.request(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(reply.target)}?sendUpdates=all`,
        {
          method: "PATCH",
          body: JSON.stringify({
            attendeesOmitted: true,
            attendees: [{ email: reply.self, responseStatus: reply.answer, comment: reply.note }],
          }),
        },
      );
      const at = Date.now();
      for (const id of new Set([reply.target, ...reply.ids])) given[id] = { answer: reply.answer, at };
      out.push({ reply });
    } catch (e) {
      out.push({ reply, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

const GIVEN = "ava:answers";
/** How long her own answers are remembered — well past any meeting on her calendar. */
const KEEP_MS = 180 * 24 * 60 * 60_000;

export async function readGiven(): Promise<Given> {
  try {
    return JSON.parse((await redisOrMongoKey(GIVEN).read()) ?? "{}") as Given;
  } catch {
    return {};
  }
}

export async function writeGiven(given: Given): Promise<void> {
  const now = Date.now();
  await redisOrMongoKey(GIVEN).write(JSON.stringify(Object.fromEntries(Object.entries(given).filter(([, v]) => now - v.at < KEEP_MS))));
}
