import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { removeDocument } from "@/lib/knowledge";

export const runtime = "nodejs";

/** Removes a document: its passages, and its copy in NDI's Drive. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which document?");
    const removed = await removeDocument(clientId, id);
    if (!removed) throw new HttpError(404, "No such document.");
    return NextResponse.json({ ok: true, wasMeeting: Boolean(removed.meeting_id) });
  });
}
