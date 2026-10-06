import { NextResponse } from "next/server";
import { GoogleClient } from "@/lib/google";
import { getMeeting, speakers, updateMeeting, type Meeting } from "@/lib/meeting";
import { renderNotesEmail } from "@/lib/email";
import { botName, composeFollowUp, extractNotes, mergeActions } from "@/lib/moderator";
import { readSession, sessionCookie, type Session } from "@/lib/session";
import { avaEmail, avaGoogle, isRunner } from "@/lib/ava";
import { createDraft, sendEmail } from "@/lib/workspace";
import { hasDb } from "@/lib/db";
import { record } from "@/lib/history";
import { saveNotes } from "@/lib/schedule";

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
  const runner = isRunner(request);
  let meeting = await getMeeting();

  /**
   * Once per meeting.
   *
   * A meeting she attends in person can be ended from two places — the control room's
   * button, and the runner noticing the call is over — and each used to send the notes.
   * Guests got them twice. Anything sent since this meeting started counts as sent; a
   * deliberate resend goes through PUT, which this does not touch.
   */
  if (
    mode === "send" &&
    meeting.followUp?.sentAt &&
    meeting.startedAt &&
    meeting.followUp.sentAt >= meeting.startedAt
  ) {
    return NextResponse.json({
      summary: meeting.summary,
      followUp: meeting.followUp,
      delivered: { sent: true, already: true },
    });
  }

  const { google, sender } = await mailbox(session, runner, meeting.attendedBy === "self");

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
  // A client's meeting: the notes are filed with it, for the client to read back.
  const filed = meeting.client?.meetingId && hasDb() ? meeting.client.meetingId : null;
  if (filed) {
    await saveNotes(filed, { to, subject: written.subject, body: written.body, summary: written.summary, actions: meeting.actions }).catch((e) =>
      console.warn("[followup] notes not filed:", e instanceof Error ? e.message : e),
    );
    await record({ meeting_id: filed, kind: "notes", by: "Ava", detail: { subject: written.subject, actions: meeting.actions.length, sent: false } });
  }

  if (mode === "compose") {
    return NextResponse.json({ summary: written.summary, followUp: meeting.followUp, delivered: null });
  }
  // Sent to it from the control room: its notes are not emailed — they wait there. Only
  // meetings she is invited to on her calendar are, to the invite's guests. (Sending the
  // notes by hand from the control room still works: that is PUT.)
  if (meeting.attendedFrom === "dispatch") {
    return NextResponse.json({ summary: written.summary, followUp: meeting.followUp, delivered: null, notEmailed: true });
  }

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
        ? { sent: true, ...(await sendEmail(google, to, written.subject, written.body, designed(meeting, written.subject, written.body))) }
        : { sent: false, ...(await createDraft(google, to, written.subject, written.body, designed(meeting, written.subject, written.body))) };

    if (mode === "send") {
      const sentAt = Date.now();
      await updateMeeting((m) => {
        if (m.followUp) m.followUp.sentAt = sentAt;
      });
      if (filed) {
        await saveNotes(filed, { sentAt }).catch(() => undefined);
        await record({ meeting_id: filed, kind: "notes", by: "Ava", detail: { subject: written.subject, to, sent: true } });
      }
    }

    const response = NextResponse.json({ summary: written.summary, followUp: meeting.followUp, delivered: result });
    if (google.dirty && google.current.email === session.google?.email) response.cookies.set(sessionCookie({ ...session, google: google.current }));
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
  const meeting = await getMeeting();
  const { google } = await mailbox(session, isRunner(request), meeting.attendedBy === "self");
  if (!google) return NextResponse.json({ error: "Google is not connected." }, { status: 401 });

  const to = (body.to ?? meeting.followUp?.to ?? "").trim();
  const subject = (body.subject ?? meeting.followUp?.subject ?? "").trim();
  const text = (body.body ?? meeting.followUp?.body ?? "").trim();

  if (!to) return NextResponse.json({ error: "No recipients." }, { status: 400 });
  if (!subject || !text) return NextResponse.json({ error: "Write the notes first." }, { status: 400 });

  try {
    const result =
      body.mode === "send"
        ? { sent: true, ...(await sendEmail(google, to, subject, text, designed(meeting, subject, text))) }
        : { sent: false, ...(await createDraft(google, to, subject, text, designed(meeting, subject, text))) };

    await updateMeeting((m) => {
      m.followUp = { to, subject, body: text, sentAt: body.mode === "send" ? Date.now() : m.followUp?.sentAt };
    });

    const response = NextResponse.json(result);
    if (google.dirty && google.current.email === session.google?.email) response.cookies.set(sessionCookie({ ...session, google: google.current }));
    return response;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gmail refused it." }, { status: 502 });
  }
}

/** The NDI-branded version of the notes, built from the text being sent — edits included. */
function designed(m: Meeting, subject: string, body: string) {
  return renderNotesEmail({
    subject,
    body,
    meeting: {
      title: m.title,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      participants: speakers(m).filter((s) => s.toLowerCase() !== botName().toLowerCase()),
    },
    assistant: botName(),
    // The notes are always in English, whatever the meeting was held in.
    language: "en",
  });
}

/**
 * Whose mailbox the notes go out from.
 *
 * Her meetings — the ones she attended in person — are always sent as her, whoever
 * presses the button: the guests met Ava, and the notes should come from Ava rather
 * than from whoever happened to be watching the control room. Anything else goes from
 * the person signed in there.
 *
 * Sending as her needs either the runner's key or somebody signed in to the control
 * room; a caller that merely knows the URL gets neither, since this sends mail.
 */
async function mailbox(session: Session, runner: boolean, herMeeting: boolean) {
  const mine = GoogleClient.fromSession(session);
  if (herMeeting && (runner || mine)) {
    const hers = await avaGoogle();
    if (hers) return { google: hers, sender: (await avaEmail()) ?? "Ava" };
  }
  if (mine) return { google: mine, sender: session.google?.email ?? "the organiser" };
  if (runner) {
    const hers = await avaGoogle();
    if (hers) return { google: hers, sender: (await avaEmail()) ?? "Ava" };
  }
  return { google: null, sender: "the organiser" };
}
