/**
 * The meeting — one shared object, read and written by two very different clients:
 *
 *   the control room   (/)      runs in your browser: you write the context, send her
 *                               in, watch what she hears, and see what went out.
 *   the stage          (/bot)   runs inside Recall's browser and is streamed into the
 *                               meeting as her camera. It posts transcript lines in and
 *                               asks what to say next.
 *
 * Neither can hold the state, so the server does — see `lib/store.ts` for where it
 * actually lives, which differs between local dev and a deployment.
 */

import crypto from "node:crypto";
import { store } from "./store";

export type TranscriptLine = {
  id: string;
  speaker: string;
  text: string;
  /** epoch ms */
  at: number;
};

export type ActionItem = {
  id: string;
  text: string;
  owner?: string;
  due?: string;
};

export type SharedFile = {
  id: string;
  name: string;
  link: string;
  /** Emails the moderator granted access to. */
  sharedWith: string[];
};

export type MeetingStatus = "draft" | "joining" | "live" | "ended";

export type Meeting = {
  id: string;
  title: string;
  meetingUrl: string;
  /**
   * What this meeting is about, in your own words: the subject, who is attending, what
   * matters, anything she should know before she walks in. This is the only briefing
   * she gets, and it is what she reasons from when somebody asks her a question.
   */
  context: string;
  /** Who the notes go to when it ends. */
  recipients: string[];
  status: MeetingStatus;
  botId?: string;
  startedAt?: number;
  endedAt?: number;
  transcript: TranscriptLine[];
  actions: ActionItem[];
  files: SharedFile[];
  /** Keys of the few scripted lines she has said, so none is repeated. */
  spoken: string[];
  /** Last line index handed to the note-taker, so it only reads what is new. */
  notedUpTo: number;
  summary?: string;
  followUp?: { to: string; subject: string; body: string; sentAt?: number };
};

export const newId = () => crypto.randomBytes(8).toString("hex");

export function blank(): Meeting {
  return {
    id: newId(),
    title: "Untitled meeting",
    meetingUrl: "",
    context: "",
    recipients: [],
    status: "draft",
    transcript: [],
    actions: [],
    files: [],
    spoken: [],
    notedUpTo: 0,
  };
}

/**
 * Brings whatever is in the store up to the current shape.
 *
 * The stored meeting outlives the code that wrote it: a deployment lands while a blob
 * from the previous version is still sitting in Redis, and the new code reads a field
 * that did not exist yet. One `undefined.join()` in a server component is a 500 on the
 * whole page, which is a silly way to lose an app.
 *
 * So every field is defaulted, and the one rename worth carrying forward is carried:
 * `participants` became `recipients` when the agenda was replaced by a briefing.
 */
function normalise(raw: unknown): Meeting {
  const o = (raw ?? {}) as Record<string, unknown>;
  const base = blank();
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  return {
    id: str(o.id, base.id),
    title: str(o.title, base.title),
    meetingUrl: str(o.meetingUrl, ""),
    context: str(o.context, ""),
    // `participants` was this field's name before the agenda came out.
    recipients: arr<string>(o.recipients ?? o.participants),
    status: (["draft", "joining", "live", "ended"] as const).includes(o.status as MeetingStatus)
      ? (o.status as MeetingStatus)
      : "draft",
    botId: typeof o.botId === "string" ? o.botId : undefined,
    startedAt: typeof o.startedAt === "number" ? o.startedAt : undefined,
    endedAt: typeof o.endedAt === "number" ? o.endedAt : undefined,
    transcript: arr<TranscriptLine>(o.transcript),
    actions: arr<ActionItem>(o.actions),
    files: arr<SharedFile>(o.files),
    spoken: arr<string>(o.spoken),
    notedUpTo: typeof o.notedUpTo === "number" ? o.notedUpTo : 0,
    summary: typeof o.summary === "string" ? o.summary : undefined,
    followUp:
      o.followUp && typeof o.followUp === "object"
        ? (o.followUp as Meeting["followUp"])
        : undefined,
  };
}

function parse(raw: string | null): Meeting | null {
  if (!raw) return null;
  try {
    return normalise(JSON.parse(raw));
  } catch {
    return null; // a corrupt blob should start a fresh meeting, not crash every route
  }
}

/**
 * Always a round trip — no process-local cache.
 *
 * Caching would be free on one Node process and wrong everywhere else: the stage and
 * the control room can be served by different instances, and a cached copy means she
 * carries on moderating a meeting that ended five minutes ago.
 */
export async function getMeeting(): Promise<Meeting> {
  const existing = parse(await store().read());
  if (existing) return existing;
  return updateMeeting(() => undefined);
}

/**
 * Read-modify-write, serialised.
 *
 * The whole cycle happens inside the lock: the stage appends transcript lines every two
 * seconds while the note-taker appends actions every twenty, and a read that straddles
 * the other's write silently loses one of them.
 */
export async function updateMeeting(mutate: (m: Meeting) => void): Promise<Meeting> {
  return store().withLock(async () => {
    const meeting = parse(await store().read()) ?? blank();
    mutate(meeting);
    await store().write(JSON.stringify(meeting));
    return meeting;
  });
}

export async function resetMeeting(): Promise<Meeting> {
  return store().withLock(async () => {
    const fresh = blank();
    await store().write(JSON.stringify(fresh));
    return fresh;
  });
}

/* ------------------------------------------------------------------ derived */

export function elapsed(m: Meeting, now = Date.now()): number {
  if (!m.startedAt) return 0;
  return Math.floor(((m.endedAt ?? now) - m.startedAt) / 1000);
}

/** The transcript as plain text, for the note-taker and the write-up. */
export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
}

/** Everyone who actually spoke — useful context the briefing may not mention. */
export function speakers(m: Meeting): string[] {
  return Array.from(new Set(m.transcript.map((l) => l.speaker))).filter((s) => s !== "Someone");
}
