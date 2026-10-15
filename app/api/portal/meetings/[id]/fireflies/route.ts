import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { earlierFromFireflies, hasFireflies, type FirefliesMeeting } from "@/lib/fireflies";
import { clientMeeting } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/** One earlier meeting as the page shows it. */
const shown = (f: FirefliesMeeting) => ({
  id: f.id,
  title: f.title,
  date: f.dateString,
  minutes: f.duration ? Math.round(f.duration) : null,
  url: f.transcript_url,
  overview: (f.summary?.overview ?? f.summary?.short_summary ?? "").trim(),
  actions: (f.summary?.action_items ?? "").trim(),
  people: (f.meeting_attendees ?? []).map((a) => a.displayName || a.email).filter(Boolean),
});

/**
 * What Fireflies has from before this meeting (lib/fireflies.ts): the same meeting's last
 * times and recent meetings with its people — what her brief's "Last time" is written from,
 * shown on the meeting's page as it is.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which meeting?");
    const meeting = await clientMeeting(clientId, id);
    if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");
    if (!hasFireflies()) return NextResponse.json({ configured: false, series: [], withPeople: [] });
    try {
      const earlier = await earlierFromFireflies(meeting);
      return NextResponse.json({ configured: true, series: earlier.series.map(shown), withPeople: earlier.withPeople.map(shown) });
    } catch (e) {
      return NextResponse.json({ configured: true, series: [], withPeople: [], error: e instanceof Error ? e.message : "Fireflies did not answer." });
    }
  });
}
