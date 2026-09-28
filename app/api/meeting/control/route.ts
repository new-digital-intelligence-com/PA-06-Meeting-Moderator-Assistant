import { NextResponse } from "next/server";
import { elapsed, getMeeting, updateMeeting } from "@/lib/meeting";
import { RecallError, cancelBot, leaveCall } from "@/lib/recall";
import { isRunner } from "@/lib/ava";
import { platformOf } from "@/lib/platform";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

type Command =
  | "stop"      // she leaves the call and the meeting is closed
  | "rehearse"  // run her with no bot and no call, to hear her before a room does
  | "attend"    // she is in the room in person, in her own signed-in Chrome
  | "dispatch"; // send her own Chrome to the meeting link from the control room

export async function POST(request: Request) {
  let command: Command;
  try {
    ({ command } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const before = await getMeeting();

  /**
   * Her own Chrome has walked into the meeting. A fresh run: whatever was left over from
   * the last meeting is cleared, and she is live with no Recall bot behind her. Only the
   * runner may do this — it resets the meeting.
   */
  if (command === "attend") {
    if (!isRunner(request)) {
      return NextResponse.json({ error: "Only her runner can mark her as attending." }, { status: 403 });
    }
    const meeting = await updateMeeting((m) => {
      m.status = "live";
      m.attendedBy = "self";
      m.botId = undefined;
      m.startedAt = undefined;
      m.endedAt = undefined;
      m.spoken = [];
      m.transcript = [];
      m.actions = [];
      m.files = [];
      m.notedUpTo = 0;
      m.lastSpokeAt = undefined;
      m.lastSaid = undefined;
      m.lastSpokeWasOpening = undefined;
      m.inflight = undefined;
      m.lastDecision = undefined;
      m.summary = undefined;
      m.followUp = undefined;
    });
    return NextResponse.json({ meeting, elapsed: elapsed(meeting) });
  }

  /**
   * Send her, from the control room, to whatever link the briefing has — how she gets
   * into a Teams meeting, which never reaches her calendar. Her runner checks for this
   * every few seconds and takes it once; at the briefing's start time if one is set.
   *
   * Only for somebody signed in to the control room: this sends her into a meeting, and
   * a stranger who found the page should not be able to.
   */
  if (command === "dispatch") {
    if (!isRunner(request) && !(await readSession()).google) {
      return NextResponse.json({ error: "Sign in with Google in the control room first." }, { status: 401 });
    }
    if (!platformOf(before.meetingUrl)) {
      return NextResponse.json(
        { error: "That is not a Google Meet or Microsoft Teams link." },
        { status: 400 },
      );
    }
    const at = before.joinAt && before.joinAt > Date.now() ? before.joinAt : Date.now();
    const meeting = await updateMeeting((m) => {
      m.dispatch = { at };
      m.status = at > Date.now() + 60_000 ? "scheduled" : "joining";
      m.attendedBy = undefined;
      m.botId = undefined;
      m.startedAt = undefined;
      m.endedAt = undefined;
    });
    return NextResponse.json({ meeting, elapsed: elapsed(meeting) });
  }

  if (command === "rehearse") {
    const meeting = await updateMeeting((m) => {
      m.status = "live";
      m.attendedBy = undefined;
      m.botId = undefined;
      m.startedAt = undefined;
      m.endedAt = undefined;
      m.spoken = [];
    });
    return NextResponse.json({ meeting, elapsed: elapsed(meeting) });
  }

  if (before.botId) {
    try {
      // A booked bot is waiting, not in a call — it has to be deleted, not hung up.
      if (before.status === "scheduled") await cancelBot(before.botId);
      else await leaveCall(before.botId);
    } catch (e) {
      // A bot that already left, or was never admitted, 404s here. Closing the
      // meeting locally is still the right outcome.
      if (!(e instanceof RecallError) || e.status < 400 || e.status >= 500) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Could not stop the bot." },
          { status: 502 },
        );
      }
    }
  }

  // A rehearsal has no bot and nothing said during one is worth keeping, so ending it
  // returns to the briefing rather than producing a write-up of an empty room.
  const wasRehearsal = !before.botId && before.attendedBy !== "self";
  // Cancelling a booking is not ending a meeting: nothing was said, there is nothing
  // to write up, and the briefing should still be there to rebook.
  const wasBooking = before.status === "scheduled";

  const meeting = await updateMeeting((m) => {
    if (wasRehearsal || wasBooking) {
      m.status = "draft";
      m.startedAt = undefined;
      m.endedAt = undefined;
      m.spoken = [];
      m.transcript = [];
      m.actions = [];
      m.notedUpTo = 0;
    } else {
      m.status = "ended";
      m.endedAt = Date.now();
    }
    m.botId = undefined;
    // Not yet picked up by her runner: now it never will be.
    m.dispatch = undefined;
  });

  return NextResponse.json({
    meeting,
    elapsed: elapsed(meeting),
    rehearsal: wasRehearsal,
    cancelled: wasBooking,
  });
}
