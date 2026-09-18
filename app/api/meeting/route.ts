import { NextResponse } from "next/server";
import { timerView } from "@/lib/agenda";
import { getMeeting, newId, resetMeeting, updateMeeting, type AgendaItem } from "@/lib/meeting";
import { isConfigured as recallConfigured } from "@/lib/recall";

export const runtime = "nodejs";

/** The whole meeting, plus the derived clock the panels render from. */
export async function GET() {
  const meeting = await getMeeting();
  return NextResponse.json({
    meeting,
    timer: timerView(meeting),
    recallConfigured: recallConfigured(),
  });
}

type Patch = {
  title?: string;
  meetingUrl?: string;
  participants?: string[];
  agenda?: { title: string; minutes: number; owner?: string }[];
};

/**
 * Edit the plan. Only before the bot is in the room — changing the agenda under a
 * running timekeeper would make the cues it has already spoken untrue.
 */
export async function PUT(request: Request) {
  let patch: Patch;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const current = await getMeeting();
  if (current.status === "live" && patch.agenda) {
    return NextResponse.json(
      { error: "The meeting is live — the agenda is fixed once Ava has read it out." },
      { status: 409 },
    );
  }

  const meeting = await updateMeeting((m) => {
    if (patch.title !== undefined) m.title = patch.title.trim() || "Untitled meeting";
    if (patch.meetingUrl !== undefined) m.meetingUrl = patch.meetingUrl.trim();
    if (patch.participants) {
      m.participants = Array.from(
        new Set(patch.participants.map((p) => p.trim().toLowerCase()).filter((p) => p.includes("@"))),
      );
    }
    if (patch.agenda) {
      m.agenda = patch.agenda
        .filter((a) => a.title?.trim())
        .map<AgendaItem>((a) => ({
          id: newId(),
          title: a.title.trim(),
          minutes: Math.min(Math.max(Math.round(a.minutes) || 5, 1), 240),
          owner: a.owner?.trim() || undefined,
        }));
    }
  });

  return NextResponse.json({ meeting, timer: timerView(meeting) });
}

/** Throw it all away and start a new meeting. */
export async function DELETE() {
  const meeting = await resetMeeting();
  return NextResponse.json({ meeting, timer: timerView(meeting) });
}
