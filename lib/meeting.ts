/**
 * The meeting — one shared object, read and written by two very different clients:
 *
 *   the control room   (/)      runs in your browser: builds the agenda, launches the
 *                               bot, reviews notes, sends the follow-up.
 *   the stage          (/bot)   runs inside Recall's browser and is streamed into the
 *                               meeting as the bot's camera. It posts transcript lines
 *                               in and asks what to say next.
 *
 * Neither can hold the state, so the server does. One meeting at a time is plenty for
 * a demo; swap this for a real table before a second host exists.
 */

import crypto from "node:crypto";
import { store } from "./store";

export type AgendaItem = {
  id: string;
  title: string;
  /** Planned length. The timekeeper compares this against the wall clock. */
  minutes: number;
  owner?: string;
};

export type TranscriptLine = {
  id: string;
  speaker: string;
  text: string;
  /** epoch ms */
  at: number;
  /** Which agenda item was open when this was said — used to file the notes. */
  agendaItemId?: string;
};

export type ActionItem = {
  id: string;
  text: string;
  owner?: string;
  due?: string;
  /** Read back to the room and not objected to. */
  confirmed: boolean;
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
  /** Who to write the follow-up to. Seeded by hand, extended by who actually spoke. */
  participants: string[];
  agenda: AgendaItem[];
  /** -1 before the first item is opened. */
  currentIndex: number;
  status: MeetingStatus;
  botId?: string;
  startedAt?: number;
  itemStartedAt?: number;
  endedAt?: number;
  transcript: TranscriptLine[];
  actions: ActionItem[];
  files: SharedFile[];
  /** Cue keys already spoken, so the timekeeper never says the same thing twice. */
  spoken: string[];
  minutes?: string;
  followUp?: { to: string; subject: string; body: string };
  /** Last line index handed to the note-taker, so it only reads what is new. */
  notedUpTo: number;
};

export const newId = () => crypto.randomBytes(8).toString("hex");

export function blank(): Meeting {
  return {
    id: newId(),
    title: "Untitled meeting",
    meetingUrl: "",
    participants: [],
    agenda: [],
    currentIndex: -1,
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
 * the control room can be served by different instances, and a cached copy means the
 * timekeeper ticking against a meeting that ended five minutes ago.
 */
export async function getMeeting(): Promise<Meeting> {
  const existing = parse(await store().read());
  if (existing) return existing;
  // First read of a fresh deployment. Write it down so the meeting id is stable.
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

export function currentItem(m: Meeting): AgendaItem | null {
  return m.agenda[m.currentIndex] ?? null;
}

export function totalMinutes(m: Meeting): number {
  return m.agenda.reduce((sum, item) => sum + item.minutes, 0);
}

/** Seconds spent on the open agenda item, or 0 when none is open. */
export function elapsedOnItem(m: Meeting, now = Date.now()): number {
  if (!m.itemStartedAt) return 0;
  return Math.max(0, Math.floor((now - m.itemStartedAt) / 1000));
}

export function speakerEmails(m: Meeting): string[] {
  return Array.from(new Set(m.participants.map((p) => p.trim()).filter(Boolean)));
}

/** The transcript as plain text, for the note-taker and the minutes. */
export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
}
