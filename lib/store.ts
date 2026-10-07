/**
 * Where the meeting lives.
 *
 * Two clients write to it constantly and they are not in the same place: the stage runs
 * inside Recall's browser, the control room in yours, and on a serverless host neither
 * request is guaranteed to land on the same instance twice. So the state cannot sit in
 * a module variable, and it cannot sit on disk — on a serverless host the disk is
 * read-only and not shared, and on any host each deploy starts on a fresh one.
 *
 * Four backends, picked by what is in the environment, in this order:
 *
 *   Redis   (Upstash, over HTTP)   when the REST credentials are set
 *   Redis   (any, e.g. Railway's)  when only REDIS_URL is set — a plain connection
 *   MongoDB (Atlas or anywhere)    when MONGODB_URI is set
 *   a file  (data/meeting.json)    otherwise — local dev, no services to set up
 *
 * Redis first because it suits this shape best: one small blob rewritten every couple
 * of seconds. On a serverless host over HTTP (Upstash), with no connection to pool and no
 * cold-start handshake; on a server that stays up (Railway) over one connection kept open.
 * Mongo is there because a cluster you already have beats a service you have to sign up
 * for, and its findOneAndUpdate is atomic enough to hold the lock.
 *
 * One meeting per seat — her server can be in more than one meeting at a time
 * (lib/meeting.ts) — each under its own key and lock. Seat 1 keeps the key it always had.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type StoreKind = "redis" | "mongo" | "file";

export type Store = {
  /** A seat's meeting ("1" when not said). */
  read(seat?: string): Promise<string | null>;
  write(value: string, seat?: string): Promise<void>;
  /** Any other small value, under its own key — her Google sign-in, for one. */
  readKey(key: string): Promise<string | null>;
  writeKey(key: string, value: string): Promise<void>;
  /** Read-modify-write of a seat's meeting, serialised against every other writer of it. */
  withLock<T>(fn: () => Promise<T>, seat?: string): Promise<T>;
  readonly kind: StoreKind;
};

const KEY = "meeting:current";
const LOCK = "meeting:lock";
const keyOf = (seat = "1") => (seat === "1" ? KEY : `${KEY}:${seat}`);
const lockOf = (seat = "1") => (seat === "1" ? LOCK : `${LOCK}:${seat}`);
/** Long enough for a slow write, short enough that a crashed holder frees it fast. */
const LOCK_MS = 5000;

function redisCreds() {
  let url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  // Upstash's REST address is its Redis host over HTTPS, and the integration also sets
  // the plain Redis URL. With only that left — KV_REST_API_URL was deleted once and every
  // page that reads the meeting fell back to a file, which a deployment cannot keep — work
  // the address out from it.
  if (!url && token) {
    const tcp = process.env.KV_URL || process.env.REDIS_URL;
    try {
      if (tcp) url = `https://${new URL(tcp).hostname}`;
    } catch {
      /* not a URL: no Redis */
    }
  }
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/** A plain Redis address — Railway's, beside the site — when there are no REST credentials. */
function redisAddress(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url && /^rediss?:\/\//.test(url) && !redisCreds() ? url : null;
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
    async read(seat) {
      return command<string | null>(["GET", keyOf(seat)]);
    },
    async write(value, seat) {
      await command(["SET", keyOf(seat), value]);
    },
    async readKey(key) {
      return command<string | null>(["GET", key]);
    },
    async writeKey(key, value) {
      await command(["SET", key, value]);
    },
    async withLock(fn, seat) {
      const lock = lockOf(seat);
      const token = crypto.randomBytes(12).toString("hex");
      const deadline = Date.now() + LOCK_MS;

      let held = false;
      while (Date.now() < deadline) {
        const got = await command<string | null>(["SET", lock, token, "NX", "PX", String(LOCK_MS)]);
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
        if (held) await command(["EVAL", RELEASE, 1, lock, token]).catch(() => undefined);
      }
    },
  };
}

/* ---------------------------------------------------------- redis, plain */

/** The same lock release as above: only the holder's token deletes it. */
const RELEASE_LOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * A plain Redis connection, for a site that stays up (Railway): one connection for the life
 * of the process, opened on first use. `family: 0` lets it reach Railway's private network,
 * which is IPv6.
 */
function redisTcpStore(url: string): Store {
  let connecting: Promise<import("ioredis").Redis> | null = null;
  const redis = () =>
    (connecting ??= import("ioredis").then(({ default: Redis }) => new Redis(url, { family: 0, maxRetriesPerRequest: 3, enableAutoPipelining: true })));

  return {
    kind: "redis",
    async read(seat) {
      return (await redis()).get(keyOf(seat));
    },
    async write(value, seat) {
      await (await redis()).set(keyOf(seat), value);
    },
    async readKey(key) {
      return (await redis()).get(key);
    },
    async writeKey(key, value) {
      await (await redis()).set(key, value);
    },
    async withLock(fn, seat) {
      const r = await redis();
      const lock = lockOf(seat);
      const token = crypto.randomBytes(12).toString("hex");
      const deadline = Date.now() + LOCK_MS;
      let held = false;
      while (Date.now() < deadline) {
        if ((await r.set(lock, token, "PX", LOCK_MS, "NX")) === "OK") {
          held = true;
          break;
        }
        await new Promise((res) => setTimeout(res, 40));
      }
      // As above: proceeding without the lock beats hanging the meeting.
      try {
        return await fn();
      } finally {
        if (held) await r.eval(RELEASE_LOCK, 1, lock, token).catch(() => undefined);
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
    async read(seat) {
      const doc = await (await collection()).findOne({ _id: keyOf(seat) });
      return doc?.value ?? null;
    },
    async write(value, seat) {
      await (await collection()).updateOne({ _id: keyOf(seat) }, { $set: { value } }, { upsert: true });
    },
    async readKey(key) {
      const doc = await (await collection()).findOne({ _id: key });
      return doc?.value ?? null;
    },
    async writeKey(key, value) {
      await (await collection()).updateOne({ _id: key }, { $set: { value } }, { upsert: true });
    },
    async withLock(fn, seat) {
      const col = await collection();
      const lock = lockOf(seat);
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
            { _id: lock, expiresAt: { $lte: now } },
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
        if (held) await col.deleteOne({ _id: lock, token }).catch(() => undefined);
      }
    },
  };
}

/* -------------------------------------------------------------------- file */

function fileStore(): Store {
  const fileOf = (seat = "1") => path.join(process.cwd(), "data", seat === "1" ? "meeting.json" : `meeting-${seat}.json`);
  // One process, one thread: a promise chain per seat is a sufficient mutex.
  const queues = new Map<string, Promise<unknown>>();

  return {
    kind: "file",
    async read(seat) {
      try {
        return await fs.readFile(fileOf(seat), "utf8");
      } catch {
        return null;
      }
    },
    async write(value, seat) {
      await fs.mkdir(path.dirname(fileOf(seat)), { recursive: true });
      await fs.writeFile(fileOf(seat), value, "utf8");
    },
    async readKey(key) {
      try {
        return await fs.readFile(keyFile(key), "utf8");
      } catch {
        return null;
      }
    },
    async writeKey(key, value) {
      await fs.mkdir(path.dirname(keyFile(key)), { recursive: true });
      await fs.writeFile(keyFile(key), value, "utf8");
    },
    async withLock(fn, seat = "1") {
      const run = (queues.get(seat) ?? Promise.resolve()).then(fn, fn);
      queues.set(
        seat,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}

/** A safe filename for a key: "google:ava" → data/google_ava.txt. */
function keyFile(key: string) {
  return path.join(process.cwd(), "data", `${key.replace(/[^a-z0-9_-]/gi, "_")}.txt`);
}

/** One named value, whichever backend is in use. */
export function redisOrMongoKey(key: string) {
  return {
    read: () => store().readKey(key),
    write: (value: string) => store().writeKey(key, value),
  };
}

let cached: Store | null = null;

export function store(): Store {
  if (!cached) {
    const creds = redisCreds();
    const plain = redisAddress();
    const mongo = process.env.MONGODB_URI;
    cached = creds ? redisStore(creds) : plain ? redisTcpStore(plain) : mongo ? mongoStore(mongo) : fileStore();
  }
  return cached;
}

/** Shown in the control room so a misconfigured deployment is visible, not mysterious. */
export function storeKind(): StoreKind {
  if (redisCreds() || redisAddress()) return "redis";
  if (process.env.MONGODB_URI) return "mongo";
  return "file";
}

/**
 * Which storage variables this process can actually see — names and whether they hold
 * anything, never the values.
 *
 * "It says File store" has several possible causes that look identical from outside:
 * the variables were never added, they arrived with a prefix from an integration's
 * dialog, they were set on Preview but not Production, or the deployment predates
 * them. Listing the names it found distinguishes all four in one request.
 */
export function storeDiagnostics() {
  const relevant = Object.keys(process.env)
    .filter((k) => /KV_|UPSTASH|REDIS|MONGO/i.test(k))
    .sort();
  return {
    kind: storeKind(),
    reads: ["KV_REST_API_URL / UPSTASH_REDIS_REST_URL (+ matching token)", "REDIS_URL (a plain connection, without a REST token)", "MONGODB_URI"],
    found: relevant.map((k) => `${k}${process.env[k] ? "" : " (EMPTY)"}`),
  };
}
