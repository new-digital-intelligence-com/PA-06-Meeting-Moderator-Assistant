import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { record } from "@/lib/history";
import { documentText, getDocument, removeDocument } from "@/lib/knowledge";
import { clientMeeting, prepLocked } from "@/lib/schedule";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** One document, and the text she read from it — for its preview. */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which document?");
    const document = await getDocument(clientId, id);
    if (!document) throw new HttpError(404, "No such document.");
    return NextResponse.json({ document, text: await documentText(clientId, id) });
  });
}

/**
 * Removes a document: its passages, and its copy in NDI's Drive. A meeting's own is noted in
 * its history — and stays once the meeting's preparation is locked, as what she had.
 */
export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which document?");
    const document = await getDocument(clientId, id);
    if (!document) throw new HttpError(404, "No such document.");
    if (document.meeting_id) {
      const meeting = await clientMeeting(clientId, document.meeting_id);
      const locked = meeting && prepLocked(meeting);
      if (locked) throw new HttpError(409, locked);
    }
    const removed = await removeDocument(clientId, id);
    if (!removed) throw new HttpError(404, "No such document.");
    if (removed.meeting_id) {
      await record({ meeting_id: removed.meeting_id, kind: "document_removed", by: user.email, detail: { title: removed.title, kind: removed.kind } });
    }
    return NextResponse.json({ ok: true, wasMeeting: Boolean(removed.meeting_id) });
  });
}
