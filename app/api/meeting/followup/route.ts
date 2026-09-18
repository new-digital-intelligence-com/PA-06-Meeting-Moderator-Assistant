import { NextResponse } from "next/server";
import { GoogleClient } from "@/lib/google";
import { getMeeting, updateMeeting } from "@/lib/meeting";
import { composeFollowUp, extractNotes, mergeActions } from "@/lib/moderator";
import { readSession, sessionCookie } from "@/lib/session";
import { createDraft, sendEmail } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Write the notes and put them in the recipients' inboxes.
 *
 * `mode` decides how far it goes: "compose" stops at the text so you can read it,
 * "draft" leaves it in your Gmail drafts, "send" actually posts it. The control room
 * runs compose-then-send automatically when you end a meeting, which is the flow you
 * asked for — but the text is kept and shown either way, so a send you did not want is
 * visible rather than mysterious.
 */
export async function POST(request: Request) {
  let mode: "compose" | "draft" | "send" = "compose";
  try {
    ({ mode = "compose" } = await request.json());
  } catch {
    /* body is optional */
  }

  const session = await readSession();
  const sender = session.google?.email ?? "the organiser";
  let meeting = await getMeeting();

  if (!meeting.transcript.length) {
    return NextResponse.json({ error: "Nothing was transcribed, so there is nothing to write up." }, { status: 400 });
  }

  // Anything said since the last note pass has not been read yet; a meeting that ends
  // right after a decision would otherwise lose it.
  const tail = meeting.transcript.slice(meeting.notedUpTo);
  if (tail.length) {
    try {
      const { actions } = await extractNotes(meeting, tail);
      meeting = await updateMeeting((m) => {
        m.actions.push(...mergeActions(m.actions, actions));
        m.notedUpTo = m.transcript.length;
      });
    } catch {
      /* the write-up still has the full transcript to work from */
    }
  }

  let written;
  try {
    written = await composeFollowUp(meeting, sender);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not write the notes." },
      { status: 502 },
    );
  }

  const to = meeting.recipients.join(", ");
  meeting = await updateMeeting((m) => {
    m.summary = written.summary;
    m.followUp = { to, subject: written.subject, body: written.body };
  });

  if (mode === "compose") {
    return NextResponse.json({ summary: written.summary, followUp: meeting.followUp, delivered: null });
  }

  const google = GoogleClient.fromSession(session);
  if (!google) return NextResponse.json({ error: "Google is not connected." }, { status: 401 });
  if (!to) {
    return NextResponse.json(
      { error: "No recipients — nobody to send the notes to.", summary: written.summary, followUp: meeting.followUp },
      { status: 400 },
    );
  }

  try {
    const result =
      mode === "send"
        ? { sent: true, ...(await sendEmail(google, to, written.subject, written.body)) }
        : { sent: false, ...(await createDraft(google, to, written.subject, written.body)) };

    if (mode === "send") {
      await updateMeeting((m) => {
        if (m.followUp) m.followUp.sentAt = Date.now();
      });
    }

    const response = NextResponse.json({ summary: written.summary, followUp: meeting.followUp, delivered: result });
    if (google.dirty) response.cookies.set(sessionCookie({ ...session, google: google.current }));
    return response;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Gmail refused it.", summary: written.summary, followUp: meeting.followUp },
      { status: 502 },
    );
  }
}

/** Re-send after you have edited the text by hand. */
export async function PUT(request: Request) {
  let body: { mode?: "draft" | "send"; to?: string; subject?: string; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const session = await readSession();
  const google = GoogleClient.fromSession(session);
  if (!google) return NextResponse.json({ error: "Google is not connected." }, { status: 401 });

  const meeting = await getMeeting();
  const to = (body.to ?? meeting.followUp?.to ?? "").trim();
  const subject = (body.subject ?? meeting.followUp?.subject ?? "").trim();
  const text = (body.body ?? meeting.followUp?.body ?? "").trim();

  if (!to) return NextResponse.json({ error: "No recipients." }, { status: 400 });
  if (!subject || !text) return NextResponse.json({ error: "Write the notes first." }, { status: 400 });

  try {
    const result =
      body.mode === "send"
        ? { sent: true, ...(await sendEmail(google, to, subject, text)) }
        : { sent: false, ...(await createDraft(google, to, subject, text)) };

    await updateMeeting((m) => {
      m.followUp = { to, subject, body: text, sentAt: body.mode === "send" ? Date.now() : m.followUp?.sentAt };
    });

    const response = NextResponse.json(result);
    if (google.dirty) response.cookies.set(sessionCookie({ ...session, google: google.current }));
    return response;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail refused it." }, { status: 502 });
  }
}
