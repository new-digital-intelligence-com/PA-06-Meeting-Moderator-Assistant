import { NextResponse } from "next/server";
import { elapsed, newId, updateMeeting, type Meeting, type TranscriptLine } from "@/lib/meeting";
import { answerAddressed, isAddressed, mergeActions } from "@/lib/moderator";
import { dueCue } from "@/lib/script";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The tick. The stage calls this every couple of seconds while she is silent, hands
 * over whatever was said since last time, and gets back the one thing to say now.
 *
 * She speaks in exactly two situations: once at the start to introduce herself, and
 * whenever somebody says her name. That is the whole of it — she is a participant, not
 * a PA system, and a bot that volunteers remarks into a meeting is an irritation.
 *
 * Delivery is confirmed, not assumed. A scripted line is handed out with its key and
 * only recorded as said once the next tick reports she actually said it. If her face is
 * down, the line comes back round instead of vanishing.
 */

type TickBody = {
  lines?: { speaker?: string; text?: string; at?: number; id?: string }[];
  /** The stage says it is idle; if she is mid-sentence we return nothing. */
  idle?: boolean;
  /** The cue key she has just finished saying out loud. */
  delivered?: string;
};

function commit(m: Meeting, key: string) {
  if (m.spoken.includes(key)) return;
  m.spoken.push(key);
  if (key === "open") m.startedAt = Date.now();
}

export async function POST(request: Request) {
  let body: TickBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const incoming = (body.lines ?? [])
    .filter((l) => l.text?.trim())
    .map<TranscriptLine>((l) => ({
      id: l.id || newId(),
      speaker: (l.speaker || "Someone").trim(),
      text: l.text!.trim(),
      at: l.at ?? Date.now(),
    }));

  // Record what was said, bank anything she has just delivered, and note that the
  // stage rendering at all means Recall's browser loaded the page — which only
  // happens once the bot is in the call.
  let meeting = await updateMeeting((m) => {
    const seen = new Set(m.transcript.map((t) => t.id));
    for (const line of incoming) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      m.transcript.push(line);
    }
    if (body.delivered) commit(m, body.delivered);
    if (m.status === "joining") m.status = "live";
  });

  const view = () => ({
    status: meeting.status,
    elapsed: elapsed(meeting),
    heard: meeting.transcript.length,
    actions: meeting.actions,
  });

  if (meeting.status !== "live") return NextResponse.json({ say: null, ...view() });
  // She is still speaking: take the transcript, say nothing more.
  if (body.idle === false) return NextResponse.json({ say: null, ...view() });

  /* ── the opening, once ────────────────────────────────────────────────── */
  const cue = dueCue(meeting);
  if (cue) return NextResponse.json({ say: cue.text, kind: cue.kind, key: cue.key, ...view() });

  /* ── somebody said her name ───────────────────────────────────────────── */
  const addressed = incoming.filter((l) => isAddressed(l.text)).pop();
  if (!addressed) return NextResponse.json({ say: null, ...view() });

  try {
    const reply = await answerAddressed(meeting, addressed, meeting.transcript.slice(-30));

    if (reply.add_actions?.length) {
      meeting = await updateMeeting((m) => {
        m.actions.push(...mergeActions(m.actions, reply.add_actions!));
      });
    }

    // A reply is a one-off with no bookkeeping behind it, so it carries no key.
    if (reply.say?.trim()) {
      return NextResponse.json({ say: reply.say.trim(), kind: "reply", key: null, ...view() });
    }
  } catch (e) {
    // A model failure must not stop the meeting: she stays quiet, and the transcript
    // is still being recorded for the write-up.
    console.warn("[moderator] reply failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ say: null, ...view() });
}
