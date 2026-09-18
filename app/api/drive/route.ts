import { NextResponse } from "next/server";
import { GoogleClient } from "@/lib/google";
import { getMeeting, updateMeeting } from "@/lib/meeting";
import { readSession, sessionCookie } from "@/lib/session";
import { fileMeta, searchFiles, shareFile } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

async function client() {
  const session = await readSession();
  return { session, google: GoogleClient.fromSession(session) };
}

/** Find the documents for this meeting. */
export async function GET(request: Request) {
  const { google } = await client();
  if (!google) return NextResponse.json({ error: "Google is not connected." }, { status: 401 });

  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ files: await searchFiles(google, query) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Drive search failed." }, { status: 502 });
  }
}

/**
 * Grant the room access to a file.
 *
 * This is the most consequential thing in the app: every success sends a notification
 * mail from your account and hands somebody a document that was previously private.
 * So it is never triggered by the model or by a spoken phrase — only by the control
 * room, with an explicit list of addresses, and it reports back per address rather
 * than claiming a blanket success.
 */
export async function POST(request: Request) {
  const { session, google } = await client();
  if (!google) return NextResponse.json({ error: "Google is not connected." }, { status: 401 });

  let body: { fileId?: string; emails?: string[]; role?: "reader" | "commenter" | "writer"; notify?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fileId = body.fileId?.trim();
  if (!fileId) return NextResponse.json({ error: "No file selected." }, { status: 400 });

  const meeting = await getMeeting();
  const emails = (body.emails?.length ? body.emails : meeting.recipients)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (!emails.length) {
    return NextResponse.json({ error: "Nobody to share with — add participant emails first." }, { status: 400 });
  }

  try {
    const meta = await fileMeta(google, fileId);
    const results: { email: string; ok: boolean }[] = await shareFile(google, fileId, emails, body.role ?? "reader", body.notify ?? true);
    const granted = results.filter((r) => r.ok).map((r) => r.email);

    const updated = await updateMeeting((m) => {
      const existing = m.files.find((f) => f.id === meta.id);
      if (existing) {
        existing.sharedWith = Array.from(new Set([...existing.sharedWith, ...granted]));
      } else {
        m.files.push({ id: meta.id, name: meta.name, link: meta.link, sharedWith: granted });
      }
    });

    const response = NextResponse.json({ file: meta, results, files: updated.files });
    if (google.dirty) response.cookies.set(sessionCookie({ ...session, google: google.current }));
    return response;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sharing failed." }, { status: 502 });
  }
}
