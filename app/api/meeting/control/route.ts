import { NextResponse } from "next/server";
import { timerView } from "@/lib/agenda";
import { getMeeting, updateMeeting } from "@/lib/meeting";
import { RecallError, leaveCall } from "@/lib/recall";

export const runtime = "nodejs";
export const maxDuration = 60;

type Command =
  | "advance" // move to the next agenda item
  | "back" // go back one, for when she jumped the gun
  | "stop" // leave the call and end the meeting
  | "rehearse" // run the moderator with no bot and no meeting
  | "confirm_actions"; // mark everything read back as agreed

/**
 * The chair's override. Every automatic behaviour has a manual counterpart here,
 * because a moderator you cannot overrule is worse than no moderator.
 */
export async function POST(request: Request) {
  let command: Command;
  try {
    ({ command } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const before = await getMeeting();

  if (command === "stop") {
    if (before.botId) {
      try {
        await leaveCall(before.botId);
      } catch (e) {
        // A bot that already left, or was never admitted, 404s here. Ending the
        // meeting locally is still the right outcome.
        if (!(e instanceof RecallError) || e.status < 400 || e.status >= 500) {
          return NextResponse.json(
            { error: e instanceof Error ? e.message : "Could not stop the bot." },
            { status: 502 },
          );
        }
      }
    }
    // A rehearsal has no bot, and nothing said during one is worth keeping. Ending it
    // puts you back on the planning form with the agenda intact, ready to run it for
    // real — rather than in a finished meeting you can only escape by wiping the plan.
    const wasRehearsal = !before.botId;

    const meeting = await updateMeeting((m) => {
      if (wasRehearsal) {
        m.status = "draft";
        m.currentIndex = -1;
        m.startedAt = undefined;
        m.itemStartedAt = undefined;
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
    return NextResponse.json({ meeting, timer: timerView(meeting), rehearsal: wasRehearsal });
  }

  const meeting = await updateMeeting((m) => {
    switch (command) {
      /**
       * Dry run: put the meeting live with no bot and no call.
       *
       * Open /bot in a browser tab and she performs the whole agenda to you — the
       * opening, the item announcements, the time warnings, the read-back — on the
       * real clock. It is the only way to hear the script before a room full of
       * people does, and it costs an Anam session rather than a Recall hour.
       */
      case "rehearse":
        m.status = "live";
        m.botId = undefined;
        m.startedAt = undefined;
        m.itemStartedAt = undefined;
        m.currentIndex = -1;
        m.spoken = [];
        break;
      case "advance":
        if (m.currentIndex < m.agenda.length) {
          m.currentIndex += 1;
          m.itemStartedAt = Date.now();
        }
        break;
      case "back":
        if (m.currentIndex > 0) {
          m.currentIndex -= 1;
          m.itemStartedAt = Date.now();
          // Let her announce it again — she is re-opening the item, not resuming it.
          const item = m.agenda[m.currentIndex];
          m.spoken = m.spoken.filter((k) => !k.startsWith(`item:${item.id}`) && !k.startsWith(`warn:${item.id}`) && !k.startsWith(`over:${item.id}`));
        }
        break;
      case "confirm_actions":
        m.actions = m.actions.map((a) => ({ ...a, confirmed: true }));
        break;
    }
  });

  return NextResponse.json({ meeting, timer: timerView(meeting) });
}
