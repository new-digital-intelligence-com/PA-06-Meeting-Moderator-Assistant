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
import { MAX_SEATS, seatOf, type Where } from "./meeting";
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
      if ((prop !== "request" && prop !== "token") || typeof value !== "function") return value;
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

/* Her screen's address (https://<AVA_SCREEN_HOST>), as her runner gives it with each call —
   where her logs are, one per client. Kept so admin pages can link there; written only
   when it changes. */
const SCREEN = "ava:screen";
let screenSeen: string | null = null;

export async function noteScreen(request: Request): Promise<void> {
  const given = request.headers.get("x-ava-screen")?.trim() ?? "";
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(given) || given === screenSeen) return;
  if ((await redisOrMongoKey(SCREEN).read()) !== given) await redisOrMongoKey(SCREEN).write(given);
  screenSeen = given;
}

export async function avaScreen(): Promise<string | null> {
  return (await redisOrMongoKey(SCREEN).read().catch(() => null)) || null;
}

/**
 * Which of her seats a call from her runner is about (`x-ava-seat`), and the meeting it
 * was started for there (`x-ava-meeting`) — see lib/meeting.ts, Where. A call without them
 * is seat 1's, as every call was before she had seats.
 */
export function runnerAt(request: Request): Where {
  if (!isRunner(request)) return { seat: "1" };
  return { seat: seatOf(request.headers.get("x-ava-seat")), id: request.headers.get("x-ava-meeting")?.trim() || null };
}

/* How many meetings her server can be in at once, as it says with each call (`x-ava-seats`) —
   kept for the pages and for her answers to invites. Written only when it changes. */
const SEATS = "ava:seats";
let seatsSeen: number | null = null;

export async function noteSeats(request: Request): Promise<void> {
  const given = Number(request.headers.get("x-ava-seats"));
  if (!Number.isInteger(given) || given < 1 || given > MAX_SEATS || given === seatsSeen) return;
  if (Number(await redisOrMongoKey(SEATS).read()) !== given) await redisOrMongoKey(SEATS).write(String(given));
  seatsSeen = given;
}

/** Her seats: one until her server says otherwise. */
export async function seatCount(): Promise<number> {
  const n = Number(await redisOrMongoKey(SEATS).read().catch(() => null));
  return Number.isInteger(n) && n >= 1 && n <= MAX_SEATS ? n : 1;
}
