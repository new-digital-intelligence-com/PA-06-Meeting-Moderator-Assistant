import { NextResponse } from "next/server";
import { avaEmail, avaGoogle, isRunner } from "@/lib/ava";
import { avaInvites } from "@/lib/workspace";

export const runtime = "nodejs";

/**
 * Her upcoming invites, for the runner deciding which meeting to walk into next.
 *
 * Runner-only: this is her calendar — titles, descriptions, guest lists. Anybody who
 * found the URL could otherwise read it.
 */
export async function GET(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const google = await avaGoogle();
  if (!google) {
    return NextResponse.json(
      { error: "No Google account is connected. Open the control room and Connect Google as Ava." },
      { status: 409 },
    );
  }
  const hours = Number(new URL(request.url).searchParams.get("hours") || 12);
  try {
    return NextResponse.json({ account: await avaEmail(), invites: await avaInvites(google, hours) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Calendar failed." }, { status: 502 });
  }
}
