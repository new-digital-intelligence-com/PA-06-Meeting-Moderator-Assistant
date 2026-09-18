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

function parse(raw: string | null): Meeting | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Meeting;
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
