import { NextResponse } from "next/server";
import { isRunner } from "@/lib/ava";
import { getMeeting, updateMeeting } from "@/lib/meeting";
import { platformOf } from "@/lib/platform";

export const runtime = "nodejs";

/** Sent more than this long ago and still not taken: the runner was off. Let it go. */
const STALE_MS = 30 * 60_000;

/**
 * Her runner asking "have I been sent anywhere?" — every few seconds, so this reads
 * first and only writes when there is something to take.
 *
 * A meeting is handed over once: taking it stamps `takenAt`, so a second runner, or the
 * same one after a restart, does not walk into it twice.
 */
export async function POST(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const { earlySeconds = 60 } = (await request.json().catch(() => ({}))) as { earlySeconds?: number };

  const now = Date.now();
  const due = (m: Awaited<ReturnType<typeof getMeeting>>) =>
    Boolean(
      m.dispatch &&
        !m.dispatch.takenAt &&
        (m.status === "joining" || m.status === "scheduled") &&
        m.dispatch.at - earlySeconds * 1000 <= now &&
        now - m.dispatch.at < STALE_MS &&
        platformOf(m.meetingUrl),
    );

  if (!due(await getMeeting())) return NextResponse.json({ meeting: null });

  let taken: null | {
    meetingUrl: string;
    title: string;
    context: string;
    recipients: string[];
    platform: string | null;
    startsAt: number;
  } = null;
  await updateMeeting((m) => {
    if (!due(m)) return;
    m.dispatch!.takenAt = now;
    taken = {
      meetingUrl: m.meetingUrl,
      title: m.title,
      context: m.context,
      recipients: m.recipients,
      platform: platformOf(m.meetingUrl),
      startsAt: m.dispatch!.at,
    };
  });
  return NextResponse.json({ meeting: taken });
}
