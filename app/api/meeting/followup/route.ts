import { NextResponse } from "next/server";
import { GoogleClient } from "@/lib/google";
import { getMeeting, updateMeeting } from "@/lib/meeting";
import { composeFollowUp } from "@/lib/moderator";
import { readSession, sessionCookie } from "@/lib/session";
import { createDraft, sendEmail } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Write the minutes and the follow-up. Nothing leaves the building here. */
export async function POST() {
  const meeting = await getMeeting();
  if (!meeting.transcript.length) {
    return NextResponse.json({ error: "There is no transcript to write up yet." }, { status: 400 });
  }

  const session = await readSession();
  const sender = session.google?.email ?? "the organiser";

  try {
    const { minutes, subject, body } = await composeFollowUp(meeting, sender);
    const to = meeting.participants.join(", ");
    const updated = await updateMeeting((m) => {
      m.minutes = minutes;
      m.followUp = { to, subject, body };
    });
    return NextResponse.json({ minutes, followUp: updated.followUp });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not write the follow-up." },
      { status: 502 },
    );
  }
}

/**
 * Put it in your outbox.
 *
 * `draft` is the default and the one to reach for: it lands in Gmail for you to read
 * before anybody else sees it. `send` is irreversible and only happens when the
 * control room asks for it by name, with the body it just showed you.
 */
export async function PUT(request: Request) {
  let body: { mode?: "draft" | "send"; to?: string; subject?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const session = await readSession();
  const google = GoogleClient.fromSession(session);
  if (!google) {
    return NextResponse.json({ error: "Google is not connected." }, { status: 401 });
  }

  const meeting = await getMeeting();
  const to = (body.to ?? meeting.followUp?.to ?? "").trim();
  const subject = (body.subject ?? meeting.followUp?.subject ?? "").trim();
  const text = (body.body ?? meeting.followUp?.body ?? "").trim();

  if (!to) return NextResponse.json({ error: "No recipients." }, { status: 400 });
  if (!subject || !text) return NextResponse.json({ error: "Write the follow-up first." }, { status: 400 });

  try {
    const result =
      body.mode === "send"
        ? { sent: true, ...(await sendEmail(google, to, subject, text)) }
        : { sent: false, ...(await createDraft(google, to, subject, text)) };

    await updateMeeting((m) => {
      m.followUp = { to, subject, body: text };
    });

    const response = NextResponse.json(result);
    if (google.dirty) response.cookies.set(sessionCookie({ ...session, google: google.current }));
    return response;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail refused it." }, { status: 502 });
  }
}
