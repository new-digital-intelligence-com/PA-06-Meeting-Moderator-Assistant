import { NextResponse } from "next/server";
import { dueCue, timerView } from "@/lib/agenda";
import { newId, updateMeeting, type Meeting, type TranscriptLine } from "@/lib/meeting";
import { answerAddressed, isAddressed, mergeActions } from "@/lib/moderator";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The tick. The stage calls this every couple of seconds while Ava is silent, hands
 * over whatever was said since last time, and gets back the one thing to say now.
 *
 * Ordering matters and is deliberate:
 *
 *   1. Open the meeting. She introduces herself before she does anything else.
 *   2. Answer whoever addressed her. A person waiting on a reply beats the clock — a
 *      time warning that lands one tick late costs nothing; a question ignored for ten
 *      seconds is a bot that snubbed somebody.
 *   3. Otherwise, whatever the timekeeper says is due.
 *
 * At most one line per tick. Stacking three announcements is how a moderator becomes a
 * nuisance.
 *
 * Delivery is confirmed, not assumed. A cue is handed out with its key and only
 * recorded as spoken when the next tick reports that she actually said it. If her face
 * is down, the line is re-offered instead of silently vanishing — which is precisely
 * how a meeting used to end up with a moderator who never introduced herself and a
 * clock that never started.
 */

type TickBody = {
  lines?: { speaker?: string; text?: string; at?: number; id?: string }[];
  /** The stage says it is idle; if it is mid-sentence we return nothing. */
  idle?: boolean;
  /** The cue key she has just finished saying out loud. */
  delivered?: string;
};

/** Applies what a cue means, now that we know the room actually heard it. */
function commit(m: Meeting, key: string) {
  if (m.spoken.includes(key)) return;
  m.spoken.push(key);

  if (key === "open") {
    // The clock starts when she opens the meeting, not when the bot dialled in.
    m.startedAt = Date.now();
    if (m.agenda.length) {
      m.currentIndex = 0;
      m.itemStartedAt = Date.now();
      m.spoken.push(`item:${m.agenda[0].id}`); // the opening already introduced it
    }
  }

  if (key === "wrap") {
    // Read back to the room and not objected to.
    m.actions = m.actions.map((a) => ({ ...a, confirmed: true }));
  }
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
    const item = m.agenda[m.currentIndex];
    for (const line of incoming) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      m.transcript.push({ ...line, agendaItemId: item?.id });
    }
    if (body.delivered) commit(m, body.delivered);
    if (m.status === "joining") m.status = "live";
  });

  const view = () => ({ timer: timerView(meeting), actions: meeting.actions, status: meeting.status });

  if (meeting.status !== "live") return NextResponse.json({ say: null, ...view() });
  // She is still speaking: take the transcript, say nothing more.
  if (body.idle === false) return NextResponse.json({ say: null, ...view() });

  /* ── somebody said her name ───────────────────────────────────────────── */
  const addressed = incoming.filter((l) => isAddressed(l.text)).pop();
  // The opening comes first even so: introducing herself mid-answer is worse than
  // making one person wait two seconds.
  const opened = meeting.spoken.includes("open");

  if (addressed && opened) {
    try {
      const reply = await answerAddressed(meeting, addressed, meeting.transcript.slice(-25));

      if (reply.add_actions?.length || reply.advance) {
        meeting = await updateMeeting((m) => {
          if (reply.add_actions?.length) {
            // Asked for out loud, in front of everybody — treat as agreed.
            m.actions.push(...mergeActions(m.actions, reply.add_actions).map((a) => ({ ...a, confirmed: true })));
          }
          if (reply.advance && m.currentIndex < m.agenda.length) {
            m.currentIndex += 1;
            m.itemStartedAt = Date.now();
          }
        });
      }

      if (reply.say?.trim()) {
        // A reply is a one-off with no bookkeeping behind it, so there is nothing to
        // confirm — it does not carry a key.
        return NextResponse.json({ say: reply.say.trim(), kind: "reply", key: null, ...view() });
      }
      // An empty `say` is her judging the remark was not for her. Fall through to the
      // clock rather than forcing an answer.
    } catch (e) {
      // A model failure must not stop the meeting: she stays quiet, the timekeeper
      // carries on, and the transcript is still being recorded.
      console.warn("[moderator] reply failed:", e instanceof Error ? e.message : e);
    }
  }

  /* ── the clock ────────────────────────────────────────────────────────── */
  const cue = dueCue(meeting);
  if (cue) {
    return NextResponse.json({ say: cue.text, kind: cue.kind, key: cue.key, ...view() });
  }

  return NextResponse.json({ say: null, ...view() });
}
