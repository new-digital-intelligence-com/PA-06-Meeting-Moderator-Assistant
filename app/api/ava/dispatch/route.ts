import { NextResponse } from "next/server";
import { isRunner } from "@/lib/ava";
import { DISPATCH_STALE_MS, getMeeting, seatOf, updateMeeting, type Meeting } from "@/lib/meeting";
import { platformOf } from "@/lib/platform";

export const runtime = "nodejs";

/**
 * Her runner asking "have I been sent anywhere?" — every few seconds, so this reads
 * first and only writes when there is something to take.
 *
 * A page sends her to a meeting in one of her seats (/api/portal/live); her runner says
 * which of its seats are free (`free`), and takes a meeting waiting in one of those.
 * A meeting is handed over once: taking it stamps `takenAt`, so a second runner, or the
 * same one after a restart, does not walk into it twice.
 */
export async function POST(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const { earlySeconds = 60, free = ["1"] } = (await request.json().catch(() => ({}))) as { earlySeconds?: number; free?: unknown[] };
  const seats = [...new Set((Array.isArray(free) ? free : ["1"]).map(seatOf))];

  const now = Date.now();
  const due = (m: Meeting) =>
    Boolean(
      m.dispatch &&
        !m.dispatch.takenAt &&
        (m.status === "joining" || m.status === "scheduled") &&
        m.dispatch.at - earlySeconds * 1000 <= now &&
        now - m.dispatch.at < DISPATCH_STALE_MS &&
        platformOf(m.meetingUrl),
    );

  for (const seat of seats) {
    if (!due(await getMeeting({ seat }))) continue;

    let taken: null | {
      /** The meeting her runner then names in every call about it, with the seat. */
      id: string;
      seat: string;
      meetingUrl: string;
      title: string;
      context: string;
      recipients: string[];
      platform: string | null;
      startsAt: number;
      language: string;
      /** Whose meeting: their documents become searchable to her, and her log is theirs too. */
      client: { id: string; name: string; meetingId: string } | null;
    } = null;
    await updateMeeting(
      (m) => {
        if (!due(m)) return;
        m.dispatch!.takenAt = now;
        taken = {
          id: m.id,
          seat,
          meetingUrl: m.meetingUrl,
          title: m.title,
          context: m.context,
          recipients: m.recipients,
          platform: platformOf(m.meetingUrl),
          startsAt: m.dispatch!.at,
          language: m.language,
          client: m.client ?? null,
        };
      },
      { seat },
    );
    if (taken) return NextResponse.json({ meeting: taken });
  }
  return NextResponse.json({ meeting: null });
}
