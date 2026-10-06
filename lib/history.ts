/**
 * Every meeting's history — what happened to it and who did it — in
 * "pa-06".meeting_history (db/schema.sql), for the client's page:
 *
 *   from the calendar   invited, moved, renamed, described, guests, link, cancelled, restored
 *                       — by the host, seen when her calendar is read (lib/schedule.ts)
 *   from the page       prepared (each version kept), document_added, document_removed,
 *                       sent_now, ended — by whoever was signed in
 *   from her            brief, joined, ended (when she left by herself, and why), notes
 *
 * Append-only. Keeping it never stands in the way of what is being done: a failure — the
 * table not made yet, say — is logged, and the rest goes on.
 */
import crypto from "node:crypto";
import { db } from "./db";

export type HistoryKind =
  | "invited"
  | "moved"
  | "renamed"
  | "described"
  | "guests"
  | "link"
  | "cancelled"
  | "restored"
  | "prepared"
  | "brief"
  | "document_added"
  | "document_removed"
  | "sent_now"
  | "joined"
  | "ended"
  | "notes";

export type HistoryEntry = {
  meeting_id: string;
  kind: HistoryKind;
  by?: string | null;
  detail?: Record<string, unknown>;
  /** For calendar changes: the same change read by two syncs at once is kept once. */
  key?: string | null;
};

export type HistoryRow = { id: number; at: string; kind: HistoryKind; by: string | null; detail: Record<string, unknown> };

const warned = new Set<string>();
const warnOnce = (message: string) => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn("[history] not kept:", message);
};

export async function record(entries: HistoryEntry | HistoryEntry[]): Promise<void> {
  const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e.meeting_id);
  if (!list.length) return;
  const at = new Date().toISOString();
  try {
    // Every row with the same keys: the Data API takes a batch only so.
    const { error } = await db()
      .from("meeting_history")
      .upsert(
        list.map((e) => ({ meeting_id: e.meeting_id, kind: e.kind, by: e.by ?? null, detail: e.detail ?? {}, at, key: e.key ?? null })),
        { onConflict: "key", ignoreDuplicates: true },
      );
    if (error) warnOnce(error.message);
  } catch (e) {
    warnOnce(e instanceof Error ? e.message : String(e));
  }
}

/** A key for one calendar change of one event: the same change, the same key. */
export const changeKey = (eventId: string, kind: HistoryKind, detail: unknown) =>
  crypto.createHash("sha1").update(`${eventId}|${kind}|${JSON.stringify(detail)}`).digest("hex");

/** A meeting's history, oldest first. Empty when there is none, or no table yet. */
export async function meetingHistory(meetingId: string): Promise<HistoryRow[]> {
  try {
    const { data, error } = await db()
      .from("meeting_history")
      .select("id, at, kind, by, detail")
      .eq("meeting_id", meetingId)
      .order("at")
      .order("id")
      .limit(500);
    if (error) {
      warnOnce(error.message);
      return [];
    }
    return (data ?? []) as HistoryRow[];
  } catch {
    return [];
  }
}
