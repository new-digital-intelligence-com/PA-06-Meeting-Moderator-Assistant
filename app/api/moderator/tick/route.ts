import { NextResponse } from "next/server";
import {
  COOLDOWN_MS,
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
};

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

  const me = botName().toLowerCase();

  const incoming = (body.lines ?? [])
    .filter((l) => l.text?.trim())
    .map<TranscriptLine>((l) => ({
      id: l.id || newId(),
      speaker: (l.speaker || "Someone").trim(),
      text: l.text!.trim(),
      at: l.at ?? Date.now(),
    }))
    // Google captions her too, and those captions are a lossy echo of words we already
    // recorded ourselves the moment she said them. Dropping them here keeps one clean
    // copy and stops her treating her own voice as somebody addressing her.
    .filter((l) => !l.speaker.toLowerCase().includes(me));

  let meeting = await updateMeeting((m) => {
    const seen = new Set(m.transcript.map((t) => t.id));
    for (const line of incoming) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      m.transcript.push(line);
    }
    if (body.delivered) commit(m, body.delivered, body.deliveredText);
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

  if (meeting.status !== "live") return NextResponse.json({ say: null, ...view() });
  if (body.idle === false) return NextResponse.json({ say: null, ...view() });

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
  //
  // Only at the end of somebody's utterance. A finalised caption IS a turn boundary,
  // so this is the moment a person would take to speak — not mid-sentence.
  if (!incoming.length) return NextResponse.json({ say: null, ...view() });

  // "Quiet" means never, and the opening's shorter leash must not smuggle her past it.
  const base = COOLDOWN_MS[meeting.activity];
  if (!Number.isFinite(base)) return NextResponse.json({ say: null, ...view() });
  const cooldown = meeting.lastSpokeWasOpening ? Math.min(base, OPENING_COOLDOWN_MS) : base;

  const since = meeting.lastSpokeAt ? Date.now() - meeting.lastSpokeAt : Number.POSITIVE_INFINITY;
  if (since < cooldown) return NextResponse.json({ say: null, ...view() });

  try {
    const { worth_saying, say } = await considerSpeaking(
      meeting,
      meeting.transcript.slice(-30),
      meeting.lastSpokeAt ? since / 1000 : null,
    );
    if (worth_saying) {
      return NextResponse.json({
        say,
        kind: "volunteer",
        key: `volunteer:${incoming[incoming.length - 1].id}`,
        ...view(),
      });
    }
  } catch (e) {
    console.warn("[moderator] considerSpeaking failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ say: null, ...view() });
}
