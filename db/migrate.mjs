// Applies db/schema.sql to the database in DATABASE_URL (from the environment, or from
// .env.local). Every statement in it is safe to run again.
//
//   npm run db:migrate
//
// The database is shared with other projects: this creates and changes only Ava's schema,
// "pa-06". It does not install pgvector — that is a database-wide switch for whoever runs
// the database (Supabase: Database → Extensions → vector) — it only checks it is there.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const SCHEMA = "pa-06";
const here = path.dirname(fileURLToPath(import.meta.url));
let url = process.env.DATABASE_URL;
if (!url) {
  const env = path.join(here, "..", ".env.local");
  const line = fs.existsSync(env) ? fs.readFileSync(env, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")) : null;
  url = line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}
if (!url) {
  console.error("DATABASE_URL is not set (nor in .env.local).");
  process.exit(1);
}

const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  const [vector] = await sql`
    select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`;
  if (!vector) {
    console.error("pgvector is not enabled in this database. Enable it once (Supabase: Database → Extensions → vector) and run this again. Nothing was changed.");
    process.exitCode = 1;
  } else {
    // One transaction: all of it or none. The search path only lets the script find
    // pgvector's type and operator class; every table is named with its schema anyway.
    const script = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
    await sql
      .unsafe(`begin;\nset local search_path to ${quote(SCHEMA)}, ${quote(vector.schema)};\n${script}\ncommit;`)
      .simple();
    const tables = await sql`select table_name from information_schema.tables where table_schema = ${SCHEMA} order by table_name`;
    const [{ n }] = await sql`select count(*)::int as n from ${sql(`${SCHEMA}.clients`)}`;
    console.log(`schema "${SCHEMA}" ready: ${tables.map((t) => t.table_name).join(", ")} — ${n} client(s). pgvector is in "${vector.schema}".`);
  }
} finally {
  await sql.end();
}
