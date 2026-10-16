import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { earlierFromFireflies, hasFireflies, importOne, transcriptOf, type FirefliesMeeting } from "@/lib/fireflies";
import { clientMeeting } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** One earlier meeting as the page shows it. */
const shown = (f: FirefliesMeeting) => ({
  id: f.id,
  title: f.title,
  date: f.dateString,
  minutes: f.duration ? Math.round(f.duration) : null,
  overview: (f.summary?.overview ?? f.summary?.short_summary ?? "").trim(),
  actions: (f.summary?.action_items ?? "").trim(),
});

/**
 * What Fireflies has from before this meeting (lib/fireflies.ts): the same meeting's latest
 * times — what her brief's "Last time" is written from — shown on the meeting's page.
 *
 * `?transcript=<id>`: one recording's transcript, through the API — only this meeting's own
 * (Fireflies' notes kept with it) or one of its last times. The key reads every meeting its
 * account recorded; a client sees only theirs.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which meeting?");
    const meeting = await clientMeeting(clientId, id);
    if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");
    if (!hasFireflies()) return NextResponse.json({ configured: false, series: [] });

    const wanted = new URL(request.url).searchParams.get("transcript");
    if (wanted) {
      const own = (meeting.notes as { fireflies?: { id?: string } } | null)?.fireflies?.id === wanted;
      const earlier = own ? null : await earlierFromFireflies(meeting);
      if (!own && !earlier?.series.some((f) => f.id === wanted)) throw new HttpError(404, "That recording is not one of this meeting's.");
      try {
        return NextResponse.json({ transcript: await transcriptOf(wanted) });
      } catch (e) {
        throw new HttpError(502, e instanceof Error ? e.message : "Fireflies did not answer.");
      }
    }

    try {
      const earlier = await earlierFromFireflies(meeting);
      return NextResponse.json({ configured: true, series: earlier.series.map(shown) });
    } catch (e) {
      return NextResponse.json({ configured: true, series: [], error: e instanceof Error ? e.message : "Fireflies did not answer." });
    }
  });
}

/**
 * Import from Fireflies: one of their meetings that is over, brought in when somebody asks —
 * its summary, action items, attendees and transcript (searchable in later meetings).
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which meeting?");
    const meeting = await clientMeeting(clientId, id);
    if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");
    if (!hasFireflies()) throw new HttpError(503, "Fireflies is not connected.");
    if (meeting.starts_at.getTime() > Date.now()) throw new HttpError(400, "It has not happened yet.");
    const { outcome, minutes } = await importOne(meeting);
    if (outcome === "none") throw new HttpError(404, "Fireflies has no recording of this meeting — it was not in it.");
    if (outcome === "silent") {
      const stayed = minutes ? ` for ${minutes} minute${minutes === 1 ? "" : "s"}` : "";
      throw new HttpError(404, `Fireflies was in the call${stayed}, but heard nobody speak — it has no transcript or summary of it, so there is nothing to bring in.`);
    }
    if (outcome === "pending") throw new HttpError(409, "Fireflies recorded it but has not written it up yet — try again in a few minutes.");
    return NextResponse.json({ ok: true });
  });
}
