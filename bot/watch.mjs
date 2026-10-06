// Ava, on duty: she watches her own calendar and walks into each meeting she is invited
// to when it starts. Invite ava@ to a meeting the way you would invite anybody, and she
// turns up. She also goes wherever a client's page sends her ("Ava, now") — which is how she gets
// into a Teams meeting.
//
//   npm run watch
//
// Leave it running. She has seats (AVA_SEATS, two by default): that many meetings at once,
// each in its own Chrome — two clients' meetings side by side. Which invites she takes is
// the app's call (one at a time for each client); a meeting due with every seat taken
// waits for one to free.

import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import * as app from "./lib/app.mjs";
import { EARLY_MS, IN_CONTAINER, SEATS, STATE_DIR } from "./lib/config.mjs";
import { copyProfile, ensureSignedIn, readySeats, signedInAs } from "./lib/account.mjs";
import { attend } from "./lib/meet.mjs";
import { detectLanguage } from "./lib/language.mjs";

/** Her calendar changes slowly; a send from a client's page should feel immediate. */
const POLL_MS = 60_000;
const DISPATCH_MS = 10_000;

/**
 * Meetings she has already attended, kept on disk so that restarting the runner in the
 * middle of the day does not send her back into a meeting that is still running without
 * her, or one she already finished.
 */
const doneFile = path.join(STATE_DIR, ".attended.json");
const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, "utf8")) : []);
const saveDone = () => fs.writeFileSync(doneFile, JSON.stringify([...done].slice(-500)));
const remember = (id) => {
  done.add(id);
  saveDone();
};
const forget = (id) => {
  done.delete(id);
  saveDone();
};

/**
 * Which seats are in a meeting right now, on disk: what anybody updating her server reads
 * first — never restart her while one is.
 */
const busyFile = path.join(STATE_DIR, ".seats.json");
const running = new Map();
const saveBusy = () => {
  try {
    fs.writeFileSync(busyFile, JSON.stringify([...running].map(([seat, r]) => ({ seat, ...r }))));
  } catch {
    /* only for whoever looks */
  }
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
const today = () => `${new Date().toISOString().slice(0, 10)}.log`;

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
      try {
        fs.appendFileSync(path.join(LOG_DIR, today()), `${util.format(...args)}\n`);
      } catch {
        /* a full disk must not stop her */
      }
    };
  }
}
const log = (m) => console.log(`${stamp()}${m}`);

/** A client's log folder, with their name for its page — or null for nobody's meeting. */
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
 * What one seat prints: tagged with the seat when she has more than one, and written to
 * that meeting's client's log as well as hers.
 */
function seatLog(seat, client) {
  const forClient = logFor(client);
  const tag = ready.length > 1 ? ` [${seat}]` : "";
  return (m) => {
    const line = `${stamp()}${tag}${m}`;
    console.log(line);
    if (!forClient) return;
    try {
      fs.appendFileSync(path.join(CLIENT_LOGS, forClient, today()), `${line}\n`);
    } catch {
      /* a full disk must not stop her */
    }
  };
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
 * Meeting links she was sent to from a client's page, and when. A meeting on her
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

log(`  Ava is on duty. Watching her calendar every ${POLL_MS / 1000}s. Ctrl+C to stop.`);

// Signed in first. Everything below assumes she walks into meetings as herself.
await ensureSignedIn({ log });
// Her other seats: copies of seat 1's profile, each checked like it.
let ready = await readySeats(SEATS, { log });
app.setSeatsReady(ready.length);
if (ready.length > 1) log(`  ${ready.length} seats: up to ${ready.length} clients' meetings at once`);
saveBusy();

/** Seats Google signed out mid-day, to be signed back in once no meeting is running. */
const signedOut = new Set();

/** Wakes the loop: a seat has just freed. */
let wake = () => {};
const freeSeats = () => ready.filter((s) => !running.has(s));

/** A meeting in a seat, run alongside whatever the other seats are doing. */
function begin(seat, info, work) {
  const slog = seatLog(seat, info.client);
  running.set(seat, { title: info.title, client: info.client?.name ?? null, since: Date.now() });
  saveBusy();
  void (async () => {
    try {
      await work(slog);
    } catch (e) {
      slog(`  could not attend: ${e.message}`);
      // Google occasionally signs accounts out. Rather than knock on the next meeting as a
      // stranger, she is signed back in before this seat is used again.
      if (/not signed in/i.test(e.message)) signedOut.add(seat);
    } finally {
      running.delete(seat);
      saveBusy();
      wake();
    }
  })();
}

/**
 * Sent from a client's page ("Ava, now")? Into a free seat, straight in, with the
 * briefing the site wrote for that client — and, like a calendar meeting, logged in their
 * log too.
 */
async function dispatched() {
  const free = freeSeats();
  if (!free.length) return false;
  const meeting = await app.claimDispatch(EARLY_MS / 1000, free.map(String));
  if (!meeting) return false;
  const seat = Number(meeting.seat);
  if (!free.includes(seat)) {
    log(`  sent to seat ${meeting.seat}, which is not free here — left for it to free`);
    return false;
  }
  sent.set(linkKey(meeting.meetingUrl), Date.now());
  begin(seat, meeting, async (slog) => {
    slog(`  → sent now${meeting.client ? ` for ${meeting.client.name}` : ""}: ${meeting.title || meeting.meetingUrl}`);
    await attend(meeting, { log: slog, briefed: true, seat });
    slog(`  ← finished ${meeting.title || "the meeting"}`);
  });
  return true;
}

/** Calendar meetings due now, each into a free seat — the earliest first. */
async function calendar() {
  const { invites, account } = await app.upcoming(12);
  if (account && account !== announced) {
    log(`  reading the calendar of ${account}`);
    announced = account;
  }
  const now = Date.now();
  for (const i of invites) {
    const at = sent.get(linkKey(i.meetingUrl));
    if (at && at > i.start - 12 * 60 * 60_000 && !done.has(i.id)) remember(i.id);
  }
  const due = invites.filter((i) => !done.has(i.id) && i.start - EARLY_MS <= now && i.end > now);
  for (const d of due) {
    const seat = freeSeats()[0];
    if (!seat) break;
    remember(d.id);
    begin(seat, d, async (slog) => {
      slog(`  → ${d.title} (${new Date(d.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})${d.client ? ` for ${d.client.name}` : ""}`);
      try {
        await attend(
          {
            meetingUrl: d.meetingUrl,
            title: d.title,
            // The app's briefing for a client's meeting: their instructions, what she knows
            // about them and her brief for this one. Otherwise the invite alone.
            context: d.briefing || briefingFrom(d),
            client: d.client ?? null,
            recipients: d.guests.map((g) => g.email),
            startsAt: d.start,
            // "Language: German" in the invite, or the language it is written in.
            language: detectLanguage(`${d.title}\n${d.description}`),
          },
          { log: slog, seat },
        );
        slog(`  ← finished ${d.title}`);
      } catch (e) {
        // That seat on the site holds a meeting a page has just sent her to: that one goes
        // first, and this one takes the next free seat.
        if (/→ 409/.test(e.message) && /sent her/.test(e.message)) {
          forget(d.id);
          slog("  a page has just sent her to a meeting in this seat — this one takes the next free seat");
          return;
        }
        throw e;
      }
    });
  }
  const next = invites.find((i) => !done.has(i.id) && i.start > Date.now());
  if (next) log(`  next: ${next.title} in ${Math.round((next.start - Date.now()) / 60_000)} min`);
}

/** A seat Google signed out: signed back in — seat 1 by hand if need be, the others copied again — once nothing is running. */
async function signBackIn() {
  if (!signedOut.size || running.size) return;
  if (signedOut.has(1)) await ensureSignedIn({ log });
  for (const seat of [...signedOut].filter((s) => s > 1)) {
    copyProfile(seat, { log, again: true });
    if (!(await signedInAs(seat).catch(() => null))) {
      ready = ready.filter((s) => s < seat);
      app.setSeatsReady(ready.length);
      log(`  seat ${seat}: could not be signed back in — she uses ${ready.length} seat${ready.length > 1 ? "s" : ""}`);
    }
  }
  signedOut.clear();
}

let announced = "";
let lastCalendar = 0;
for (;;) {
  try {
    await signBackIn();
    if (await dispatched()) continue;
  } catch (e) {
    log(`  ${e.message}`);
  }
  if (Date.now() - lastCalendar >= POLL_MS) {
    lastCalendar = Date.now();
    try {
      await calendar();
    } catch (e) {
      log(`  ${e.message}`);
    }
  }
  // Until the next check — or a seat freeing, which may let a waiting meeting in at once.
  await new Promise((r) => {
    const timer = setTimeout(r, DISPATCH_MS);
    wake = () => {
      clearTimeout(timer);
      lastCalendar = 0;
      r();
    };
  });
}
