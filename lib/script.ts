/**
 * The handful of things she says without being asked.
 *
 * There are only two, and neither goes near a model. A scripted line cannot
 * hallucinate, cannot be slow and cannot fail on a rate limit — which is what you want
 * from the first thing a room full of people hears her say.
 *
 * Everything else she says is an answer to somebody who addressed her, and that does
 * go through the model. See `lib/moderator.ts`.
 */

import type { Meeting } from "./meeting";

export type Cue = {
  /** Stable, so a line is spoken exactly once. */
  key: string;
  kind: "open" | "close";
  text: string;
};

/**
 * Hello, here is what I am, here is what I will do with what you say.
 *
 * She announces the note-taking on purpose. She is a participant that records and
 * transcribes, and a room is entitled to hear that from her rather than work it out.
 */
export function openingLine(m: Meeting): string {
  const name = (process.env.BOT_NAME || "Ava").split("—")[0].trim();
  const about = m.title && m.title !== "Untitled meeting" ? ` for ${m.title}` : "";
  return [
    `Hello everyone, I'm ${name}, and I'll be sitting in${about}.`,
    `I'm taking notes, so just say my name if you want me for anything.`,
    `I'll send round a summary and the actions afterwards.`,
  ].join(" ");
}

/** Said when you end the meeting from the control room, before she leaves. */
export function closingLine(m: Meeting): string {
  const count = m.actions.length;
  const actions =
    count === 0
      ? "I didn't catch any actions"
      : count === 1
        ? "I've got one action"
        : `I've got ${count} actions`;
  return `That's me done — ${actions}, and the notes will be in your inbox shortly. Thanks everyone.`;
}

/** Is there anything for her to say off her own bat right now? */
export function dueCue(m: Meeting): Cue | null {
  if (m.status !== "live") return null;
  if (!m.spoken.includes("open")) {
    return { key: "open", kind: "open", text: openingLine(m) };
  }
  return null;
}
