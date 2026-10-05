import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { avaGoogle } from "@/lib/ava";
import { storedFile } from "@/lib/drive";
import { getDocument } from "@/lib/knowledge";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Shown in the browser as they are: they cannot run anything on this site. */
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT = /^text\/|^application\/(json|xml)$/;

/**
 * The kept copy of a document, for its preview — from NDI's Drive, through the site, to
 * the client's own people only. Anything that could run in the page (HTML, SVG, scripts)
 * is sent as plain text or as a download, never as itself.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which document?");
    const document = await getDocument(clientId, id);
    if (!document) throw new HttpError(404, "No such document.");
    if (!document.drive_file_id) throw new HttpError(404, "There is no copy of this one to show — see what she read instead.");
    const google = await avaGoogle();
    if (!google) throw new HttpError(503, "Ava's Google account is not connected.");

    const file = await storedFile(google, document.drive_file_id);
    if (!file) throw new HttpError(413, "This file is too large to show here — see what she read instead.");

    const type = INLINE.has(file.mime) ? file.mime : TEXT.test(file.mime) ? "text/plain; charset=utf-8" : null;
    const name = encodeURIComponent(file.name);
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": type ?? "application/octet-stream",
        "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
