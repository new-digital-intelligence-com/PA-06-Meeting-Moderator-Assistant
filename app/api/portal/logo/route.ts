import { NextResponse } from "next/server";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { getClient, setLogo } from "@/lib/clients";
import { hasCloudinary, removeLogo, uploadLogo } from "@/lib/cloudinary";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A logo is small: this leaves room under Vercel's 4.5 MB for a request. */
const MAX_BYTES = 2 * 1024 * 1024;

/** What the bytes are, whatever the file's name or the browser says. */
function imageType(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** The client this request is for — the member's own, or ?client=<id> for NDI. */
async function clientOf(request: Request) {
  const { clientId } = await portalClient(request);
  const client = await getClient(clientId);
  if (!client) throw new HttpError(404, "No such client.");
  // Before db/schema.sql's logo line has run, the column is not there to keep it in.
  if (!("logo_url" in client)) {
    throw new HttpError(409, `Logos have nowhere to be kept yet. In Supabase's SQL editor, run: alter table "pa-06".clients add column if not exists logo_url text; notify pgrst, 'reload schema';`);
  }
  return client;
}

/** Sets the client's logo (a form with `file`), replacing the one before — by their own people or by NDI. */
export async function POST(request: Request) {
  return handle(async () => {
    const client = await clientOf(request);
    if (!hasCloudinary()) {
      throw new HttpError(503, "Cloudinary is not set up on this site: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
    }
    const file = (await request.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No image was sent.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "That image is over 2 MB — a logo needs far less.");
    const data = Buffer.from(await file.arrayBuffer());
    const type = imageType(data);
    if (!type) throw new HttpError(415, "A logo has to be a PNG, JPG, WebP or GIF image.");
    const url = await uploadLogo(client.id, { data, type });
    const saved = await setLogo(client.id, url);
    return NextResponse.json({ logo_url: saved.logo_url ?? null });
  });
}

/** Takes the client's logo away: from Cloudinary, then from the client. */
export async function DELETE(request: Request) {
  return handle(async () => {
    const client = await clientOf(request);
    if (client.logo_url && hasCloudinary()) await removeLogo(client.id);
    await setLogo(client.id, null);
    return NextResponse.json({ logo_url: null });
  });
}
