/**
 * Where Ava's clients live: Supabase — the team's shared "pocs" project — reached through
 * its Data API with the project's secret key. Server-side only: that key can read and
 * write everything, so it never reaches a browser.
 *
 * The live meeting stays in Redis (lib/store.ts) — a small blob rewritten every couple of
 * seconds. Everything that has to be found again later is here: the clients and who may
 * sign in for them, their documents and the passages she searches, their meetings with
 * the preparation, her brief and the notes.
 *
 * The project is shared, so everything of hers is in a schema of her own, "pa-06"
 * (SUPABASE_SCHEMA): every request goes to it and nowhere else. Its tables, and the
 * functions for what the API cannot express — the passage search, copying her calendar
 * in, the admin page's counts — are in db/schema.sql, pasted once into the SQL editor.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Her schema in the shared project. */
export const SCHEMA = process.env.SUPABASE_SCHEMA?.trim() || "pa-06";

export function hasDb(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// No generated types: rows are given their shapes below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;
const g = globalThis as { __avaDb?: Db };

/** Her schema, through the API: db().from("clients") is "pa-06".clients, and nothing else. */
export function db(): Db {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: clients and their knowledge live in Supabase (see .env.example).");
  }
  g.__avaDb ??= createClient(url, key, {
    db: { schema: SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return g.__avaDb;
}

type Reply<T> = { data: T | null; error: { message: string } | null; count?: number | null };

/** What a request returned — the API reports a failure instead of throwing it, so this throws it. */
export async function rows<T>(request: PromiseLike<Reply<unknown>>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data as T;
}

/** How many rows match, for a request made with { count: "exact", head: true }. */
export async function count(request: PromiseLike<Reply<unknown>>): Promise<number> {
  const { count: n, error } = await request;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

export type Client = {
  id: string;
  name: string;
  domains: string[];
  addresses: string[];
  instructions: string;
  digest: string;
  digest_at: Date | null;
  drive_folder_id: string | null;
  /** Their logo on Cloudinary (lib/cloudinary.ts). Absent until db/schema.sql's logo line has run. */
  logo_url?: string | null;
  status: string;
  created_at: Date;
  created_by: string | null;
};

export type Member = {
  id: string;
  client_id: string;
  email: string;
  name: string | null;
  role: string;
  invited_at: Date;
  last_login_at: Date | null;
};

export type Prep = {
  goal?: string;
  agenda?: string;
  people?: string;
  avoid?: string;
  notes?: string;
};

export type MeetingRow = {
  id: string;
  client_id: string | null;
  event_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date | null;
  meeting_url: string | null;
  organizer: string | null;
  organizer_name: string | null;
  guests: { email: string; name?: string }[];
  description: string;
  status: string;
  prep: Prep;
  prep_at: Date | null;
  brief: string | null;
  brief_at: Date | null;
  notes: { to?: string; subject?: string; body?: string; sentAt?: number; summary?: string; actions?: unknown[] } | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type Knowledge = {
  id: string;
  client_id: string;
  meeting_id: string | null;
  kind: "upload" | "drive" | "link" | "text";
  title: string;
  mime: string | null;
  source: string | null;
  drive_file_id: string | null;
  status: "processing" | "ready" | "failed";
  error: string | null;
  chars: number;
  summary: string | null;
  created_at: Date;
  created_by: string | null;
};

/* The API sends timestamps as text; the rest of the app works with Dates. */

type Raw = Record<string, unknown>;
const at = (v: unknown): Date | null => (v ? new Date(String(v)) : null);

export const asClient = (r: Raw): Client => ({ ...(r as Client), digest_at: at(r.digest_at), created_at: at(r.created_at)! });

export const asMember = (r: Raw): Member => ({ ...(r as Member), invited_at: at(r.invited_at)!, last_login_at: at(r.last_login_at) });

export const asMeeting = (r: Raw): MeetingRow => ({
  ...(r as MeetingRow),
  starts_at: at(r.starts_at)!,
  ends_at: at(r.ends_at),
  prep_at: at(r.prep_at),
  brief_at: at(r.brief_at),
  ended_at: at(r.ended_at),
  created_at: at(r.created_at)!,
  updated_at: at(r.updated_at)!,
});

export const asKnowledge = (r: Raw): Knowledge => ({ ...(r as Knowledge), created_at: at(r.created_at)! });

/** Now, as the API takes a timestamp. */
export const isoNow = () => new Date().toISOString();
