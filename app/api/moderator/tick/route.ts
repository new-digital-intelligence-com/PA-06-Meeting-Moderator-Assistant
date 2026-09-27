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
import { answerAddressed, botName, considerSpeaking, isAddressed, mergeActions, type Addressed } from "@/lib/moderator";
import { dueCue } from "@/lib/script";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The tick. The stage calls this on a short heartbeat, and as soon as somebody pauses.
 * It hands over whatever was said since last time and gets back the one thing to say now.
 *
 * She works in turns, like a person on a call: somebody talks, pauses, and she decides
 * what to do about what they just said — once. In order of priority:
 *
 *   1. The opening, once, to say who she is.
 *   2. Somebody said her name, or it is just her and one other person — then whatever
 *      they say is said to her. She answers.
 *   3. In a group, unnamed: a model call decides whether she has something worth adding,
 *      and only once the cooldown for the chosen activity level has passed.
 *
 * At most one line per tick, and nothing at all while she is mid-sentence.
 *
 * Delivery is confirmed rather than assumed: a line goes out with a key and is only
 * recorded once the stage reports she actually said it.
 */

type TickBody = {
  lines?: { speaker?: string; text?: string; at?: number; id?: string }[];
  /** The stage says it is idle; if she is mid-sentence we return nothing. */
  idle?: boolean;
  /** The key of the line she has just finished saying, the words, and when she started. */
  delivered?: string;
  deliveredText?: string;
  deliveredAt?: number;
  /** What the stage sees of her face and voice — the only window we have into it. */
  face?: string;
  faceDetail?: string;
  captions?: { socket: boolean; received: number; secondsSinceLast: number | null };
  /** How many people are in the call, her included. Null when the page cannot tell. */
  people?: number | null;
};

/** A second of silence in the captions: the moment a person would take their turn. */
const PAUSE_S = 1;
/**
 * Meet keeps rewriting a caption after it has been said — punctuation, "gonna" into
 * "going to" — so a turn only counts as having more in it once it has grown by more
 * than that.
 */
const GREW = 12;

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
  const parts = transcript.filter((l) => (l.block ?? l.id) === line.id);
  const part = parts[parts.length - 1];
  if (part) {
    if (!part.sealed) {
      part.text = tail(line.text, part.from ?? 0) || part.text;
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
      at: Date.now(),
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

  if (last && !last.sealed && Date.now() - last.at < 120_000) {
    const a = last.text.toLowerCase();
    const b = line.text.toLowerCase();
    // The same utterance, longer: replace in place.
    if (b.startsWith(a)) {
      last.text = line.text;
      return;
    }
    // A late or partial redelivery of what we already have: ignore it.
    if (a.startsWith(b) || a === b) return;
  }

  // An exact repeat of something recent — a redelivery after a reconnect.
  const recent = transcript.slice(-12);
  if (recent.some((l) => l.speaker === line.speaker && l.text === line.text)) return;

  transcript.push({ ...line, full: line.text.length });
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

/**
 * Is it just her and one other person? Her browser counts the people in the call; when
 * it cannot, the fallback is how many people have spoken in the last ten minutes.
 */
function oneOnOne(m: Meeting, people: number | null | undefined): boolean {
  if (typeof people === "number" && people > 0) return people <= 2;
  const since = Date.now() - 10 * 60_000;
  const voices = new Set(m.transcript.filter((l) => l.at >= since && l.speaker !== botName()).map((l) => l.speaker));
  return voices.size <= 1;
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

  const me = botName().toLowerCase();

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
    .filter((l) => !l.speaker.toLowerCase().includes(me) && !echoesHer(l.text, meetingBefore));

  let meeting = await updateMeeting((m) => {
    for (const line of incoming) fold(m.transcript, line);
    if (body.delivered) commit(m, body.delivered, body.deliveredText, body.deliveredAt);
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

  /** Marks a turn as dealt with; `answered` also seals it, so what follows goes after her. */
  const handle = (turn: TranscriptLine, answered: boolean, reason: string) =>
    updateMeeting((m) => {
      m.handled = { id: turn.id, len: turn.text.length };
      m.lastDecision = { at: Date.now(), reason };
      if (answered) {
        const line = m.transcript.find((l) => l.id === turn.id);
        if (line) line.sealed = true;
      }
    });

  if (meeting.status !== "live") return quiet(`meeting is ${meeting.status}`);
  if (body.idle === false) return quiet("she is still speaking");

  /* 1 ─ the opening, once */
  const cue = dueCue(meeting);
  if (cue) return NextResponse.json({ say: cue.text, kind: cue.kind, key: cue.key, ...view() });

  // The turn she would be responding to: the newest thing somebody else said.
  const turn = [...meeting.transcript].reverse().find((l) => l.speaker !== botName());
  if (!turn) return quiet("nobody has said anything yet");

  const h = meeting.handled;
  const sameTurn = h?.id === turn.id;
  if (sameTurn && turn.text.length - h.len < GREW) return quiet("listening — nothing new since she last responded");

  // Wait for them to finish. Captions stream while somebody is talking; a pause is the
  // end of their turn, and answering before it cuts across them — and answers half a
  // question, again for every rewrite of it.
  const quietFor = body.captions?.secondsSinceLast;
  if (quietFor !== null && quietFor !== undefined && quietFor < PAUSE_S) {
    return quiet("somebody is mid-sentence");
  }

  // Only the part she has not already responded to can summon her again.
  const fresh = sameTurn ? turn.text.slice(Math.max(0, h.len - 12)) : turn.text;
  const how: Addressed | null = isAddressed(fresh) ? "named" : oneOnOne(meeting, body.people) ? "one-on-one" : null;

  /* 2 ─ said to her */
  if (how) {
    try {
      const reply = await answerAddressed(meeting, turn, meeting.transcript.slice(-30), how);

      if (reply.add_actions?.length) {
        meeting = await updateMeeting((m) => {
          m.actions.push(...mergeActions(m.actions, reply.add_actions!));
        });
      }

      const say = reply.say?.trim();
      meeting = await handle(turn, Boolean(say), say ? `answered (${how})` : `heard ${turn.speaker}, nothing to say back`);
      if (say) {
        return NextResponse.json({ say, kind: "reply", key: `reply:${turn.id}:${turn.text.length}`, ...view() });
      }
      return NextResponse.json({ say: null, reason: meeting.lastDecision?.reason, ...view() });
    } catch (e) {
      // A model failure must not stop the meeting: she stays quiet, and the transcript
      // is still being recorded for the write-up.
      console.warn("[moderator] reply failed:", e instanceof Error ? e.message : e);
      return quiet(`could not answer: ${e instanceof Error ? e.message : "model error"}`);
    }
  }

  /* 3 ─ a group, and nobody asked her: has she got something worth saying? */

  // "Quiet" means never, and the opening's shorter leash must not smuggle her past it.
  const base = COOLDOWN_MS[meeting.activity];
  if (!Number.isFinite(base)) return quiet("set to quiet — only answers when asked");
  const cooldown = meeting.lastSpokeWasOpening ? Math.min(base, OPENING_COOLDOWN_MS) : base;

  // A question asked to the room gets a much shorter leash: leaving it hanging because
  // she spoke six seconds ago is exactly what reads as her having checked out.
  const effective = looksLikeAQuestion(turn.text) ? Math.min(cooldown, 3_000) : cooldown;

  const since = meeting.lastSpokeAt ? Date.now() - meeting.lastSpokeAt : Number.POSITIVE_INFINITY;
  if (since < effective) {
    // Not marked as handled: once the cooldown lifts she weighs it up after all.
    return quiet(`waiting — ${Math.ceil((effective - since) / 1000)}s of cooldown left`);
  }

  try {
    const { worth_saying, say } = await considerSpeaking(
      meeting,
      meeting.transcript.slice(-30),
      meeting.lastSpokeAt ? since / 1000 : null,
    );

    meeting = await handle(turn, worth_saying, worth_saying ? "spoke up" : "judged there was nothing worth adding");
    if (worth_saying) {
      return NextResponse.json({ say, kind: "volunteer", key: `volunteer:${turn.id}:${turn.text.length}`, ...view() });
    }
    return NextResponse.json({ say: null, reason: meeting.lastDecision?.reason, ...view() });
  } catch (e) {
    console.warn("[moderator] considerSpeaking failed:", e instanceof Error ? e.message : e);
    return quiet(`could not decide: ${e instanceof Error ? e.message : "model error"}`);
  }
}
