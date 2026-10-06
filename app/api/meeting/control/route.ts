import { NextResponse } from "next/server";
import { elapsed, getMeeting, updateMeeting } from "@/lib/meeting";
import { RecallError, cancelBot, leaveCall } from "@/lib/recall";
import { isRunner } from "@/lib/ava";

export const runtime = "nodejs";
export const maxDuration = 60;

type Command =
  | "stop"      // she leaves the call and the meeting is closed
  | "rehearse"  // run her with no bot and no call, to hear her before a room does
  | "attend";   // she is in the room in person, in her own signed-in Chrome

// Sending her to a link now is a client's page's: /api/portal/live.

export async function POST(request: Request) {
  let command: Command;
  /** attend: where she came from — her calendar, or sent from a client's page. */
  let from: "calendar" | "dispatch" | undefined;
  try {
    ({ command, from } = await request.json());
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
      m.attendedAt = Date.now();
      // Calendar meetings' notes are emailed to the invite's guests; those she was sent to
      // from a client's page are filed there instead. A calendar meeting was sent from nowhere.
      // Either way the client stays as it was set: by her runner, or by the page that sent her.
      m.attendedFrom = from === "dispatch" ? "dispatch" : "calendar";
      if (from !== "dispatch") m.dispatch = undefined;
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
      m.memory = undefined;
      m.lastDecision = undefined;
      m.summary = undefined;
      m.followUp = undefined;
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
