// Applies db/schema.sql to the database in DATABASE_URL (from the environment, or from
// .env.local). Every statement in it is safe to run again.
//
//   node db/migrate.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

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

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  // Several statements in one go: the simple protocol, which takes them as a script.
  await sql.unsafe(fs.readFileSync(path.join(here, "schema.sql"), "utf8")).simple();
  const [{ n }] = await sql`select count(*)::int as n from clients`;
  console.log(`schema applied — ${n} client(s)`);
} finally {
  await sql.end();
}
