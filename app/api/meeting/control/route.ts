import { NextResponse } from "next/server";
import { elapsed, getMeeting, updateMeeting } from "@/lib/meeting";
import { RecallError, leaveCall } from "@/lib/recall";

export const runtime = "nodejs";
export const maxDuration = 60;

type Command =
  | "stop"      // she leaves the call and the meeting is closed
  | "rehearse"; // run her with no bot and no call, to hear her before a room does

export async function POST(request: Request) {
  let command: Command;
  try {
    ({ command } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const before = await getMeeting();

  if (command === "rehearse") {
    const meeting = await updateMeeting((m) => {
      m.status = "live";
      m.botId = undefined;
      m.startedAt = undefined;
      m.endedAt = undefined;
      m.spoken = [];
    });
    return NextResponse.json({ meeting, elapsed: elapsed(meeting) });
  }

  if (before.botId) {
    try {
      await leaveCall(before.botId);
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
  const wasRehearsal = !before.botId;

  const meeting = await updateMeeting((m) => {
    if (wasRehearsal) {
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
  });

  return NextResponse.json({ meeting, elapsed: elapsed(meeting), rehearsal: wasRehearsal });
}
