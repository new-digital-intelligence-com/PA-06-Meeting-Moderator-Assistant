import { NextResponse } from "next/server";
import { isRunner, runnerAt } from "@/lib/ava";
import { getMeeting, transcriptText, updateMeeting, type Meeting, type TranscriptLine } from "@/lib/meeting";
import { mergeActions } from "@/lib/moderator";

export const runtime = "nodejs";

/** As much of the end of the conversation as fits, like her turns in /tick. */
const CONTEXT_CHARS = 24_000;

type Note = { text?: string; owner?: string; due?: string };

/**
 * The meeting as her memory has it, for GPT-Live's OpenAI backend (AVA_BRAIN=live with
 * an OpenAI delegation model): the transcript so far, the actions and her working
 * notes. With `note`, an action to add first — what she was asked to write down goes
 * into the meeting like any other action.
 */
export async function POST(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const { note } = (await request.json().catch(() => ({}))) as { note?: Note };

  // The meeting in her seat that asked — never another client's in her other seat.
  const at = runnerAt(request);
  let meeting: Meeting;
  if (note?.text?.trim()) {
    meeting = await updateMeeting((m) => {
      m.actions.push(...mergeActions(m.actions, [{ text: note.text!.trim(), owner: note.owner, due: note.due }]));
    }, at);
  } else {
    meeting = await getMeeting(at);
  }
  if (at.id && meeting.id !== at.id) return NextResponse.json({ error: "That meeting is over.", gone: true }, { status: 409 });

  const recent: TranscriptLine[] = [];
  let size = 0;
  for (let i = meeting.transcript.length - 1; i >= 0; i--) {
    size += meeting.transcript[i].speaker.length + meeting.transcript[i].text.length + 3;
    if (size > CONTEXT_CHARS) break;
    recent.push(meeting.transcript[i]);
  }
  recent.reverse();

  const actions = meeting.actions.length
    ? meeting.actions.map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.text}${a.due ? ` (by ${a.due})` : ""}`).join("\n")
    : "(none yet)";
  const record = [
    `Meeting: ${meeting.title}`,
    "",
    "Transcript so far (live captions, oldest first):",
    transcriptText(recent) || "(nothing yet)",
    "",
    `Actions noted:\n${actions}`,
    "",
    `Working notes: ${meeting.memory?.trim() || "(none)"}`,
  ].join("\n");

  return NextResponse.json({ record, noted: Boolean(note?.text?.trim()) });
}
