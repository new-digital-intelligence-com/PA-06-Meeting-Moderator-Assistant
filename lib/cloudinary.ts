/**
 * Clients' logos, kept on Cloudinary: sent from the server, signed with the account's
 * secret (which never reaches a browser), and shown from Cloudinary's CDN, resized there
 * (components/portal/ui.tsx, CompanyLogo).
 *
 * One image per client, always under the same name — pa-06/clients/<client id> — so a new
 * logo replaces the old one, and everything of hers stays apart from whatever else the
 * Cloudinary account holds.
 *
 * Its settings: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or
 * the one line Cloudinary's dashboard gives, CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>.
 */
import crypto from "node:crypto";

type Account = { cloud: string; key: string; secret: string };

function account(): Account | null {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const key = process.env.CLOUDINARY_API_KEY?.trim();
  const secret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (cloud && key && secret) return { cloud, key, secret };
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(process.env.CLOUDINARY_URL?.trim() ?? "");
  return m ? { key: m[1], secret: m[2], cloud: m[3] } : null;
}

export function hasCloudinary(): boolean {
  return account() !== null;
}

/** Where a client's logo lives in the account. */
export const logoId = (clientId: string) => `pa-06/clients/${clientId}`;

/**
 * Cloudinary's signature: every parameter sent except file, cloud_name, resource_type and
 * api_key, as name=value sorted by name and joined with "&", the secret appended, SHA-1.
 */
export function signature(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(base + secret).digest("hex");
}

async function call<T>(action: "upload" | "destroy", params: Record<string, string>, file?: Blob): Promise<T> {
  const a = account();
  if (!a) throw new Error("Cloudinary is not set up: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  const signed = { ...params, timestamp: String(Math.floor(Date.now() / 1000)) };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.set(k, v);
  form.set("api_key", a.key);
  form.set("signature", signature(signed, a.secret));
  if (file) form.set("file", file, "logo");
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(a.cloud)}/image/${action}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`Cloudinary did not take it: ${json.error?.message ?? `HTTP ${res.status}`}`);
  return json;
}

/** Puts a client's logo up — replacing any before it — and returns its address. */
export async function uploadLogo(clientId: string, image: { data: Buffer; type: string }): Promise<string> {
  const done = await call<{ secure_url?: string }>(
    "upload",
    { public_id: logoId(clientId), overwrite: "true" },
    new Blob([new Uint8Array(image.data)], { type: image.type }),
  );
  if (!done.secure_url) throw new Error("Cloudinary did not say where the logo is.");
  return done.secure_url;
}

/** Takes a client's logo down, from the CDN's copies too. Nothing there is not an error. */
export async function removeLogo(clientId: string): Promise<void> {
  await call<{ result?: string }>("destroy", { public_id: logoId(clientId), invalidate: "true" });
}
