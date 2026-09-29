import { NextResponse } from "next/server";
import { isRunner } from "@/lib/ava";
import { getMeeting, updateMeeting, type TranscriptLine } from "@/lib/meeting";
import { answerForVoice, mergeActions } from "@/lib/moderator";

export const runtime = "nodejs";
export const maxDuration = 30;

/** As much of the end of the conversation as fits, like her turns in /tick. */
const CONTEXT_CHARS = 24_000;

/**
 * Her Live voice asking her memory (AVA_BRAIN=live). GPT-Live holds the conversation and
 * hands over what needs the whole meeting — earlier decisions, a recap, the actions,
 * something to note — and Claude answers from the transcript and the briefing. What she
 * notes down goes into the meeting like any other action.
 */
export async function POST(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const { asked = "" } = (await request.json().catch(() => ({}))) as { asked?: string };

  const meeting = await getMeeting();
  const recent: TranscriptLine[] = [];
  let size = 0;
  for (let i = meeting.transcript.length - 1; i >= 0; i--) {
    size += meeting.transcript[i].speaker.length + meeting.transcript[i].text.length + 3;
    if (size > CONTEXT_CHARS) break;
    recent.push(meeting.transcript[i]);
  }
  recent.reverse();

  try {
    const reply = await answerForVoice(meeting, recent, String(asked).slice(-2000));
    if (reply.add_actions?.length || reply.memory?.trim()) {
      await updateMeeting((m) => {
        if (reply.add_actions?.length) m.actions.push(...mergeActions(m.actions, reply.add_actions));
        if (reply.memory?.trim()) m.memory = reply.memory.trim().slice(0, 1200);
      });
    }
    return NextResponse.json({ say: reply.say?.trim() ?? "" });
  } catch (e) {
    console.warn("[ask] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "model error" }, { status: 502 });
  }
}
