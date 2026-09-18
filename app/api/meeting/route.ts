import { NextResponse } from "next/server";
import { elapsed, getMeeting, resetMeeting, updateMeeting, type Activity } from "@/lib/meeting";
import { isConfigured as recallConfigured } from "@/lib/recall";

export const runtime = "nodejs";

export async function GET() {
  const meeting = await getMeeting();
  return NextResponse.json({
    meeting,
    elapsed: elapsed(meeting),
    recallConfigured: recallConfigured(),
  });
}

type Patch = {
  title?: string;
  meetingUrl?: string;
  context?: string;
  recipients?: string[];
  activity?: Activity;
};

/** The briefing. Editable right up until she is in the room. */
export async function PUT(request: Request) {
  let patch: Patch;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const meeting = await updateMeeting((m) => {
    if (patch.title !== undefined) m.title = patch.title.trim() || "Untitled meeting";
    if (patch.meetingUrl !== undefined) m.meetingUrl = patch.meetingUrl.trim();
    // Kept editable mid-meeting on purpose: if she is missing something, you can tell
    // her about it there and then and the next answer will know it.
    if (patch.context !== undefined) m.context = patch.context;
    if (patch.activity && ["quiet", "balanced", "active"].includes(patch.activity)) {
      m.activity = patch.activity;
    }
    if (patch.recipients) {
      m.recipients = Array.from(
        new Set(patch.recipients.map((p) => p.trim().toLowerCase()).filter((p) => p.includes("@"))),
      );
    }
  });

  return NextResponse.json({ meeting, elapsed: elapsed(meeting) });
}

export async function DELETE() {
  const meeting = await resetMeeting();
  return NextResponse.json({ meeting, elapsed: 0 });
}
