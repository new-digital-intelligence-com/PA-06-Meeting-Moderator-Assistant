import { NextResponse } from "next/server";
import { elapsed, getMeeting, updateMeeting } from "@/lib/meeting";
import { RecallError, createBot, publicUrl } from "@/lib/recall";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends Ava to the meeting.
 *
 * The bot knocks as a guest, so somebody already in the call has to let her in. Until
 * they do, Recall reports `in_waiting_room` and the tile does not exist yet. Google
 * now screens suspected bots into a stricter queue, so this is not a formality — if
 * nobody admits her within a couple of minutes she gives up and the bot ends.
 */
export async function POST() {
  const meeting = await getMeeting();

  if (!meeting.meetingUrl) {
    return NextResponse.json({ error: "No meeting link. Paste the Google Meet URL first." }, { status: 400 });
  }
  // Google Meet only, on purpose. Recall would happily take a Zoom or Teams link, but
  // every timing assumption here — how long admission takes, that the captions carry
  // speaker names — was tuned against Meet. Widen this when there is a second platform
  // to test against, not before.
  if (!/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(meeting.meetingUrl)) {
    return NextResponse.json(
      { error: "That is not a Google Meet link. It should look like https://meet.google.com/abc-defg-hij" },
      { status: 400 },
    );
  }
  if (meeting.botId) {
    return NextResponse.json({ error: "Ava is already on her way to this meeting." }, { status: 409 });
  }

  try {
    // Fails loudly here rather than 30 seconds later as a blank tile in the call.
    const stage = `${publicUrl()}/bot`;

    const bot = await createBot(meeting.meetingUrl);

    const updated = await updateMeeting((m) => {
      m.botId = bot.id;
      m.status = "joining";
      // The clock starts when she is admitted and introduces herself, not now — see
      // /api/moderator/tick, which banks the opening once she has actually said it.
    });

    return NextResponse.json({ botId: bot.id, stage, meeting: updated, elapsed: elapsed(updated) });
  } catch (e) {
    if (e instanceof RecallError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not send the bot." },
      { status: 500 },
    );
  }
}
