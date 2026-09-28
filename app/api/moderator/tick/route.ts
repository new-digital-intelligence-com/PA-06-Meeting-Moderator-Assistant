import { NextResponse } from "next/server";
import {
  COOLDOWN_MS,
  getMeeting,
  OPENING_COOLDOWN_MS,
  elapsed,
  newId,
  updateMeeting,
  type Meeting,
  type TranscriptLine,
} from "@/lib/meeting";
import { answerAddressed, botName, groupTurn, isAddressed, mergeActions, type ModeratorReply } from "@/lib/moderator";
import { dueCue } from "@/lib/script";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The tick. The stage calls this on a short heartbeat, and as soon as somebody pauses.
 * It hands over whatever was said since last time and gets back the one thing to say now.
 *
 * She works in turns, like a person on a call. Everything said that she has not dealt
 * with yet waits in a queue; at the next pause she deals with all of it at once:
 *
 *   1. The opening, once, to say who she is.
 *   2. Her name is in it, or it is just her and one other person — then it is said to
 *      her. She answers.
 *   3. A group, and no name: Claude judges whether any of it was meant for her anyway —
 *      a misheard name, "the assistant", a question to the room she can answer — and
 *      whether she has something worth adding. Being spoken to always gets an answer;
 *      the activity level and the cooldown only govern volunteering.
 *
 * At most one line per tick, and nothing at all while she is mid-sentence.
 *
 * Delivery is confirmed rather than assumed: a line goes out with a key and is only
 * recorded once the stage reports she actually said it. A reply the stage had to drop —
 * somebody carried on talking — puts the lines it answered back in the queue.
 */

type TickBody = {
  lines?: { speaker?: string; text?: string; at?: number; id?: string }[];
  /** The stage says it is idle; if she is mid-sentence we return nothing. */
  idle?: boolean;
  /** The key of the line she has just finished saying, the words, and when she started. */
  delivered?: string;
  deliveredText?: string;
  deliveredAt?: number;
  /** The key of a reply the stage did not say, because somebody carried on talking. */
  dropped?: string;
  /** What the stage sees of her face and voice — the only window we have into it. */
  face?: string;
  faceDetail?: string;
  captions?: { socket: boolean; received: number; secondsSinceLast: number | null };
  /** How many people are in the call, her included. Null when the page cannot tell. */
  people?: number | null;
  /** Nobody else has arrived yet: no hello to an empty room. */
  waiting?: boolean;
  /** Email addresses people gave her in the meeting chat: they get the notes. */
  emails?: string[];
};

/**
 * Silence in the captions long enough to be the end of somebody's turn: a second after a
 * finished sentence, two when it trails off — people pause mid-thought, and answering
 * every such pause is how she confirmed one set of instructions four times in a minute.
 */
const PAUSE_S = 1;
const PAUSE_UNFINISHED_S = 2;
/** How much of the conversation she sees each turn: far more than the last few lines. */
const CONTEXT_CHARS = 24_000;
/**
 * Meet keeps rewriting a caption after it has been said — punctuation, "gonna" into
 * "going to" — so a line only counts as having more in it once it has grown by more
 * than that.
 */
const GREW = 12;
/** Something nobody gave her a pause to answer in this long has passed. */
const STALE_MS = 60_000;

/**
 * Captions rarely carry punctuation, so a question mark is not enough to go on — this
 * also looks for the shape of one.
 */
function looksLikeAQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.endsWith("?")) return true;
  return /\b(what|when|where|which|who|why|how|can we|could we|should we|do we|does it|is it|are we|any idea|how long|how much)\b/.test(
    t.split(/[.!?]/).pop() ?? t,
  );
}

/** The part of a caption block's text from `from` on, starting at a word. */
function tail(text: string, from: number): string {
  if (from <= 0) return text.trim();
  let rest = text.slice(from);
  // Meet rewrote the words before the cut, so it can land mid-word.
  if (/\w/.test(text[from - 1] ?? "") && /^\w/.test(rest)) rest = rest.replace(/^\S*/, "");
  return rest.replace(/^[\s,.;:!?-]+/, "").trim();
}

/**
 * Adds a caption to the transcript.
 *
 * Google Meet does not append to a caption, it rewrites it as the sentence goes on —
 * punctuation shifts, "EI" becomes "AI", "Ava Ava!" becomes "Ava, Ava." — so her runner
 * sends the id of the caption block itself, and the line with that id is replaced.
 *
 * Meet also keeps one block per speaker for as long as they keep talking, across
 * several turns. Once she has answered a line it is sealed, and whatever the block says
 * after that becomes a new line, after her answer — otherwise everything said to her
 * lands above her reply to it, and she reads her own answer as coming first.
 */
function fold(transcript: TranscriptLine[], line: TranscriptLine) {
  const now = Date.now();
  const parts = transcript.filter((l) => (l.block ?? l.id) === line.id);
  const part = parts[parts.length - 1];
  if (part) {
    if (!part.sealed) {
      const text = tail(line.text, part.from ?? 0) || part.text;
      if (text !== part.text) part.updatedAt = now;
      part.text = text;
      part.full = line.text.length;
      return;
    }
    const from = part.full ?? (part.from ?? 0) + part.text.length;
    const rest = tail(line.text, from);
    if (!rest) return;
    transcript.push({
      id: `${line.id}#${parts.length}`,
      block: line.id,
      from,
      full: line.text.length,
      speaker: line.speaker,
      text: rest,
      at: now,
      updatedAt: now,
    });
    return;
  }

  // No block id (the Recall stage): fold by text instead.
  //
  // The most recent line by THIS speaker, not simply the last line — if she says
  // something while somebody is still talking, her line lands between a half-finished
  // remark and its continuation.
  let last: TranscriptLine | undefined;
  for (let i = transcript.length - 1; i >= 0 && i >= transcript.length - 6; i--) {
    if (transcript[i].speaker === line.speaker) {
      last = transcript[i];
      break;
    }
  }

  if (last && !last.sealed && now - last.at < 120_000) {
    const a = last.text.toLowerCase();
    const b = line.text.toLowerCase();
    // The same utterance, longer: replace in place.
    if (b.startsWith(a)) {
      if (b !== a) last.updatedAt = now;
      last.text = line.text;
      return;
    }
    // A late or partial redelivery of what we already have: ignore it.
    if (a.startsWith(b) || a === b) return;
  }

  // An exact repeat of something recent — a redelivery after a reconnect.
  const recent = transcript.slice(-12);
  if (recent.some((l) => l.speaker === line.speaker && l.text === line.text)) return;

  transcript.push({ ...line, full: line.text.length, updatedAt: now });
}

/** Her own words coming back as somebody's caption — her name as the speaker, or "You". */
function isHer(speaker: string): boolean {
  const me = botName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(${me}|you)\\b`, "i").test(speaker.trim());
}

/** Loose enough to survive a caption mishearing a word or two of what she said. */
function echoesHer(text: string, m: Meeting): boolean {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const heard = words(text);
  if (heard.size < 3) return false;

  // Only her recent lines matter: an echo arrives within seconds of her saying it.
  const cutoff = Date.now() - 60_000;
  const mine = m.transcript.filter((l) => l.speaker === botName() && l.at >= cutoff);

  return mine.some((line) => {
    const said = words(line.text);
    if (!said.size) return false;
    let shared = 0;
    for (const w of heard) if (said.has(w)) shared++;
    return shared / heard.size > 0.6;
  });
}

function commit(m: Meeting, key: string, text?: string, startedAt?: number) {
  if (key.startsWith("open") && !m.spoken.includes(key)) {
    m.spoken.push(key);
    m.startedAt = Date.now();
  }
  if (m.inflight?.key === key) m.inflight = undefined;

  // Her own words go into the transcript, spoken by her — a participant who cannot hear
  // themselves repeats themselves. It goes in where she started saying it: anything
  // said while she was talking came after the start of her line, not before it.
  if (text?.trim() && !m.transcript.some((l) => l.id === `said:${key}`)) {
    const at = startedAt ?? Date.now();
    let i = m.transcript.length;
    while (i > 0 && m.transcript[i - 1].at > at) i--;
    m.transcript.splice(i, 0, { id: `said:${key}`, speaker: botName(), text: text.trim(), at });
  }
  // Everything she says paces what she volunteers next, and is remembered so she does
  // not make the same point twice.
  m.lastSpokeAt = Date.now();
  // The opening does not count as having made a point, so it neither muzzles her nor
  // gets treated as something she must avoid repeating.
  m.lastSpokeWasOpening = key.startsWith("open");
  if (text?.trim() && !m.lastSpokeWasOpening) m.lastSaid = text.trim();
}

/** The reply was not said: the lines it answered go back in her queue. */
function requeue(m: Meeting, key: string) {
  if (m.inflight?.key !== key) return;
  for (const line of m.transcript) {
    if (!m.inflight.lines.includes(line.id)) continue;
    line.dealt = undefined;
    line.sealed = false;
    line.tries = (line.tries ?? 0) + 1;
    line.updatedAt = Date.now();
  }
  m.inflight = undefined;
}

/**
 * What somebody said that she has not dealt with yet, oldest first: never dealt with,
 * or grown by more than Meet's rewriting since, and recent enough to still be live.
 */
function queue(m: Meeting): TranscriptLine[] {
  const since = Date.now() - STALE_MS;
  return m.transcript.filter(
    (l) =>
      l.speaker !== botName() &&
      !l.id.startsWith("said:") &&
      (l.dealt === undefined || l.text.length - l.dealt >= GREW) &&
      (l.updatedAt ?? l.at) >= since,
  );
}

/** The part of a line she has not heard yet — only that can summon her again. */
const unheard = (l: TranscriptLine) => (l.dealt === undefined ? l.text : l.text.slice(Math.max(0, l.dealt - 12)));

/**
 * Is it just her and one other person? Two different people talking settles it — it is a
 * group, whatever the page's count says: in a real Teams call the third person had no
 * tile yet, the count said two, and she answered everything everybody said. Otherwise
 * her browser's count, and failing that, it is one-on-one.
 */
function oneOnOne(m: Meeting, people: number | null | undefined): boolean {
  const since = Date.now() - 10 * 60_000;
  const voices = new Set(m.transcript.filter((l) => l.at >= since && l.speaker !== botName()).map((l) => l.speaker));
  if (voices.size >= 2) return false;
  if (typeof people === "number" && people > 0) return people <= 2;
  return true;
}

/** The conversation she sees: as much of the end of it as fits the budget, in order. */
function recentLines(m: Meeting): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let size = 0;
  for (let i = m.transcript.length - 1; i >= 0; i--) {
    size += m.transcript[i].speaker.length + m.transcript[i].text.length + 3;
    if (size > CONTEXT_CHARS) break;
    out.push(m.transcript[i]);
  }
  return out.reverse();
}

export async function POST(request: Request) {
  let body: TickBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Needed before the write, to recognise her own words coming back as captions.
  const meetingBefore = await getMeeting();

  const incoming = (body.lines ?? [])
    .filter((l) => l.text?.trim())
    .map<TranscriptLine>((l) => ({
      id: l.id || newId(),
      speaker: (l.speaker || "Someone").trim(),
      text: l.text!.trim(),
      at: l.at ?? Date.now(),
    }))
    // Google captions her too, and those captions are an echo of words we already
    // recorded ourselves the moment she said them. Matching on what she actually just
    // said catches it whatever label Google decides to hang on her.
    .filter((l) => !isHer(l.speaker) && !echoesHer(l.text, meetingBefore));

  let meeting = await updateMeeting((m) => {
    for (const line of incoming) fold(m.transcript, line);
    if (body.delivered) commit(m, body.delivered, body.deliveredText, body.deliveredAt);
    if (body.dropped) requeue(m, body.dropped);
    for (const email of body.emails ?? []) {
      const e = String(email).trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !m.recipients.includes(e)) m.recipients.push(e);
    }
    if (body.face) {
      m.stage = { face: body.face, detail: body.faceDetail, at: Date.now(), captions: body.captions, people: body.people };
    }
    // The stage only ticks once she is actually in the call.
    if (m.status === "joining" || m.status === "scheduled") m.status = "live";
  });

  const view = () => ({
    status: meeting.status,
    elapsed: elapsed(meeting),
    heard: meeting.transcript.length,
    actions: meeting.actions,
  });

  /** Records why she said nothing, so "she stopped talking" is answerable. */
  const quiet = async (reason: string) => {
    if (meeting.lastDecision?.reason !== reason) {
      meeting = await updateMeeting((m) => {
        m.lastDecision = { at: Date.now(), reason };
      });
    }
    return NextResponse.json({ say: null, reason, ...view() });
  };

  if (meeting.status !== "live") return quiet(`meeting is ${meeting.status}`);
  if (body.idle === false) return quiet("she is still speaking");
  if (body.waiting) return quiet("waiting for somebody to arrive");

  /* 1 ─ the opening, once */
  const cue = dueCue(meeting);
  if (cue) return NextResponse.json({ say: cue.text, kind: cue.kind, key: cue.key, ...view() });

  const waiting = queue(meeting);
  if (!waiting.length) return quiet("listening — nothing new since she last responded");

  // Wait for a pause. Captions stream while somebody is talking; answering before the
  // pause cuts across them — and answers half a question. What is queued keeps: a
  // question put to her while somebody else is still talking is answered at the next
  // pause, not lost.
  const quietFor = body.captions?.secondsSinceLast;
  const finished = /[.?!…]["')\]]?\s*$/.test(waiting[waiting.length - 1].text);
  if (quietFor !== null && quietFor !== undefined && quietFor < (finished ? PAUSE_S : PAUSE_UNFINISHED_S)) {
    return quiet("somebody is mid-sentence");
  }

  const ids = waiting.map((l) => l.id);
  const attempt = Math.max(0, ...waiting.map((l) => l.tries ?? 0));
  const recent = recentLines(meeting);
  const secondsSinceSheSpoke = meeting.lastSpokeAt ? (Date.now() - meeting.lastSpokeAt) / 1000 : null;

  /** Deals with the whole queue: says `say`, or lets it pass. Either way, once. */
  const settle = async (
    say: string | null,
    reason: string,
    kind: "reply" | "volunteer",
    actions?: ModeratorReply["add_actions"],
    memory?: string,
  ) => {
    const key = say ? `${kind}:${ids[ids.length - 1]}:${Date.now().toString(36)}` : null;
    meeting = await updateMeeting((m) => {
      for (const line of m.transcript) {
        if (!ids.includes(line.id)) continue;
        line.dealt = line.text.length;
        if (say) line.sealed = true;
      }
      if (actions?.length) m.actions.push(...mergeActions(m.actions, actions));
      if (memory?.trim()) m.memory = memory.trim().slice(0, 1200);
      m.inflight = key ? { key, lines: ids } : m.inflight;
      m.lastDecision = { at: Date.now(), reason };
    });
    return NextResponse.json({ say, kind, key, attempt, reason: say ? undefined : reason, ...view() });
  };

  /* 2 ─ said to her: her name, or it is just the two of them */
  const named = [...waiting].reverse().find((l) => isAddressed(unheard(l)));
  const solo = oneOnOne(meeting, body.people);
  if (named || solo) {
    const turn = named ?? waiting[waiting.length - 1];
    const how = named ? "named" : "one-on-one";
    try {
      const reply = await answerAddressed(meeting, turn, recent, how);
      const say = reply.say?.trim() || null;
      return settle(say, say ? `answered (${how})` : `heard ${turn.speaker}, nothing to say back`, "reply", reply.add_actions, reply.memory);
    } catch (e) {
      // A model failure must not stop the meeting. The queue keeps, so the next pause
      // tries again; the transcript is still being recorded for the write-up.
      console.warn("[moderator] reply failed:", e instanceof Error ? e.message : e);
      return quiet(`could not answer: ${e instanceof Error ? e.message : "model error"}`);
    }
  }

  /* 3 ─ a group, and no name: was it for her anyway, and has she something to add? */

  // "Quiet" never volunteers; the others do once their cooldown has passed. A question
  // to the room gets a shorter leash — leaving it hanging because she spoke six seconds
  // ago reads as her having checked out. The opening counts for a short beat only.
  const base = COOLDOWN_MS[meeting.activity];
  const cooldown = meeting.lastSpokeWasOpening ? Math.min(base, OPENING_COOLDOWN_MS) : base;
  const effective = waiting.some((l) => looksLikeAQuestion(l.text)) ? Math.min(cooldown, 3_000) : cooldown;
  const since = meeting.lastSpokeAt ? Date.now() - meeting.lastSpokeAt : Number.POSITIVE_INFINITY;
  const mayVolunteer = Number.isFinite(base) && since >= effective;

  try {
    const t = await groupTurn(meeting, waiting, recent, { mayVolunteer, secondsSinceSheSpoke });
    if (t.respond && (t.addressed || mayVolunteer)) {
      return settle(t.say, t.addressed ? "answered (spoken to)" : "spoke up", t.addressed ? "reply" : "volunteer", t.add_actions, t.memory);
    }
    return settle(
      null,
      t.addressed
        ? "spoken to, but nothing to say"
        : !Number.isFinite(base)
          ? "not spoken to — set to quiet"
          : mayVolunteer
            ? "judged there was nothing worth adding"
            : "not spoken to — and she spoke moments ago",
      "reply",
      t.add_actions,
      t.memory,
    );
  } catch (e) {
    console.warn("[moderator] group turn failed:", e instanceof Error ? e.message : e);
    return quiet(`could not decide: ${e instanceof Error ? e.message : "model error"}`);
  }
}
