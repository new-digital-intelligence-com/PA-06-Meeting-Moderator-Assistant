// Ava, on duty: she watches her own calendar and walks into each meeting she is invited
// to when it starts. Invite ava@ to a meeting the way you would invite anybody, and she
// turns up. She also goes wherever the control room sends her — which is how she gets
// into a Teams meeting.
//
//   npm run watch
//
// Leave it running. One meeting at a time: if two overlap she attends the earlier one.

import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import * as app from "./lib/app.mjs";
import { EARLY_MS, IN_CONTAINER, STATE_DIR } from "./lib/config.mjs";
import { ensureSignedIn } from "./lib/account.mjs";
import { attend } from "./lib/meet.mjs";
import { detectLanguage } from "./lib/language.mjs";

/** Her calendar changes slowly; a send from the control room should feel immediate. */
const POLL_MS = 60_000;
const DISPATCH_MS = 10_000;

/**
 * Meetings she has already attended, kept on disk so that restarting the runner in the
 * middle of the day does not send her back into a meeting that is still running without
 * her, or one she already finished.
 */
const doneFile = path.join(STATE_DIR, ".attended.json");
const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : []);
const remember = (id) => {
  done.add(id);
  fs.writeFileSync(doneFile, JSON.stringify([...done].slice(-500)));
};

const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Also written to her disk, one file a day, two weeks kept: `docker compose logs` starts
 * empty with every new container, and twice a test meeting's log went with it before
 * anybody had read it. On the server: docker compose exec ava tail -200 /data/logs/<date>.log
 *
 * What she prints in a client's meeting also goes to that client's own log,
 * /data/logs/clients/<client id>/<date>.log, beside their name — /logs/client/<id> shows it.
 */
const LOG_DIR = IN_CONTAINER ? path.join(STATE_DIR, "logs") : null;
const CLIENT_LOGS = LOG_DIR && path.join(LOG_DIR, "clients");
/** The client whose meeting she is in, while she is in it. */
let forClient = null;

/** The newest 14 day files of a folder are kept. */
const prune = (dir) => {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".log")).sort().slice(0, -14)) fs.rmSync(path.join(dir, f), { force: true });
};

if (LOG_DIR) {
  fs.mkdirSync(CLIENT_LOGS, { recursive: true });
  prune(LOG_DIR);
  for (const d of fs.readdirSync(CLIENT_LOGS, { withFileTypes: true })) if (d.isDirectory()) prune(path.join(CLIENT_LOGS, d.name));
  // Everything she prints, not only her own log lines — what the terminal shows is what
  // the file (and the live log page, logs.mjs) shows.
  for (const level of ["log", "warn", "error"]) {
    const print = console[level].bind(console);
    console[level] = (...args) => {
      print(...args);
      const line = `${util.format(...args)}\n`;
      const day = `${new Date().toISOString().slice(0, 10)}.log`;
      try {
        fs.appendFileSync(path.join(LOG_DIR, day), line);
        if (forClient) fs.appendFileSync(path.join(CLIENT_LOGS, forClient, day), line);
      } catch {
        /* a full disk must not stop her */
      }
    };
  }
}
const log = (m) => console.log(`${stamp()}${m}`);

/** From here on, what she prints is also the client's: their folder, with their name for its page. */
function logFor(client) {
  const id = String(client?.id ?? "");
  if (!CLIENT_LOGS || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  try {
    fs.mkdirSync(path.join(CLIENT_LOGS, id), { recursive: true });
    fs.writeFileSync(path.join(CLIENT_LOGS, id, "name.txt"), String(client.name ?? ""));
    return id;
  } catch {
    return null;
  }
}

/**
 * Her briefing, from the invite: whatever the organiser wrote in the description, plus
 * who called the meeting and who is in it — so she can address people by name and knows
 * whose meeting she is in.
 */
function briefingFrom(invite) {
  const people = invite.guests.map((g) => (g.name ? `${g.name} (${g.email})` : g.email)).join(", ");
  return [
    invite.description || "(The invite had no description.)",
    "",
    invite.organizer ? `Organised by ${invite.organizer}.` : "",
    people ? `Invited: ${people}.` : "",
  ]
    .filter((l, i, a) => l || a[i - 1])
    .join("\n")
    .trim();
}

/**
 * Meeting links she was sent to from the control room, and when. A meeting on her
 * calendar that she was also sent to is the same meeting: without this she would walk
 * back into it from the calendar the moment the first visit ended.
 */
const sent = new Map();
const linkKey = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return String(url);
  }
};

async function nextMeeting() {
  const { invites, account } = await app.upcoming(12);
  const now = Date.now();
  for (const i of invites) {
    const at = sent.get(linkKey(i.meetingUrl));
    if (at && at > i.start - 12 * 60 * 60_000 && !done.has(i.id)) remember(i.id);
  }
  const due = invites.filter((i) => !done.has(i.id) && i.start - EARLY_MS <= now && i.end > now);
  return { due: due[0], invites, account };
}

log(`  Ava is on duty. Watching her calendar every ${POLL_MS / 1000}s. Ctrl+C to stop.`);

// Signed in first. Everything below assumes she walks into meetings as herself.
await ensureSignedIn({ log });

/** Sent from the control room? Goes straight in, with the briefing typed there. */
async function dispatched() {
  const meeting = await app.claimDispatch(EARLY_MS / 1000);
  if (!meeting) return false;
  sent.set(linkKey(meeting.meetingUrl), Date.now());
  log(`  → sent from the control room: ${meeting.title || meeting.meetingUrl}`);
  try {
    await attend(meeting, { log, briefed: true });
    log(`  ← finished ${meeting.title || "the meeting"}`);
  } catch (e) {
    log(`  could not attend: ${e.message}`);
  }
  return true;
}

let announced = "";
let lastCalendar = 0;
for (;;) {
  try {
    if (await dispatched()) continue;
  } catch (e) {
    log(`  ${e.message}`);
  }
  if (Date.now() - lastCalendar < POLL_MS) {
    await new Promise((r) => setTimeout(r, DISPATCH_MS));
    continue;
  }
  lastCalendar = Date.now();

  try {
    const { due, invites, account } = await nextMeeting();

    if (account && account !== announced) {
      log(`  reading the calendar of ${account}`);
      announced = account;
    }

    if (due) {
      forClient = logFor(due.client);
      log(`  → ${due.title} (${new Date(due.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})${due.client ? ` for ${due.client.name}` : ""}`);
      remember(due.id);
      await attend(
        {
          meetingUrl: due.meetingUrl,
          title: due.title,
          // The app's briefing for a client's meeting: their instructions, what she knows
          // about them and her brief for this one. Otherwise the invite alone.
          context: due.briefing || briefingFrom(due),
          client: due.client ?? null,
          recipients: due.guests.map((g) => g.email),
          startsAt: due.start,
          // "Language: German" in the invite, or the language it is written in.
          language: detectLanguage(`${due.title}\n${due.description}`),
        },
        { log },
      );
      log(`  ← finished ${due.title}`);
      forClient = null;
      continue; // straight on to the next check: another meeting may already be due
    }

    const upcoming = invites.find((i) => !done.has(i.id) && i.start > Date.now());
    if (upcoming) {
      const mins = Math.round((upcoming.start - Date.now()) / 60_000);
      log(`  next: ${upcoming.title} in ${mins} min`);
    }
  } catch (e) {
    log(`  ${e.message}`);
    // A meeting that failed: said in the client's log too, and theirs ends here.
    forClient = null;
    // Google occasionally signs accounts out. Rather than knock on the next meeting as a
    // stranger, stop and get her signed back in.
    if (/not signed in/i.test(e.message)) await ensureSignedIn({ log });
  }
  await new Promise((r) => setTimeout(r, DISPATCH_MS));
}
