/**
 * How long a sign-in lasts: 30 days. Kept inside the session as well as on the browser's
 * cookie, so a cookie copied off a computer stops working too. No imports: the proxy
 * (proxy.ts) reads it as well as lib/session.ts.
 */

export const SESSION_MS = 30 * 24 * 60 * 60_000;

/**
 * Sessions from before the end date went inside them: accepted until their cookies could
 * last no longer anyway — 30 days after the change — so nobody had to sign in again.
 */
const UNDATED_UNTIL = Date.parse("2026-11-07T00:00:00Z");

/** Whether a session read from its cookie is still within its time. */
export function stillValid(session: { until?: unknown }, now = Date.now()): boolean {
  return typeof session.until === "number" ? now < session.until : now < UNDATED_UNTIL;
}
