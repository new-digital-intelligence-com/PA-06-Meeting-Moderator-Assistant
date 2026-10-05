import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import type { Client, MeetingRow } from "@/lib/db";
import { pickedFile } from "@/lib/drive";
import { addDocument, listDocuments } from "@/lib/knowledge";
import { clientMeeting } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel takes request bodies up to 4.5 MB; bigger files come from Google Drive instead. */
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** The client's documents — or, with ?meeting=<id>, the ones added to that meeting's preparation. */
export async function GET(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const meeting = new URL(request.url).searchParams.get("meeting");
    if (meeting && !isUuid(meeting)) throw new HttpError(400, "Which meeting?");
    return NextResponse.json({ documents: await listDocuments(clientId, meeting) });
  });
}

/**
 * Adds documents, one request per file so each has the whole time limit:
 *   a form with `file` (and `meeting`)          an upload from their computer;
 *   { kind: "link", url, meeting }               a web page, PDF or public Google file;
 *   { kind: "drive", token, fileId, meeting }   a file picked in Google's picker, read
 *                                                with the token the picker gave them;
 *   { kind: "text", title, text, meeting }      text written on the page — the title is
 *                                                its first line when none is given.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const client = await getClient(clientId);
    if (!client) throw new HttpError(404, "No such client.");

    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "No file was sent.");
      if (file.size > UPLOAD_MAX_BYTES) {
        throw new HttpError(413, `${file.name} is over 4 MB. Put it in Google Drive and add it from there.`);
      }
      const meeting = await meetingOf(client, form.get("meeting"));
      const document = await addDocument({
        client,
        meeting,
        by: user.email,
        source: { kind: "upload", name: file.name, mime: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) },
      });
      return NextResponse.json({ document });
    }

    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      url?: string;
      token?: string;
      fileId?: string;
      title?: string;
      text?: string;
      meeting?: string;
    };
    const meeting = await meetingOf(client, body.meeting ?? null);
    if (body.kind === "text") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new HttpError(400, "Write something for her first.");
      const first = text.split("\n", 1)[0].trim();
      const title = (typeof body.title === "string" && body.title.trim()) || (first.length > 80 ? `${first.slice(0, 79)}…` : first);
      const document = await addDocument({ client, meeting, by: user.email, source: { kind: "text", title, text } });
      return NextResponse.json({ document });
    }
    if (body.kind === "link") {
      if (!body.url?.trim()) throw new HttpError(400, "Paste a link.");
      const document = await addDocument({ client, meeting, by: user.email, source: { kind: "link", url: body.url.trim() } });
      return NextResponse.json({ document });
    }
    if (body.kind === "drive") {
      if (!body.token || !body.fileId) throw new HttpError(400, "Pick a file in Google Drive.");
      let picked;
      try {
        picked = await pickedFile(body.token, body.fileId);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : "Could not read that file.");
      }
      const document = await addDocument({ client, meeting, by: user.email, source: { kind: "drive", ...picked } });
      return NextResponse.json({ document });
    }
    throw new HttpError(400, "Send a file, a link, a Drive file or some text.");
  });
}

/** The meeting a document is for — one of this client's, or none. */
async function meetingOf(client: Client, raw: FormDataEntryValue | string | null): Promise<MeetingRow | null> {
  if (!raw || typeof raw !== "string") return null;
  if (!isUuid(raw)) throw new HttpError(400, "Which meeting?");
  const meeting = await clientMeeting(client.id, raw);
  if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");
  return meeting;
}
