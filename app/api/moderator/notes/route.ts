import { NextResponse } from "next/server";
import { getMeeting, updateMeeting } from "@/lib/meeting";
import { extractNotes, mergeActions } from "@/lib/moderator";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Enough conversation to be worth a pass; below this there is rarely an action. */
const MIN_NEW_LINES = 8;

/**
 * The note-taker, run from the control room rather than the stage.
 *
 * Deliberately off the speaking path: extraction takes a second or two, and the one
 * thing the stage must never do is stand there silent because it is busy reading. This
 * reads whatever has accumulated since last time and folds any new actions in.
 */
export async function POST(request: Request) {
  let force = false;
  try {
    ({ force = false } = await request.json());
  } catch {
    /* body is optional */
  }

  const meeting = await getMeeting();
  const fresh = meeting.transcript.slice(meeting.notedUpTo);

  if (!fresh.length || (fresh.length < MIN_NEW_LINES && !force)) {
    return NextResponse.json({ actions: meeting.actions, decisions: [], read: 0 });
  }

  try {
    const { actions, decisions } = await extractNotes(meeting, fresh);
    const updated = await updateMeeting((m) => {
      m.actions.push(...mergeActions(m.actions, actions));
      m.notedUpTo = m.transcript.length;
    });
    return NextResponse.json({ actions: updated.actions, decisions, read: fresh.length });
  } catch (e) {
    // Leave notedUpTo alone so the same stretch is retried on the next pass instead of
    // being silently dropped.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Note-taking failed.", actions: meeting.actions },
      { status: 502 },
    );
  }
}

/** Hand-edit the action list — add, correct or drop one. */
export async function PUT(request: Request) {
  let body: { actions?: { id: string; text: string; owner?: string; due?: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const meeting = await updateMeeting((m) => {
    if (body.actions) {
      m.actions = body.actions
        .filter((a) => a.text?.trim())
        .map((a) => ({
          id: a.id,
          text: a.text.trim(),
          owner: a.owner?.trim() || undefined,
          due: a.due?.trim() || undefined,
        }));
    }
  });
  return NextResponse.json({ actions: meeting.actions });
}
