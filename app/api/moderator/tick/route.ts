import { NextResponse } from "next/server";
import { dueCue, timerView } from "@/lib/agenda";
import { newId, updateMeeting, type TranscriptLine } from "@/lib/meeting";
import { answerAddressed, isAddressed, mergeActions } from "@/lib/moderator";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The tick. The stage calls this every couple of seconds while Ava is not talking,
 * hands over whatever was said since last time, and gets back the one thing to say now.
 *
 * Ordering matters and is deliberate:
 *
 *   1. Open the meeting. She introduces herself before she does anything else.
 *   2. Answer whoever addressed her. A person waiting on a reply beats the clock —
 *      a time warning that lands one tick late costs nothing; a question that goes
 *      unanswered for ten seconds is a bot that ignored somebody.
 *   3. Otherwise, whatever the timekeeper says is due.
 *
 * At most one line comes back per tick. Stacking three announcements is how a
 * moderator turns into a nuisance.
 */

type TickBody = {
  lines?: { speaker?: string; text?: string; at?: number; id?: string }[];
  /** The stage says it is idle; if it is mid-sentence we return nothing. */
  idle?: boolean;
};

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

  // Record what was said, and note that the stage rendering at all means Recall's
  // browser loaded the page — which only happens once the bot is in the call.
  let meeting = await updateMeeting((m) => {
    const seen = new Set(m.transcript.map((t) => t.id));
    const item = m.agenda[m.currentIndex];
    for (const line of incoming) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      m.transcript.push({ ...line, agendaItemId: item?.id });
    }
    if (m.status === "joining") m.status = "live";
  });

  if (meeting.status !== "live") {
    return NextResponse.json({ say: null, timer: timerView(meeting), status: meeting.status });
  }
  if (body.idle === false) {
    // She is still speaking — take the transcript, say nothing.
    return NextResponse.json({ say: null, timer: timerView(meeting), status: meeting.status });
  }

  /* 1 ─ the opening, which also starts the clock on item one */
  if (!meeting.spoken.includes("open")) {
    const cue = dueCue(meeting);
    if (cue?.kind === "open") {
      meeting = await updateMeeting((m) => {
        m.spoken.push("open");
        m.startedAt = Date.now();
        if (m.agenda.length) {
          m.currentIndex = 0;
          m.itemStartedAt = Date.now();
          m.spoken.push(`item:${m.agenda[0].id}`); // the opening introduced it
        }
      });
      return NextResponse.json({ say: cue.text, kind: "open", timer: timerView(meeting), status: meeting.status });
    }
  }

  /* 2 ─ somebody said her name */
  const addressed = incoming.filter((l) => isAddressed(l.text)).pop();
  if (addressed) {
    try {
      const recent = meeting.transcript.slice(-25);
      const reply = await answerAddressed(meeting, addressed, recent);

      if (reply.add_actions?.length || reply.advance) {
        meeting = await updateMeeting((m) => {
          if (reply.add_actions?.length) {
            // Asked for out loud, in front of everybody — treat as agreed.
            const added = mergeActions(m.actions, reply.add_actions).map((a) => ({ ...a, confirmed: true }));
            m.actions.push(...added);
          }
          if (reply.advance && m.currentIndex < m.agenda.length) {
            m.currentIndex += 1;
            m.itemStartedAt = Date.now();
          }
        });
      }

      if (reply.say?.trim()) {
        return NextResponse.json({
          say: reply.say.trim(),
          kind: "reply",
          timer: timerView(meeting),
          actions: meeting.actions,
          status: meeting.status,
        });
      }
      // An empty `say` is her deciding the remark was not for her. Fall through to the
      // clock rather than forcing an answer.
    } catch (e) {
      // A model failure must not stop the meeting: she stays quiet, the timekeeper
      // carries on, and the transcript is still being recorded.
      console.warn("[moderator] reply failed:", e instanceof Error ? e.message : e);
    }
  }

  /* 3 ─ the clock */
  const cue = dueCue(meeting);
  if (cue) {
    meeting = await updateMeeting((m) => {
      m.spoken.push(cue.key);
      if (cue.kind === "wrap") m.actions = m.actions.map((a) => ({ ...a, confirmed: true }));
    });
    return NextResponse.json({
      say: cue.text,
      kind: cue.kind,
      timer: timerView(meeting),
      actions: meeting.actions,
      status: meeting.status,
    });
  }

  return NextResponse.json({
    say: null,
    timer: timerView(meeting),
    actions: meeting.actions,
    status: meeting.status,
  });
}
