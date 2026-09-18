/**
 * Where the meeting lives.
 *
 * Two clients write to it constantly and they are not in the same place: the stage runs
 * inside Recall's browser, the control room in yours, and on a serverless host neither
 * request is guaranteed to land on the same instance twice. So the state cannot sit in
 * a module variable, and it cannot sit on disk — Vercel's filesystem is read-only and
 * its instances do not share one.
 *
 * Three backends, picked by what is in the environment, in this order:
 *
 *   Redis   (Vercel KV / Upstash)  when the REST credentials are set
 *   MongoDB (Atlas or anywhere)    when MONGODB_URI is set
 *   a file  (data/meeting.json)    otherwise — local dev, no services to set up
 *
 * Redis first because it suits this shape best: one small blob rewritten every couple
 * of seconds, over HTTP, with no connection to pool and no cold-start handshake. Mongo
 * is there because a cluster you already have beats a service you have to sign up for,
 * and its findOneAndUpdate is atomic enough to hold the lock.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type StoreKind = "redis" | "mongo" | "file";

export type Store = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  /** Read-modify-write, serialised against every other writer. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  readonly kind: StoreKind;
};

const KEY = "meeting:current";
const LOCK = "meeting:lock";
/** Long enough for a slow write, short enough that a crashed holder frees it fast. */
const LOCK_MS = 5000;

function redisCreds() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/* ------------------------------------------------------------------- redis */

function redisStore(creds: { url: string; token: string }): Store {
  const command = async <T>(args: (string | number)[]): Promise<T> => {
    const res = await fetch(creds.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || json.error) throw new Error(`Redis: ${json.error ?? res.status}`);
    return json.result as T;
  };

  // Releasing by DEL alone would let a slow holder delete a lock that has since expired
  // and been taken by somebody else. Check the token in the same breath as the delete.
  const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

  return {
    kind: "redis",
    async read() {
      return command<string | null>(["GET", KEY]);
    },
    async write(value) {
      await command(["SET", KEY, value]);
    },
    async withLock(fn) {
      const token = crypto.randomBytes(12).toString("hex");
      const deadline = Date.now() + LOCK_MS;

      let held = false;
      while (Date.now() < deadline) {
        const got = await command<string | null>(["SET", LOCK, token, "NX", "PX", String(LOCK_MS)]);
        if (got === "OK") {
          held = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      // Proceeding without the lock beats hanging the meeting: a lost update costs a
      // transcript line, a stalled tick costs her the next thing she was going to say.
      try {
        return await fn();
      } finally {
        if (held) await command(["EVAL", RELEASE, 1, LOCK, token]).catch(() => undefined);
      }
    },
  };
}

/* ------------------------------------------------------------------- mongo */

type MongoDoc = { _id: string; value?: string; token?: string; expiresAt?: Date };

function mongoStore(uri: string): Store {
  const dbName = process.env.MONGODB_DB || "meeting_moderator";

  /**
   * One connection per process, cached across invocations.
   *
   * A serverless instance is reused between requests but re-imports the module on a
   * cold start; connecting per request would put a TCP and TLS handshake in front of
   * every two-second tick. The driver is imported lazily so the other two backends
   * never pay for it.
   */
  let connecting: Promise<import("mongodb").Collection<MongoDoc>> | null = null;
  const collection = () => {
    connecting ??= (async () => {
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(uri, { maxPoolSize: 5 });
      await client.connect();
      const col = client.db(dbName).collection<MongoDoc>("state");
      // Lets an abandoned lock disappear on its own if a process dies mid-write.
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 }).catch(() => undefined);
      return col;
    })();
    return connecting;
  };

  return {
    kind: "mongo",
    async read() {
      const doc = await (await collection()).findOne({ _id: KEY });
      return doc?.value ?? null;
    },
    async write(value) {
      await (await collection()).updateOne({ _id: KEY }, { $set: { value } }, { upsert: true });
    },
    async withLock(fn) {
      const col = await collection();
      const token = crypto.randomBytes(12).toString("hex");
      const deadline = Date.now() + LOCK_MS;
      let held = false;

      while (Date.now() < deadline) {
        const now = new Date();
        try {
          // Matches only an absent or expired lock. When somebody holds a live one the
          // filter misses, the upsert tries to insert a duplicate _id, and Mongo raises
          // E11000 — which is how we learn we lost the race.
          await col.updateOne(
            { _id: LOCK, expiresAt: { $lte: now } },
            { $set: { token, expiresAt: new Date(now.getTime() + LOCK_MS) } },
            { upsert: true },
          );
          held = true;
          break;
        } catch (e) {
          if ((e as { code?: number }).code !== 11000) throw e;
          await new Promise((r) => setTimeout(r, 40));
        }
      }

      try {
        return await fn();
      } finally {
        if (held) await col.deleteOne({ _id: LOCK, token }).catch(() => undefined);
      }
    },
  };
}

/* -------------------------------------------------------------------- file */

function fileStore(): Store {
  const file = path.join(process.cwd(), "data", "meeting.json");
  // One process, one thread: a promise chain is a sufficient mutex.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    kind: "file",
    async read() {
      try {
        return await fs.readFile(file, "utf8");
      } catch {
        return null;
      }
    },
    async write(value) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, value, "utf8");
    },
    async withLock(fn) {
      const run = queue.then(fn, fn);
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

let cached: Store | null = null;

export function store(): Store {
  if (!cached) {
    const creds = redisCreds();
    const mongo = process.env.MONGODB_URI;
    cached = creds ? redisStore(creds) : mongo ? mongoStore(mongo) : fileStore();
  }
  return cached;
}

/** Shown in the control room so a misconfigured deployment is visible, not mysterious. */
export function storeKind(): StoreKind {
  if (redisCreds()) return "redis";
  if (process.env.MONGODB_URI) return "mongo";
  return "file";
}
