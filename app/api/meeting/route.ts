import { NextResponse } from "next/server";
import { clientOf, elapsed, getMeeting, resetMeeting, seatOf, startMeeting, updateMeeting, waitingToBeTaken, type Activity, type Meeting } from "@/lib/meeting";
import { isRunner, runnerAt } from "@/lib/ava";
import { langOf } from "@/lib/languages";
import { isConfigured as recallConfigured } from "@/lib/recall";

export const runtime = "nodejs";

/** A seat as a page names it (?seat=), for the older pages that read one meeting. */
const pageSeat = (request: Request) => seatOf(new URL(request.url).searchParams.get("seat"));

export async function GET(request: Request) {
  const meeting = await getMeeting({ seat: pageSeat(request) });
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
  language?: string;
  /** Epoch ms, or null to clear it and have her join as soon as she is sent. */
  joinAt?: number | null;
  /** Her runner, from her calendar: the client she attends for, or null for nobody's. */
  client?: { id: string; name: string; meetingId: string } | null;
  /** Her runner, walking into a calendar meeting: a new meeting in its seat, not an edit of the last. */
  start?: boolean;
};

/**
 * The briefing. Editable right up until she is in the room — and in it: if she is missing
 * something, you can tell her there and then and the next answer will know it.
 *
 * Her runner starts a calendar meeting with it (`start`), in the seat it is about to use:
 * a fresh meeting there — unless a page has just sent her to one in that seat and her
 * runner has not taken it yet, which is kept (409) for the runner to take instead.
 */
export async function PUT(request: Request) {
  let patch: Patch;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const runner = isRunner(request);
  const at = runner ? runnerAt(request) : { seat: pageSeat(request) };
  const apply = (m: Meeting) => {
    if (patch.title !== undefined) m.title = patch.title.trim() || "Untitled meeting";
    if (patch.meetingUrl !== undefined) m.meetingUrl = patch.meetingUrl.trim();
    if (patch.context !== undefined) m.context = patch.context;
    if (patch.language !== undefined) m.language = langOf(patch.language);
    if (patch.activity && ["quiet", "balanced", "active"].includes(patch.activity)) {
      m.activity = patch.activity;
    }
    if (patch.joinAt !== undefined) {
      m.joinAt = typeof patch.joinAt === "number" && patch.joinAt > 0 ? patch.joinAt : undefined;
    }
    // Only her runner says whose meeting it is: it decides whose documents she searches.
    if (patch.client !== undefined && runner) m.client = clientOf(patch.client);
    if (patch.recipients) {
      m.recipients = Array.from(
        new Set(patch.recipients.map((p) => p.trim().toLowerCase()).filter((p) => p.includes("@"))),
      );
    }
  };

  if (runner && patch.start) {
    const fresh = { title: "Untitled meeting" } as Meeting;
    apply(fresh);
    const started = await startMeeting(
      { title: fresh.title, meetingUrl: fresh.meetingUrl ?? "", context: fresh.context ?? "", recipients: fresh.recipients ?? [], language: fresh.language ?? "en", joinAt: fresh.joinAt, client: fresh.client },
      [at.seat ?? "1"],
      (current) => !waitingToBeTaken(current),
    );
    if (!started) return NextResponse.json({ error: "A page has just sent her to a meeting in that seat.", taken: true }, { status: 409 });
    return NextResponse.json({ meeting: started.meeting, elapsed: 0 });
  }

  const meeting = await updateMeeting(apply, at);
  if (at.id && meeting.id !== at.id) return NextResponse.json({ error: "That meeting is over.", gone: true }, { status: 409 });
  return NextResponse.json({ meeting, elapsed: elapsed(meeting) });
}

export async function DELETE(request: Request) {
  const meeting = await resetMeeting(pageSeat(request));
  return NextResponse.json({ meeting, elapsed: 0 });
}
