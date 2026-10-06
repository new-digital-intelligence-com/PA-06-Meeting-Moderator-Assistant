/**
 * From a minute before a meeting starts, its preparation is what she walks in with: it no
 * longer changes — not on the page, and not on the server whatever a page sends. Shared by
 * both, so the page locks when the server does.
 */
export const PREP_LOCK_MS = 60_000;

/** When a meeting's preparation locks. */
export const prepLocksAt = (startsAt: Date | string | number) => new Date(startsAt).getTime() - PREP_LOCK_MS;
