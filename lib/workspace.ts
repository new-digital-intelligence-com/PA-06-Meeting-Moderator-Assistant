/**
 * Google Workspace, as the moderator uses it: find the files for this meeting, grant
 * the room access to them, and put the follow-up in your outbox.
 *
 * These are called straight from the control room's routes rather than through a model
 * tool loop. Granting somebody access to a document and sending mail on your behalf are
 * not things to leave to a model's judgement mid-meeting — you press the button.
 */

import { GoogleClient } from "./google";

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

function rfc822(to: string, subject: string, body: string) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function createDraft(google: GoogleClient, to: string, subject: string, body: string) {
  const draft = await google.request<{ id: string; message?: { id: string } }>(`${GMAIL}/drafts`, {
    method: "POST",
    body: JSON.stringify({ message: { raw: rfc822(to, subject, body) } }),
  });
  return {
    draftId: draft.id,
    // Deep link straight to the draft, so "review it yourself" is one click.
    link: `https://mail.google.com/mail/u/0/#drafts`,
  };
}

export async function sendEmail(google: GoogleClient, to: string, subject: string, body: string) {
  const sent = await google.request<{ id: string }>(`${GMAIL}/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw: rfc822(to, subject, body) }),
  });
  return { messageId: sent.id, to };
}

/* --------------------------------------------------------------- calendar */

type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

/**
 * Pulls today's Meet events so the control room can fill the meeting URL, the title and
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
      const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
      return {
        id: e.id,
        title: e.summary ?? "(no title)",
        start: e.start?.dateTime ?? e.start?.date ?? "",
        meetingUrl: e.hangoutLink ?? video ?? "",
        description: e.description ?? "",
        attendees: (e.attendees ?? []).map((a) => a.email).filter(Boolean),
      };
    })
    .filter((e) => e.meetingUrl);
}
