/**
 * Google Workspace, as the moderator uses it: find the files for this meeting, grant
 * the room access to them, and put the follow-up in your outbox.
 *
 * These are called straight from the control room's routes rather than through a model
 * tool loop. Granting somebody access to a document and sending mail on your behalf are
 * not things to leave to a model's judgement mid-meeting — you press the button.
 */

import { GoogleClient } from "./google";
import { joinLinkIn, platformOf } from "./platform";

const DRIVE = "https://www.googleapis.com/drive/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  link: string;
  modifiedTime?: string;
  owner?: string;
};

type RawDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  owners?: { displayName?: string; emailAddress?: string }[];
};

export async function searchFiles(google: GoogleClient, query: string, limit = 10): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    // Drive's `q` is its own dialect; `name contains` is the useful half of it. Trashed
    // files still match by default, which is never what anybody means.
    q: query.trim() ? `name contains '${query.replace(/'/g, "\\'")}' and trashed = false` : "trashed = false",
    pageSize: String(Math.min(Math.max(limit, 1), 50)),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName,emailAddress))",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await google.request<{ files?: RawDriveFile[] }>(`${DRIVE}/files?${params}`);
  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    link: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    modifiedTime: f.modifiedTime,
    owner: f.owners?.[0]?.displayName ?? f.owners?.[0]?.emailAddress,
  }));
}

export type ShareResult = { email: string; ok: boolean; error?: string };

/**
 * Grants each participant access to one file.
 *
 * Outward-facing and awkward to walk back — the recipient gets a notification mail the
 * moment it succeeds — so the caller confirms first and we report per-address rather
 * than failing the whole batch on one bad address.
 */
export async function shareFile(
  google: GoogleClient,
  fileId: string,
  emails: string[],
  role: "reader" | "commenter" | "writer" = "reader",
  notify = true,
): Promise<ShareResult[]> {
  const results: ShareResult[] = [];
  for (const email of emails) {
    const address = email.trim();
    if (!address) continue;
    try {
      const params = new URLSearchParams({
        sendNotificationEmail: String(notify),
        supportsAllDrives: "true",
        fields: "id",
      });
      await google.request(`${DRIVE}/files/${encodeURIComponent(fileId)}/permissions?${params}`, {
        method: "POST",
        body: JSON.stringify({ type: "user", role, emailAddress: address }),
      });
      results.push({ email: address, ok: true });
    } catch (e) {
      results.push({ email: address, ok: false, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return results;
}

export async function fileMeta(google: GoogleClient, fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,webViewLink,modifiedTime,owners(displayName,emailAddress)",
    supportsAllDrives: "true",
  });
  const f = await google.request<RawDriveFile>(`${DRIVE}/files/${encodeURIComponent(fileId)}?${params}`);
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    link: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
    modifiedTime: f.modifiedTime,
    owner: f.owners?.[0]?.displayName ?? f.owners?.[0]?.emailAddress,
  };
}

/* ------------------------------------------------------------------- gmail */

/**
 * The message Gmail sends. With `html`, the designed version and the plain text travel
 * together (multipart/alternative): mail apps show the HTML, and anything that cannot
 * falls back to the text. Both parts, and the subject, are encoded so that a dash or an
 * accent arrives as written.
 */
function rfc822(to: string, subject: string, body: string, html?: string) {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  const head = [`To: ${to}`, `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`, "MIME-Version: 1.0"];
  const lines = html
    ? (() => {
        const boundary = `ava-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        return [
          ...head,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          b64(body),
          `--${boundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          b64(html),
          `--${boundary}--`,
          "",
        ];
      })()
    : [...head, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64(body)];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function createDraft(google: GoogleClient, to: string, subject: string, body: string, html?: string) {
  const draft = await google.request<{ id: string; message?: { id: string } }>(`${GMAIL}/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw: rfc822(to, subject, body, html) } }),
  });
  return {
    draftId: draft.id,
    // Deep link straight to the draft, so "review it yourself" is one click.
    link: `https://mail.google.com/mail/u/0/#drafts`,
  };
}

export async function sendEmail(google: GoogleClient, to: string, subject: string, body: string, html?: string) {
  const sent = await google.request<{ id: string }>(`${GMAIL}/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: rfc822(to, subject, body, html) }),
  });
  return { messageId: sent.id, to };
}

/* --------------------------------------------------------------- calendar */

type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

/**
 * The link she joins by: the invite's own Google Meet — or, for one sent from Outlook or
 * Teams, the Google Meet or Microsoft Teams link written in it. Empty when there is none.
 */
function joinLink(e: CalendarEvent): string {
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  for (const url of [e.hangoutLink, video]) if (url && platformOf(url)) return url;
  return joinLinkIn(e.location) ?? joinLinkIn(e.description) ?? "";
}

/**
 * Pulls today's Meet and Teams events so the control room can fill the meeting URL, the title and
 * the invitee list from the calendar instead of making you paste three things.
 */
export async function upcomingMeetings(google: GoogleClient, timezone: string) {
  const now = new Date();
  const params = new URLSearchParams({
    timeMin: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    timeMax: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "10",
    timeZone: timezone,
  });
  const data = await google.request<{ items?: CalendarEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
  );
  return (data.items ?? [])
    .map((e) => {
      return {
        id: e.id,
        title: e.summary ?? "(no title)",
        start: e.start?.dateTime ?? e.start?.date ?? "",
        meetingUrl: joinLink(e),
        description: e.description ?? "",
        attendees: (e.attendees ?? []).map((a) => a.email).filter(Boolean),
      };
    })
    .filter((e) => e.meetingUrl);
}

type InviteEvent = Omit<CalendarEvent, "attendees"> & {
  status?: string;
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  recurringEventId?: string;
  attendees?: {
    email: string;
    displayName?: string;
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }[];
};

export type Invite = {
  id: string;
  title: string;
  /** epoch ms */
  start: number;
  end: number;
  meetingUrl: string;
  /** The invite's own description, which becomes her briefing. */
  description: string;
  organizer: string;
  /** The organiser's address: which client the meeting belongs to. */
  organizerEmail: string;
  /** Real people on the invite, not rooms and not her. The notes go to them. */
  guests: { email: string; name?: string }[];
};

/** An invite as her calendar has it, with her own answer to it — see lib/rsvp.ts. */
export type CalendarInvite = Invite & {
  /** Her answer on her calendar: needsAction, accepted, tentative or declined. */
  response: string;
  /** Her address as the invite has it — what she answers as. Null when she cannot answer (not on its guest list herself). */
  self: string | null;
  /** For one occurrence of a recurring meeting: the series, which she answers as a whole. */
  series: string | null;
};

/**
 * The meetings she has been invited to, soonest first.
 *
 * Singled out from `upcomingMeetings` because her needs differ: recurring meetings must
 * be expanded into their actual occurrences (singleEvents does this — parsing recurrence
 * rules by hand is how a weekly stand-up gets silently skipped), and the guest list must
 * exclude meeting rooms and herself or the notes get mailed to a conference room. The ones
 * she declined are listed too, with her answer: she does not go to them, and they are not
 * called off — whoever reads this leaves them out.
 */
export async function avaInvites(google: GoogleClient, hoursAhead = 12, maxResults = 25): Promise<CalendarInvite[]> {
  const now = Date.now();
  const params = new URLSearchParams({
    // A little into the past, so a meeting that started a few minutes ago — or that
    // the runner was restarted during — is still picked up.
    timeMin: new Date(now - 30 * 60_000).toISOString(),
    timeMax: new Date(now + hoursAhead * 60 * 60_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(maxResults),
  });
  const data = await google.request<{ items?: InviteEvent[] }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
  );

  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    // All-day entries are not meetings she can walk into.
    .filter((e) => Boolean(e.start?.dateTime))
    .map((e) => {
      const me = (e.attendees ?? []).find((a) => a.self);
      return {
        // Her own meeting needs no answer; one she is not on the guest list of herself cannot have one.
        response: e.organizer?.self ? "accepted" : (me?.responseStatus ?? "needsAction"),
        self: e.organizer?.self ? null : (me?.email ?? null),
        series: e.recurringEventId ?? null,
        id: e.id,
        title: e.summary ?? "Meeting",
        start: Date.parse(e.start!.dateTime!),
        end: Date.parse(e.end?.dateTime ?? e.start!.dateTime!),
        meetingUrl: joinLink(e),
        description: stripHtml(e.description ?? ""),
        organizer: e.organizer?.displayName || e.organizer?.email || "",
        organizerEmail: (e.organizer?.email ?? "").toLowerCase(),
        guests: (e.attendees ?? [])
          .filter((a) => !a.self && !a.resource && a.email)
          .map((a) => ({ email: a.email.toLowerCase(), name: a.displayName })),
      };
    })
    // Google Meet, as herself, or Microsoft Teams, as a guest: the two she can walk into.
    .filter((e) => platformOf(e.meetingUrl) !== null);
}

/** Calendar descriptions are often HTML; she wants the words. */
function stripHtml(s: string) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
