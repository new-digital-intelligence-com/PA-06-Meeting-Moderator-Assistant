/**
 * The timekeeper.
 *
 * Deliberately has no model in it. Everything the moderator says on a schedule —
 * opening the meeting, moving to an item, warning on time, wrapping up — is generated
 * here from the clock, as a fixed string. Scripted lines cannot hallucinate, cannot be
 * slow and cannot fail on a rate limit, which is exactly what you want from the part
 * of the meeting everybody notices.
 *
 * The model is only reached for the two things that genuinely need it: answering when
 * somebody addresses the moderator, and writing the notes.
 */

import { currentItem, elapsedOnItem, type Meeting } from "./meeting";

export type CueKind = "open" | "item" | "warn" | "over" | "wrap";

export type Cue = {
  /** Stable across ticks, so a cue is spoken exactly once. */
  key: string;
  kind: CueKind;
  text: string;
};

/** Spoken, not printed: "1" reads badly, "one minute" reads well. */
const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty",
];

export function minutesAloud(n: number): string {
  const rounded = Math.max(0, Math.round(n));
  const word = rounded <= 20 ? WORDS[rounded] : String(rounded);
  return `${word} ${rounded === 1 ? "minute" : "minutes"}`;
}

function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The opening: what we are here for, and how long it should take. */
export function openingLine(m: Meeting): string {
  const titles = m.agenda.map((a, i) => `${i + 1}. ${a.title}, ${minutesAloud(a.minutes)}`);
  const total = m.agenda.reduce((s, a) => s + a.minutes, 0);
  if (!m.agenda.length) {
    return `Hello everyone, I'm Ava and I'll be moderating ${m.title}. There's no agenda set, so I'll take notes and keep track of any actions.`;
  }
  return [
    `Hello everyone, I'm Ava and I'll be moderating ${m.title}.`,
    `We have ${m.agenda.length === 1 ? "one item" : `${WORDS[m.agenda.length] ?? m.agenda.length} items`} today, ${minutesAloud(total)} in total.`,
    `${list(titles)}.`,
    `I'll keep time, take the notes, and read the actions back at the end. Let's start with ${m.agenda[0].title}.`,
  ].join(" ");
}

function itemLine(m: Meeting, index: number): string {
  const item = m.agenda[index];
  const owner = item.owner ? ` ${item.owner} is leading this one.` : "";
  return `Next up, item ${index + 1}: ${item.title}. We have ${minutesAloud(item.minutes)}.${owner}`;
}

/** The closing read-back. The action text itself comes from the note-taker. */
export function wrapLine(m: Meeting): string {
  const actions = m.actions;
  if (!actions.length) {
    return `That's the last item, and we're at time. I didn't capture any actions — if I missed one, say so now and I'll add it. Otherwise I'll send the notes round after the call.`;
  }
  const spoken = actions.map((a, i) => {
    const owner = a.owner ? `${a.owner} to ` : "";
    const due = a.due ? `, by ${a.due}` : "";
    return `${i + 1}. ${owner}${a.text}${due}`;
  });
  return [
    `That's the last item. Let me read back what I captured.`,
    `${list(spoken)}.`,
    `That's ${actions.length === 1 ? "one action" : `${WORDS[actions.length] ?? actions.length} actions`}. Shout if I got any of them wrong, otherwise they'll go out in the follow-up with the files.`,
  ].join(" ");
}

/**
 * The one decision this module makes: given the clock, is there something to say?
 *
 * Returns at most one cue per tick — a moderator that fires three announcements in a
 * row is worse than one that is a few seconds late.
 */
export function dueCue(m: Meeting, now = Date.now()): Cue | null {
  if (m.status !== "live") return null;
  const said = new Set(m.spoken);

  // 1. Open the meeting.
  if (!said.has("open")) {
    return { key: "open", kind: "open", text: openingLine(m) };
  }

  const item = currentItem(m);

  // 2. Everything is done — wrap up.
  if (!item) {
    if (m.currentIndex >= m.agenda.length && m.agenda.length > 0 && !said.has("wrap")) {
      return { key: "wrap", kind: "wrap", text: wrapLine(m) };
    }
    return null;
  }

  // 3. Announce the item we just moved to. The opening line already introduced the
  //    first one, so it does not get announced twice.
  const itemKey = `item:${item.id}`;
  if (!said.has(itemKey)) {
    if (m.currentIndex === 0) {
      return null; // covered by the opening
    }
    return { key: itemKey, kind: "item", text: itemLine(m, m.currentIndex) };
  }

  const elapsed = elapsedOnItem(m, now);
  const planned = item.minutes * 60;

  // 4. Time warning, once, when the tail of the slot is reached.
  //    A minute's notice, or a fifth of the slot, whichever is longer — but never
  //    before the item is half over, or a short item gets warned about the moment it
  //    opens (a five-minute slot minus a minute's notice is fine; a one-minute slot
  //    minus a minute's notice is zero).
  const warnAt = Math.max(planned * 0.5, planned - Math.max(60, planned * 0.2));
  const warnKey = `warn:${item.id}`;
  if (elapsed >= warnAt && elapsed < planned && !said.has(warnKey)) {
    const left = planned - elapsed;
    // Rounding to the nearest minute turns thirty seconds into "one minute", which is
    // the opposite of what a time check is for.
    const howLong = left < 60 ? "less than a minute" : `about ${minutesAloud(left / 60)}`;
    return {
      key: warnKey,
      kind: "warn",
      text: `Quick time check — ${howLong} left on ${item.title}.`,
    };
  }

  // 5. Overrun. Repeats every five minutes, because being told once and then left to
  //    run twenty minutes over is not keeping time.
  if (elapsed >= planned) {
    const overBy = elapsed - planned;
    const nudge = Math.floor(overBy / 300); // 0 at the buzzer, 1 at +5m, 2 at +10m…
    const overKey = `over:${item.id}:${nudge}`;
    if (!said.has(overKey)) {
      const text =
        nudge === 0
          ? `That's time on ${item.title}. Shall we move on, or do you want a few more minutes?`
          : `We're ${minutesAloud(overBy / 60)} over on ${item.title}, and it's eating the rest of the agenda.`;
      return { key: overKey, kind: "over", text };
    }
  }

  return null;
}

/** Everything the stage needs to render the agenda panel. */
export function timerView(m: Meeting, now = Date.now()) {
  const item = currentItem(m);
  const elapsed = elapsedOnItem(m, now);
  const planned = item ? item.minutes * 60 : 0;
  return {
    index: m.currentIndex,
    total: m.agenda.length,
    title: item?.title ?? null,
    owner: item?.owner ?? null,
    elapsed,
    planned,
    remaining: planned - elapsed,
    overrunning: Boolean(item) && elapsed > planned,
    meetingElapsed: m.startedAt ? Math.floor((now - m.startedAt) / 1000) : 0,
  };
}
