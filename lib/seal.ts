/**
 * AES-256-GCM with a key derived from SESSION_SECRET: the session cookie, and Ava's Google
 * tokens at rest. Kept apart from session.ts so the proxy can read the cookie without
 * pulling in next/headers.
 */
import crypto from "node:crypto";

const ALG = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set (see .env.example)");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key(), iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

export function decrypt(value: string): string | null {
  try {
    const raw = Buffer.from(value, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const decipher = crypto.createDecipheriv(ALG, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
