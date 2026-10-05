/**
 * Where Ava's clients live: Postgres (Supabase), schema in db/schema.sql.
 *
 * The live meeting stays in Redis (lib/store.ts) — a small blob rewritten every couple of
 * seconds. Everything that has to be found again later is here: the clients and who may
 * sign in for them, their documents and the passages she searches, their meetings with
 * the preparation, her brief and the notes.
 *
 * Connect through Supabase's transaction pooler (port 6543): serverless functions open
 * and drop connections constantly, and the pooler is what absorbs that. It does not keep
 * prepared statements between transactions, hence `prepare: false`.
 *
 * The database is shared with other projects. Everything of hers is in one schema of her
 * own, "pa-06", and every query names it (`table()`): never the search path, which the
 * pooler does not carry from one transaction to the next, and which would happily find
 * another project's `clients` or `meetings` instead.
 */
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

/** Her schema — created by db/migrate.mjs; nothing of hers lives outside it. */
export const SCHEMA = "pa-06";

const g = globalThis as { __avaSql?: Sql; __avaVector?: Promise<string> };

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function db(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: clients and their knowledge live in Postgres (see .env.example).");
  // One pool per server instance, kept across hot reloads in development.
  g.__avaSql ??= postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
  return g.__avaSql;
}

type Table = "clients" | "members" | "meetings" | "knowledge" | "chunks" | "login_tokens";

/** One of her tables, schema and all, to put in a query: db()`select * from ${table("clients")}`. */
export const table = (name: Table) => db()(`${SCHEMA}.${name}`);

/**
 * pgvector's schema ("extensions" on Supabase), asked once per instance: the vector type
 * and its distance operator are named with it, for the same reason as the tables.
 */
export function vectorSchema(): Promise<string> {
  g.__avaVector ??= db()<{ schema: string }[]>`
    select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`
    .then(([row]) => {
      if (!row) throw new Error("pgvector is not enabled in this database (Supabase: Database → Extensions → vector).");
      return row.schema;
    })
    .catch((e) => {
      g.__avaVector = undefined;
      throw e;
    });
  return g.__avaVector;
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
  kind: "upload" | "drive" | "link";
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
