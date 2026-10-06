// Talks to the deployed app. The runner is only her body — deciding what to say, keeping
// the transcript and writing the notes all happen there, exactly as they did when Recall
// was the body. Swapping one body for another did not require a second brain.
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR, requireApp } from "./config.mjs";

/** Her screen's address when it is online: the app links each client's log there (logs.mjs). */
const SCREEN = process.env.AVA_SCREEN_HOST?.trim();

async function call(method, path, body) {
  const res = await fetch(`${requireApp()}${path}`, {
    method,
    // Her key: the server only lets the runner read her calendar, send mail as her or
    // mark her as attending, since each of those is dangerous from a stranger.
    headers: {
      "Content-Type": "application/json",
      "x-ava-key": process.env.AVA_RUNNER_KEY || "",
      ...(SCREEN ? { "x-ava-screen": `https://${SCREEN}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A request that never comes back would freeze her mid-meeting.
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? text.slice(0, 200)}`);
  return data;
}

/** Brief her: what the meeting is about, who is in it, where it is. */
export const brief = (meeting) => call("PUT", "/api/meeting", meeting);

/** Tell the server she is in the room, as herself — not a rehearsal, not a Recall bot. */
export const attend = (from) => call("POST", "/api/meeting/control", { command: "attend", from });

/**
 * Her Anam accounts, in order: ANAM_API_KEY, then ANAM_API_KEY_2 … _5. Free plans run out
 * of minutes, so when one does she carries on with the next. Each has its own avatar
 * (ANAM_AVATAR_ID, ANAM_AVATAR_ID_2 …) — an avatar belongs to the account it was made in.
 * A backup's avatar can be left out: she finds the one that account made itself with the
 * first account's avatar's name.
 */
const ANAM_SUFFIXES = ["", "_2", "_3", "_4", "_5"];
export function anamAccounts() {
  const accounts = [];
  for (const suffix of ANAM_SUFFIXES) {
    const key = process.env[`ANAM_API_KEY${suffix}`]?.trim();
    if (key) accounts.push({ n: accounts.length + 1, key, avatar: process.env[`ANAM_AVATAR_ID${suffix}`]?.trim() || null });
  }
  return accounts;
}

/** An account out of minutes is left alone this long, then tried again. Kept on disk. */
const USED_UP_REST_MS = 24 * 60 * 60_000;
const usedUpFile = path.join(STATE_DIR, ".anam-used-up.json");
const usedUp = (() => {
  try {
    return JSON.parse(fs.readFileSync(usedUpFile, "utf8"));
  } catch {
    return {};
  }
})();
const resting = (account) => (usedUp[account.n] ?? 0) > Date.now();
/** The account the last face session came from: the one to blame if Anam refuses it. */
let lastAccount = null;

/**
 * A short-lived session for her face: `{ sessionToken, avatarId, account }`, from the first
 * of her Anam accounts with minutes left. The face lip-syncs to her own voice, which is
 * sent to it, so it has no voice of its own.
 *
 * With keys in bot/.env she asks Anam herself; otherwise the app asks for her. Her first
 * Teams call showed a black tile because the key on the app's side was wrong — this way
 * her face depends on one file on her own server.
 */
export async function anamSession() {
  const accounts = anamAccounts();
  if (!accounts.length || !accounts[0].avatar) return call("POST", "/api/anam", { passthrough: true });
  const account = accounts.find((a) => !resting(a));
  if (!account) throw new Error("Usage limit reached on every Anam account");
  const avatarId = await avatarFor(account, accounts[0]);

  const res = await fetch("https://api.anam.ai/v1/auth/session-token", {
    method: "POST",
    headers: { Authorization: `Bearer ${account.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ personaConfig: { name: "Ava", avatarId, enableAudioPassthrough: true } }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anam account ${account.n} refused the session: ${text.slice(0, 200)}`);
  const { sessionToken } = JSON.parse(text);
  if (!sessionToken) throw new Error("Anam returned no session token");
  lastAccount = account.n;
  return { sessionToken, avatarId, account: account.n };
}

/**
 * Anam refused her face for having no minutes left: that account rests for a day. Returns
 * the number of the account that takes over, or null when every one is used up.
 */
export function anamUsedUp() {
  if (lastAccount === null) return null;
  usedUp[lastAccount] = Date.now() + USED_UP_REST_MS;
  try {
    fs.writeFileSync(usedUpFile, JSON.stringify(usedUp));
  } catch {
    /* kept in memory at least */
  }
  return anamAccounts().find((a) => !resting(a))?.n ?? null;
}

const anamGet = async (key, url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Anam ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
};

/** Avatars found once per account. */
const avatars = new Map();

/**
 * The avatar an account's face uses. Given: as is — or, if Anam's dashboard gave a
 * persona's ID (which made Anam refuse every face, "Invalid request to start session"),
 * that persona's avatar. Not given (a backup account): the avatar that account made itself
 * with the same name as the first account's.
 */
async function avatarFor(account, first) {
  if (avatars.has(account.n)) return avatars.get(account.n);
  let avatarId = account.avatar;
  if (avatarId) {
    try {
      const persona = await anamGet(account.key, `https://api.anam.ai/v1/personas/${encodeURIComponent(avatarId)}`);
      if (persona?.avatar?.id) {
        console.log(`  Anam account ${account.n}: that ID is the persona "${persona.name}" — using its avatar, ${persona.avatar.id}`);
        avatarId = persona.avatar.id;
      }
    } catch {
      /* not a persona: an avatar, as given */
    }
  } else {
    const firstId = await avatarFor(first, first);
    const name = (await anamGet(first.key, `https://api.anam.ai/v1/avatars/${firstId}`)).displayName;
    const own = [];
    for (let page = 1; page <= 10; page++) {
      const list = (await anamGet(account.key, `https://api.anam.ai/v1/avatars?perPage=50&page=${page}`)).data ?? [];
      own.push(...list.filter((a) => a.createdByOrganizationId && a.displayName === name));
      if (list.length < 50) break;
    }
    own.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (!own[0]) throw new Error(`Anam account ${account.n} has no avatar of its own called "${name}" — upload the same photo there`);
    avatarId = own[0].id;
    console.log(`  Anam account ${account.n}: its own "${name}" is ${avatarId}`);
  }
  avatars.set(account.n, avatarId);
  return avatarId;
}

/**
 * Has a client's page sent her somewhere? Takes it if so — once — and returns the
 * meeting `{ meetingUrl, title, context, recipients, platform }`, or null.
 */
export const claimDispatch = async (earlySeconds) =>
  (await call("POST", "/api/ava/dispatch", { earlySeconds })).meeting ?? null;

/** Hand over what was heard; get back what to say, if anything. */
export const tick = (body) => call("POST", "/api/moderator/tick", body);

/** GPT-Live handed something over that needs her memory of the meeting: Claude answers. */
export const ask = (asked) => call("POST", "/api/moderator/ask", { asked });

/** The meeting so far — transcript, actions, notes — for GPT-Live's OpenAI backend; `note` adds an action first. */
export const record = (note) => call("POST", "/api/moderator/record", note ? { note } : {});

/** Passages from the client's documents about `query` — for the meeting she is in, decided by the app. */
export const knowledge = async (query) => (await call("POST", "/api/moderator/knowledge", { query })).results;

/** She has left the call — and why, for the meeting's history. */
export const stop = (reason) => call("POST", "/api/meeting/control", { command: "stop", ...(reason ? { reason } : {}) });

/** Write the notes and send them to the guests. */
export const sendNotes = () => call("POST", "/api/meeting/followup", { mode: "send" });

/** Whether the server is set up to send mail on her behalf with nobody's browser open. */
export const session = () => call("GET", "/api/session");

/** Her upcoming invites, from her own calendar. */
export const upcoming = (hours = 12) => call("GET", `/api/ava/upcoming?hours=${hours}`);
