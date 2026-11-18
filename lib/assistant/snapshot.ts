/**
 * Whose data the assistant may read for a question, and how it is cut down to fit the
 * prompt. Pure: the data itself is read in lib/assistant/grounding.ts.
 *
 * The page's path only says what the user is looking at. What they may see is decided
 * here from who they are, checked again now: a client always gets their own company,
 * whatever path or id the browser sends.
 */
import type { PortalUser } from "../session";
import { AssistantError, type Asker, type AssistantContext } from "./core";

export const SNAPSHOT_MAX_CHARS = 40_000;

export type Scope =
  | { kind: "preview" }
  /** One client's workspace — theirs, or any client's for an NDI admin. */
  | { kind: "client"; clientId: string; meetingId: string | null; as: "client" | "admin" }
  /** NDI's list of clients (/admin). */
  | { kind: "clients" }
  /** NDI's control room (/): her seats, and the clients. */
  | { kind: "room" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ADMIN_CLIENT = new RegExp(`^/admin/clients/(${UUID})(?:/meetings/(${UUID}))?(?:/|$)`, "i");
const CLIENT_MEETING = new RegExp(`^/client/meetings/(${UUID})(?:/|$)`, "i");
const IS_UUID = new RegExp(`^${UUID}$`, "i");

export async function resolveScope(
  asker: Asker,
  context: AssistantContext,
  check: { access: (email: string) => Promise<PortalUser | null>; isAdmin: (email: string) => boolean },
): Promise<Scope> {
  if (asker.kind === "preview") return { kind: "preview" };
  const { user } = asker;
  if (user.role === "admin") {
    if (!check.isAdmin(user.email)) throw new AssistantError(403, "This address no longer has access.", "forbidden");
    const one = context.path.match(ADMIN_CLIENT);
    if (one) return { kind: "client", clientId: one[1].toLowerCase(), meetingId: one[2]?.toLowerCase() ?? null, as: "admin" };
    if (/^\/admin(\/|$)/.test(context.path)) return { kind: "clients" };
    return { kind: "room" };
  }
  if (user.role !== "client") throw new AssistantError(403, "Client or staff permissions are required.", "forbidden");
  // Checked again, not taken from the session: access can be withdrawn after signing in.
  const access = await check.access(user.email);
  if (!access || access.role !== "client" || !access.clientId) throw new AssistantError(403, "This address no longer has access.", "forbidden");
  const fromPath = context.path.match(CLIENT_MEETING)?.[1];
  const selected = context.selectedId && IS_UUID.test(context.selectedId) ? context.selectedId : null;
  // Only an id: whether that meeting is theirs is checked when it is read.
  return { kind: "client", clientId: access.clientId, meetingId: (fromPath ?? selected)?.toLowerCase() ?? null, as: "client" };
}

/* -------------------------------------------------------------- fitting */

/** Text cut to a length, with a mark where it was cut. */
export function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const STOP = new Set(
  "the and for with what which when where who whom whose this that these those from into about have has had was were are is will would could should can our your their there here them they you she her his him its not but any all how why does did doing done just more most some such than then very also only over under next last meeting meetings ava please tell show give list".split(" "),
);

/** The words of a question worth looking for in the data. */
export function terms(message: string): string[] {
  const words = message.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, 24);
}

const score = (text: string, words: string[]) => words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);

/**
 * The sections, in order of importance, cut to fit `max` characters of JSON: a list that
 * does not fit keeps the items most relevant to the question (then the first ones), in their
 * own order, and says how many were left out.
 */
export function fit(sections: Record<string, unknown>, question: string, max = SNAPSHOT_MAX_CHARS): Record<string, unknown> {
  const words = terms(question);
  const out: Record<string, unknown> = {};
  let used = 2; // {}
  for (const [key, value] of Object.entries(sections)) {
    if (value === undefined) continue;
    const head = JSON.stringify(key).length + 2; // "key": and a comma
    if (Array.isArray(value)) {
      const items = value.map((item, i) => {
        const text = JSON.stringify(item);
        return { item, i, size: text.length + 1, score: score(text.toLowerCase(), words) };
      });
      const total = items.reduce((n, x) => n + x.size, 0) + 2;
      if (used + head + total <= max) {
        out[key] = value;
        used += head + total;
        continue;
      }
      const room = max - used - head - 2 - 40; // and the note of what was left out
      const kept: typeof items = [];
      let size = 0;
      for (const x of [...items].sort((a, b) => b.score - a.score || a.i - b.i)) {
        if (size + x.size > room) continue;
        kept.push(x);
        size += x.size;
      }
      if (!kept.length && room < 0) continue;
      out[key] = kept.sort((a, b) => a.i - b.i).map((x) => x.item);
      out[`${key}_left_out`] = items.length - kept.length;
      used = JSON.stringify(out).length;
      continue;
    }
    const size = JSON.stringify(value).length + 1;
    if (used + head + size <= max) {
      out[key] = value;
      used += head + size;
    } else if (typeof value === "string" && max - used - head > 200) {
      out[key] = clip(value, max - used - head - 20);
      used = JSON.stringify(out).length;
    }
  }
  return out;
}
