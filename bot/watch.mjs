// Ava, on duty: she watches her own calendar and walks into each meeting she is invited
// to when it starts. Invite ava@ to a meeting the way you would invite anybody, and she
// turns up.
//
//   npm run watch
//
// Leave it running. One meeting at a time: if two overlap she attends the earlier one.

import fs from "node:fs";
import path from "node:path";
import * as app from "./lib/app.mjs";
import { EARLY_MS, STATE_DIR } from "./lib/config.mjs";
import { ensureSignedIn } from "./lib/account.mjs";
import { attend } from "./lib/meet.mjs";

const POLL_MS = 60_000;

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
const log = (m) => console.log(`${stamp()}${m}`);

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

async function nextMeeting() {
  const { invites, account } = await app.upcoming(12);
  const now = Date.now();
  const due = invites.filter((i) => !done.has(i.id) && i.start - EARLY_MS <= now && i.end > now);
  return { due: due[0], invites, account };
}

log(`  Ava is on duty. Watching her calendar every ${POLL_MS / 1000}s. Ctrl+C to stop.`);

// Signed in first. Everything below assumes she walks into meetings as herself.
await ensureSignedIn({ log });

let announced = "";
for (;;) {
  try {
    const { due, invites, account } = await nextMeeting();

    if (account && account !== announced) {
      log(`  reading the calendar of ${account}`);
      announced = account;
    }

    if (due) {
      log(`  → ${due.title} (${new Date(due.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`);
      remember(due.id);
      await attend(
        {
          meetingUrl: due.meetingUrl,
          title: due.title,
          context: briefingFrom(due),
          recipients: due.guests.map((g) => g.email),
        },
        { log },
      );
      log(`  ← finished ${due.title}`);
      continue; // straight on to the next check: another meeting may already be due
    }

    const upcoming = invites.find((i) => !done.has(i.id) && i.start > Date.now());
    if (upcoming) {
      const mins = Math.round((upcoming.start - Date.now()) / 60_000);
      log(`  next: ${upcoming.title} in ${mins} min`);
    }
  } catch (e) {
    log(`  ${e.message}`);
    // Google occasionally signs accounts out. Rather than knock on the next meeting as a
    // stranger, stop and get her signed back in.
    if (/not signed in/i.test(e.message)) await ensureSignedIn({ log });
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
