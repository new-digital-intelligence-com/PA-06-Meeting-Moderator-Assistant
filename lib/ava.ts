/**
 * Ava's own Google account, held on the server.
 *
 * Everything she does before and after a meeting — reading the invites on her calendar,
 * mailing the notes, sharing files — has to happen with nobody's browser open. A token
 * that only lives in the control room's cookie is gone the moment that tab closes, so
 * whichever account connects in the control room is also kept here, encrypted with
 * SESSION_SECRET. Connect as ava@ and she reads her own calendar and sends as herself.
 *
 * The runner — her Chrome, on whatever machine hosts it — reaches these through routes
 * that demand AVA_RUNNER_KEY. They expose her calendar and can send mail, so they must
 * never be callable by anyone who merely finds the URL.
 */

import { GoogleClient } from "./google";
import { decrypt, encrypt, type GoogleTokens } from "./session";
import { redisOrMongoKey } from "./store";

const KEY = "google:ava";

export async function saveAvaGoogle(tokens: GoogleTokens): Promise<void> {
  // Keep an existing refresh token: Google only issues one on the first consent, and
  // losing it means she silently stops being able to act after an hour.
  const existing = await loadTokens();
  const merged: GoogleTokens = { ...tokens, refresh_token: tokens.refresh_token ?? existing?.refresh_token };
  await redisOrMongoKey(KEY).write(encrypt(JSON.stringify(merged)));
}

async function loadTokens(): Promise<GoogleTokens | null> {
  const raw = await redisOrMongoKey(KEY).read();
  if (!raw) return null;
  const plain = decrypt(raw);
  if (!plain) return null;
  try {
    return JSON.parse(plain) as GoogleTokens;
  } catch {
    return null;
  }
}

/** A client acting as her, refreshing as needed and saving what it refreshes. */
export async function avaGoogle(): Promise<GoogleClient | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  const client = new GoogleClient(tokens);
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "request" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        if (target.dirty) await saveAvaGoogle(target.current).catch(() => undefined);
        return out;
      };
    },
  });
}

export async function avaEmail(): Promise<string | null> {
  return (await loadTokens())?.email ?? null;
}

/** True when the request carries the runner's key. */
export function isRunner(request: Request): boolean {
  const expected = process.env.AVA_RUNNER_KEY;
  if (!expected) return false;
  return request.headers.get("x-ava-key") === expected;
}
