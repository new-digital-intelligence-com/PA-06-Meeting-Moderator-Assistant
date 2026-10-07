/**
 * Clients' files, kept in NDI's Drive: one folder per client inside CLIENTS_DRIVE_FOLDER,
 * written by Ava's own account (which must be an Editor of that folder).
 *
 * Office files and Google files are kept as Google Docs, Sheets and Slides — Drive
 * converts them on the way in, and reading them back as text is then one export, with no
 * parser for .docx or .pptx on this side. PDFs, images and text files are kept as they are.
 */
import { db, rows, type Client } from "./db";
import type { GoogleClient } from "./google";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

/** What a Google file is exported as to be copied, and what its text is exported as. */
export const GOOGLE_TYPES: Record<string, { office: string; text: string }> = {
  [GOOGLE_DOC]: { office: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "text/plain" },
  [GOOGLE_SHEET]: { office: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", text: "text/csv" },
  [GOOGLE_SLIDES]: { office: "application/vnd.openxmlformats-officedocument.presentationml.presentation", text: "text/plain" },
};

/** Office formats, by extension, and the Google type Drive turns each into. */
export const OFFICE: Record<string, string> = {
  docx: GOOGLE_DOC, doc: GOOGLE_DOC, odt: GOOGLE_DOC, rtf: GOOGLE_DOC,
  xlsx: GOOGLE_SHEET, xls: GOOGLE_SHEET, ods: GOOGLE_SHEET,
  pptx: GOOGLE_SLIDES, ppt: GOOGLE_SLIDES, odp: GOOGLE_SLIDES,
};

export const rootFolder = () => process.env.CLIENTS_DRIVE_FOLDER?.trim() || null;

export type DriveItem = { id: string; name: string; mimeType: string; webViewLink?: string };

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findOrMakeFolder(google: GoogleClient, name: string, parent: string): Promise<string> {
  const params = new URLSearchParams({
    q: `name = '${q(name)}' and '${q(parent)}' in parents and mimeType = '${FOLDER}' and trashed = false`,
    fields: "files(id)",
    corpora: "allDrives",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const found = await google.request<{ files?: { id: string }[] }>(`${DRIVE}/files?${params}`);
  if (found.files?.[0]) return found.files[0].id;
  const made = await google.request<{ id: string }>(`${DRIVE}/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
  });
  return made.id;
}

/** The client's folder, made the first time it is needed. Null when no root folder is set. */
export async function clientFolder(google: GoogleClient, client: Client): Promise<string | null> {
  if (client.drive_folder_id) return client.drive_folder_id;
  const root = rootFolder();
  if (!root) return null;
  const id = await findOrMakeFolder(google, client.name, root);
  await rows(db().from("clients").update({ drive_folder_id: id }).eq("id", client.id));
  client.drive_folder_id = id;
  return id;
}

/** Files for one meeting: Meetings/<date> <title> inside the client's folder. */
export async function meetingFolder(
  google: GoogleClient,
  client: Client,
  meeting: { title: string; starts_at: Date },
): Promise<string | null> {
  const base = await clientFolder(google, client);
  if (!base) return null;
  const meetings = await findOrMakeFolder(google, "Meetings", base);
  const name = `${meeting.starts_at.toISOString().slice(0, 10)} ${meeting.title}`.slice(0, 120);
  return findOrMakeFolder(google, name, meetings);
}

/**
 * Uploads bytes (resumable, so size is no concern). With `convertTo`, Drive turns an
 * Office file into that Google type as it lands.
 */
export async function upload(
  google: GoogleClient,
  file: { name: string; mime: string; data: Buffer; parent: string | null; convertTo?: string },
): Promise<DriveItem> {
  const token = await google.token();
  const start = await fetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mime || "application/octet-stream",
      "X-Upload-Content-Length": String(file.data.length),
    },
    body: JSON.stringify({
      name: file.name,
      ...(file.parent ? { parents: [file.parent] } : {}),
      ...(file.convertTo ? { mimeType: file.convertTo } : {}),
    }),
  });
  const session = start.headers.get("location");
  if (!start.ok || !session) throw new Error(`Drive would not take the file: ${(await start.text()).slice(0, 200)}`);
  const put = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": file.mime || "application/octet-stream" },
    body: new Uint8Array(file.data),
  });
  const text = await put.text();
  if (!put.ok) throw new Error(`Drive upload failed: ${text.slice(0, 200)}`);
  return JSON.parse(text) as DriveItem;
}

/** A Google file's text: Docs and Slides as plain text, Sheets every tab as CSV. */
export async function googleText(google: GoogleClient, id: string, mime: string): Promise<string> {
  if (mime === GOOGLE_SHEET) {
    const tabs = await sheetTabs(google, id).catch(() => null);
    if (tabs) return tabs;
  }
  const as = GOOGLE_TYPES[mime]?.text ?? "text/plain";
  const token = await google.token();
  const res = await fetch(`${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(as)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive could not export it as text: ${(await res.text()).slice(0, 200)}`);
  return res.text();
}

/**
 * Every tab of a spreadsheet — Drive's CSV export only gives the first. Needs the Sheets
 * API enabled in the Google project; without it the caller falls back to that export.
 */
async function sheetTabs(google: GoogleClient, id: string): Promise<string> {
  const meta = await google.request<{ sheets?: { properties: { title: string } }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties.title`,
  );
  const titles = (meta.sheets ?? []).map((s) => s.properties.title).slice(0, 20);
  if (!titles.length) return "";
  const ranges = titles.map((t) => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'!A1:Z5000`)}`).join("&");
  const data = await google.request<{ valueRanges?: { values?: string[][] }[] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchGet?${ranges}`,
  );
  return (data.valueRanges ?? [])
    .map((r, i) => {
      const rows = (r.values ?? []).map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","));
      return rows.length ? `## ${titles[i]}\n${rows.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Text Drive can read where we cannot: a scanned PDF or an image, by copying it as a
 * Google Doc (Drive reads the text off the page) and exporting that. The copy goes to
 * Ava's own Drive, where she can delete it again, not to the client's folder.
 */
export async function ocr(google: GoogleClient, id: string): Promise<string> {
  const copy = await google.request<{ id: string }>(`${DRIVE}/files/${encodeURIComponent(id)}/copy?supportsAllDrives=true&fields=id`, {
    method: "POST",
    body: JSON.stringify({ name: "ava-reading (temporary)", mimeType: GOOGLE_DOC, parents: ["root"] }),
  });
  try {
    return await googleText(google, copy.id, GOOGLE_DOC);
  } finally {
    await remove(google, copy.id);
  }
}

/** Deletes a file; failing that (a shared drive may not allow it), moves it to the bin. */
export async function remove(google: GoogleClient, id: string): Promise<void> {
  try {
    await google.request(`${DRIVE}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: "DELETE" });
  } catch {
    await google
      .request(`${DRIVE}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
        method: "PATCH",
        body: JSON.stringify({ trashed: true }),
      })
      .catch((e) => console.warn("[drive] could not remove", id, e instanceof Error ? e.message : e));
  }
}

/** Largest file sent back for a preview: it goes through the site whole, held in memory. */
export const PREVIEW_MAX_BYTES = 4.3 * 1024 * 1024;

/**
 * A kept copy, to show the client: Google Docs, Sheets and Slides as a PDF, anything else
 * as it is. Null when it is too large to send back through the site.
 */
export async function storedFile(google: GoogleClient, id: string): Promise<{ name: string; mime: string; data: Buffer } | null> {
  const meta = await google.request<{ name: string; mimeType: string; size?: string }>(
    `${DRIVE}/files/${encodeURIComponent(id)}?fields=name,mimeType,size&supportsAllDrives=true`,
  );
  if (Number(meta.size ?? 0) > PREVIEW_MAX_BYTES) return null;
  const asPdf = Boolean(GOOGLE_TYPES[meta.mimeType]);
  const token = await google.token();
  const res = await fetch(
    asPdf
      ? `${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=application%2Fpdf`
      : `${DRIVE}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive would not give back the file (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > PREVIEW_MAX_BYTES) return null;
  return { name: meta.name, mime: asPdf ? "application/pdf" : meta.mimeType, data };
}

/** Largest file taken from a client's Drive. */
export const PICK_MAX_BYTES = 30 * 1024 * 1024;

/**
 * A file the client picked in Google's file picker, read with the token the picker gave
 * their browser — that token reaches the picked files and nothing else (drive.file).
 * Google files come back as their Office equivalent, to be converted back on upload.
 */
export async function pickedFile(token: string, id: string): Promise<{ name: string; mime: string; data: Buffer; convertTo?: string; link?: string }> {
  const auth = { Authorization: `Bearer ${token}` };
  const metaRes = await fetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`, { headers: auth });
  if (!metaRes.ok) throw new Error(`Google Drive would not show that file (${metaRes.status}).`);
  const meta = (await metaRes.json()) as { name: string; mimeType: string; size?: string; webViewLink?: string };
  if (Number(meta.size ?? 0) > PICK_MAX_BYTES) throw new Error(`${meta.name} is larger than ${PICK_MAX_BYTES / 1024 / 1024} MB.`);

  const google = GOOGLE_TYPES[meta.mimeType];
  if (meta.mimeType.startsWith("application/vnd.google-apps.") && !google) {
    throw new Error(`${meta.name} is a kind of Google file Ava cannot read yet.`);
  }
  const url = google
    ? `${DRIVE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(google.office)}`
    : `${DRIVE}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`Could not download ${meta.name} (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  return {
    name: meta.name,
    mime: google ? google.office : meta.mimeType,
    data,
    convertTo: google ? meta.mimeType : undefined,
    link: meta.webViewLink,
  };
}
