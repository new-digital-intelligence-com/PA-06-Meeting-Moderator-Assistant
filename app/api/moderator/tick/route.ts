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
import { answerAddressed, botName, considerSpeaking, isAddressed, mergeActions } from "@/lib/moderator";
import { dueCue } from "@/lib/script";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The tick. The stage calls this on a short heartbeat, and immediately whenever a
 * caption contains her name. It hands over whatever was said since last time and gets
 * back the one thing to say now.
 *
 * She speaks in three situations, in this order of priority:
 *
 *   1. The opening, once, to say who she is.
 *   2. Somebody addressed her. This always wins — ignoring a direct question is the
 *      worst thing she can do.
 *   3. She has something worth adding. A model call decides, at the end of somebody's
 *      utterance, and only once the cooldown for the chosen activity level has passed.
 *
 * At most one line per tick, and nothing at all while she is mid-sentence.
 *
 * Delivery is confirmed rather than assumed: a line goes out with a key and is only
 * recorded once the stage reports she actually said it. If her face is down the line
 * comes back round instead of vanishing.
 */

type TickBody = {
  lines?: { speaker?: string; text?: string; at?: number; id?: string }[];
  /** The stage says it is idle; if she is mid-sentence we return nothing. */
  idle?: boolean;
  /** The key of the line she has just finished saying, and the words themselves. */
  delivered?: string;
  deliveredText?: string;
  /** What the stage sees of her face and voice — the only window we have into it. */
  face?: string;
  faceDetail?: string;
  captions?: { socket: boolean; received: number; secondsSinceLast: number | null };
};

/**
 * Adds a caption to the transcript, folding it into the previous line when it is the
 * same utterance still being typed.
 *
 * Recall streams a running transcript rather than finished sentences: one real remark
 * arrives as a stream of messages whose text grows word by word. Treating each as a new
 * line gives thousands of fragments; treating them as duplicates of one key throws the
 * remark away after its first word. Both happened here. So: if this looks like the last
 * line growing, replace it; if it repeats something already said, drop it; otherwise it
 * is genuinely new.
 */
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

/** Changes whenever anything new has been said, including a line still growing. */
function transcriptSignature(transcript: TranscriptLine[]): string {
  const last = transcript[transcript.length - 1];
  return `${transcript.length}:${last ? last.text.length : 0}`;
}

function fold(transcript: TranscriptLine[], line: TranscriptLine) {
  // The most recent line by THIS speaker, not simply the last line.
  //
  // If she says something while somebody is still talking, her line lands between a
  // half-finished remark and its continuation. Looking only at the very last line then
  // fails to match, and the opening fragment is stranded as its own sentence — which is
  // where "Helmi: Thanks everyone for" came from.
  let last: TranscriptLine | undefined;
  for (let i = transcript.length - 1; i >= 0 && i >= transcript.length - 6; i--) {
    if (transcript[i].speaker === line.speaker) {
      last = transcript[i];
      break;
    }
  }

  if (last && Date.now() - last.at < 120_000) {
    const a = last.text.toLowerCase();
    const b = line.text.toLowerCase();
    // The same utterance, longer: replace in place and keep the original timestamp so
    // ordering stays honest.
    if (b.startsWith(a)) {
      last.text = line.text;
      return;
    }
    // A late or partial redelivery of what we already have: ignore it.
    if (a.startsWith(b) || a === b) return;
  }

  // An exact repeat of something recent, from any speaker — a redelivery after a
  // reconnect, which is common when the socket drops and comes back.
  const recent = transcript.slice(-12);
  if (recent.some((l) => l.speaker === line.speaker && l.text === line.text)) return;

  transcript.push(line);
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

function commit(m: Meeting, key: string, text?: string) {
  if (key.startsWith("open") && !m.spoken.includes(key)) {
    m.spoken.push(key);
    m.startedAt = Date.now();
  }

  // Her own words go into the transcript, spoken by her.
  //
  // They were being dropped entirely, which left her blind to what she had already
  // said — so she repeated a point verbatim two turns later, and drifted into claiming
  // things had been done that had only been mentioned. A participant who cannot hear
  // themselves is not a participant. It also means the write-up covers what she
  // contributed, which is part of the meeting like anything else.
  if (text?.trim()) {
    m.transcript.push({
      id: `said:${key}`,
      speaker: botName(),
      text: text.trim(),
      at: Date.now(),
    });
  }
  // Everything she says paces what she volunteers next, and is remembered so she does
  // not make the same point twice.
  m.lastSpokeAt = Date.now();
  // The opening does not count as having made a point, so it neither muzzles her nor
  // gets treated as something she must avoid repeating.
  m.lastSpokeWasOpening = key.startsWith("open");
  if (text?.trim() && !m.lastSpokeWasOpening) m.lastSaid = text.trim();
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
    // recorded ourselves the moment she said them.
    //
    // Matching on her name is not enough: Meet attributed her opening to "Unknown", so
    // the echo slipped through and she filed her own introduction as somebody else's
    // remark. Matching on what she actually just said catches it whatever label Google
    // decides to hang on her.
    .filter((l) => !l.speaker.toLowerCase().includes(me) && !echoesHer(l.text, meetingBefore));

  let meeting = await updateMeeting((m) => {
    for (const line of incoming) fold(m.transcript, line);
    if (body.delivered) commit(m, body.delivered, body.deliveredText);
    if (body.face) {
      m.stage = { face: body.face, detail: body.faceDetail, at: Date.now(), captions: body.captions };
    }
    // The stage rendering at all means Recall's browser loaded the page, which only
    // happens once the bot is in the call.
    if (m.status === "joining") m.status = "live";
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

  /* 1 ─ the opening, once */
  const cue = dueCue(meeting);
  if (cue) return NextResponse.json({ say: cue.text, kind: cue.kind, key: cue.key, ...view() });

  /* 2 ─ somebody said her name */
  const addressed = incoming.filter((l) => isAddressed(l.text)).pop();
  if (addressed) {
    try {
      const reply = await answerAddressed(meeting, addressed, meeting.transcript.slice(-30));

      if (reply.add_actions?.length) {
        meeting = await updateMeeting((m) => {
          m.actions.push(...mergeActions(m.actions, reply.add_actions!));
        });
      }

      if (reply.say?.trim()) {
        return NextResponse.json({
          say: reply.say.trim(),
          kind: "reply",
          key: `reply:${addressed.id}`,
          ...view(),
        });
      }
      // An empty `say` is her judging the remark was not really for her. Fall through.
    } catch (e) {
      // A model failure must not stop the meeting: she stays quiet, and the transcript
      // is still being recorded for the write-up.
      console.warn("[moderator] reply failed:", e instanceof Error ? e.message : e);
    }
  }

  /* 3 ─ has she got something worth saying? */

  // "Quiet" means never, and the opening's shorter leash must not smuggle her past it.
  const base = COOLDOWN_MS[meeting.activity];
  if (!Number.isFinite(base)) return quiet("set to quiet — only answers when asked");
  const cooldown = meeting.lastSpokeWasOpening ? Math.min(base, OPENING_COOLDOWN_MS) : base;

  // A question asked to the room gets a much shorter leash.
  //
  // Pacing exists to stop her editorialising over people, not to make her sit on an
  // answer somebody is plainly waiting for. Leaving a question hanging because she
  // spoke six seconds ago is exactly what reads as her having checked out.
  // The newest line from somebody who is not her. Her own contributions are appended
  // when the tile confirms them, which can be a tick or two after the fact — so the
  // literal last line is often hers, and looking at that meant a question addressed to
  // the room was never seen as one.
  const newest = [...meeting.transcript].reverse().find((l) => l.speaker !== botName());
  const asked = Boolean(newest && looksLikeAQuestion(newest.text));
  const effective = asked ? Math.min(cooldown, 3_000) : cooldown;

  const since = meeting.lastSpokeAt ? Date.now() - meeting.lastSpokeAt : Number.POSITIVE_INFINITY;
  if (since < effective) {
    return quiet(`waiting — ${Math.ceil((effective - since) / 1000)}s of cooldown left`);
  }

  // Wait for a gap before speaking.
  //
  // Captions stream continuously while somebody is talking, so "new words have arrived"
  // is true almost every tick and is no signal at all. A second of quiet is the signal:
  // it is the moment a person would take their turn, and it stops her cutting across
  // the end of somebody's sentence.
  const quietFor = body.captions?.secondsSinceLast;
  if (quietFor !== null && quietFor !== undefined && quietFor < 1) {
    return quiet("somebody is mid-sentence");
  }

  // A signature rather than a count: folding means the last line grows in place, so a
  // long uninterrupted remark never changes the length and would otherwise never be
  // weighed up at all.
  const signature = transcriptSignature(meeting.transcript);
  if (signature === meeting.consideredSignature) {
    return quiet("nothing new said since she last considered");
  }

  try {
    const { worth_saying, say } = await considerSpeaking(
      meeting,
      meeting.transcript.slice(-30),
      meeting.lastSpokeAt ? since / 1000 : null,
    );

    if (worth_saying) {
      meeting = await updateMeeting((m) => {
        m.consideredSignature = signature;
        m.lastDecision = { at: Date.now(), reason: "spoke up" };
      });
      return NextResponse.json({ say, kind: "volunteer", key: `volunteer:${signature}`, ...view() });
    }

    meeting = await updateMeeting((m) => {
      m.consideredSignature = signature;
    });
    return quiet("judged there was nothing worth adding");
  } catch (e) {
    console.warn("[moderator] considerSpeaking failed:", e instanceof Error ? e.message : e);
    return quiet(`could not decide: ${e instanceof Error ? e.message : "model error"}`);
  }
}
