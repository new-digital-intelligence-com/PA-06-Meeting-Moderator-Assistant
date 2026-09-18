import { NextResponse } from "next/server";
import { GoogleClient } from "@/lib/google";
import { readSession } from "@/lib/session";
import { upcomingMeetings } from "@/lib/workspace";

export const runtime = "nodejs";

/**
 * Today's Meet events, so setting up a meeting is one click instead of pasting a link,
 * a title and six addresses. The invitee list becomes the follow-up's recipients and
 * the people files get shared with.
 */
export async function GET(request: Request) {
  const session = await readSession();
  const google = GoogleClient.fromSession(session);
  if (!google) return NextResponse.json({ error: "Google is not connected." }, { status: 401 });

  const timezone = new URL(request.url).searchParams.get("tz") || "UTC";
  try {
    return NextResponse.json({ meetings: await upcomingMeetings(google, timezone) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Calendar failed." }, { status: 502 });
  }
}
