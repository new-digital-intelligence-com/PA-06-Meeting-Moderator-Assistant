// Ava attending one meeting, in person: her own Chrome, her voice as the microphone (and
// in avatar mode her face as the camera), the meeting's own captions as her ears. What
// differs between Google Meet and Teams lives in platforms.mjs.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import * as app from "./app.mjs";
import { DISPLAY_NAME, FACE, MODE, PROFILE, STATE_DIR, platformArgs, requireChrome, root } from "./config.mjs";
import { speech } from "./voice.mjs";
import { PEOPLE, keepEvidence, platformOf } from "./platforms.mjs";

/** The heartbeat. Somebody pausing cuts it short — see `wake`. */
const TICK_MS = 1200;
/** How long she stays once everybody else has left, in case they are coming back. */
const ALONE_MS = 5 * 60_000;
/** How long after the start time she waits for anybody to turn up. */
const NOBODY_MS = 5 * 60_000;
/** The same, when the page cannot tell whether she is alone: never longer than this. */
const NOBODY_CAP_MS = 15 * 60_000;
/** Checks in a row (about 2.5 s) that find her alone before her face is put to rest. */
const ALONE_CHECKS = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A few seconds of her face at rest, filmed from the live avatar the first time, and
 * shown whenever the live face is not connected. Kept per avatar, and this avatar's is
 * used when there is one; otherwise the newest kept — when Anam cannot be reached at all
 * the avatar is not even known, and a black tile is what the room saw instead.
 */
const idleClipFile = (avatarId) => path.join(STATE_DIR, `idle-${String(avatarId).replace(/[^\w-]/g, "")}.json`);
function readIdleClip(avatarId) {
  const files = avatarId ? [idleClipFile(avatarId)] : [];
  try {
    files.push(
      ...fs
        .readdirSync(STATE_DIR)
        .filter((f) => /^idle-.+\.json$/.test(f))
        .map((f) => path.join(STATE_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs),
    );
  } catch {
    /* no state folder yet */
  }
  for (const file of files) {
    try {
      const frames = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(frames) && frames.length) return frames;
    } catch {
      /* missing or unreadable: try the next */
    }
  }
  return undefined;
}

/**
 * Attends one meeting from start to finish, then writes and sends the notes.
 *
 * @param {{ meetingUrl: string, title?: string, context?: string, recipients?: string[], startsAt?: number }} meeting
 *   `startsAt`: when the meeting is due to start — she may be early, and waits for people from then.
 * @param {{ log?: (m: string) => void, briefed?: boolean }} options `briefed`: sent from the
 *   control room, whose briefing is already on the server and must not be overwritten.
 */
export async function attend(meeting, { log = console.log, briefed = false } = {}) {
  const platform = platformOf(meeting.meetingUrl);
  if (!platform) throw new Error(`Not a Google Meet or Teams link: ${meeting.meetingUrl}`);

  // 1 — brief her, and tell the server this is a real meeting she is attending in person.
  if (!briefed) {
    await app.brief({
      title: meeting.title || "Meeting",
      meetingUrl: meeting.meetingUrl,
      context: meeting.context || "",
      recipients: meeting.recipients || [],
      joinAt: null,
    });
  }
  await app.attend();
  log(`  ${briefed ? "sent from the control room" : "briefed"}: ${meeting.title || meeting.meetingUrl} (${platform.name})`);

  // 2 — her browser.
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: requireChrome(),
    // Visible, not headless: Meet degrades headless browsers, and Google is far more
    // willing to keep a real-looking Chrome signed in.
    headless: false,
    // Her face connects to Anam from inside Meet's page, which Meet's content security
    // policy would otherwise block.
    bypassCSP: true,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      // A window that is minimised or covered would otherwise have its timers and
      // rendering throttled — and her face would freeze mid-sentence.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--no-default-browser-check",
      ...platformArgs(),
    ],
  });
  for (const origin of platform.origins) await context.grantPermissions(["camera", "microphone"], { origin });

  // 3 — her ears. Her own words come back as captions too ("You" in Meet, her name in
  // Teams): never an input.
  const heard = [];
  let heardCount = 0;
  let lastHeardAt = null;
  let speaking = false;
  let wake = () => {};
  /** Words heard so far in each caption block, to tell new speech from Meet tidying up. */
  const wordsIn = new Map();
  /** New words heard in total — what counts as somebody talking. */
  let wordsHeard = 0;
  let wordsWhenSheStarted = 0;
  let pauseTimer = null;
  /** How many people are in the call, her included — two means everything is said to her. */
  let people = null;
  let warmedAt = 0;

  await context.exposeBinding("__avaLog", (_src, m) => log(`  [meet] ${m}`));
  await context.exposeBinding("__avaHeard", (_src, speaker, text, blockId) => {
    if (!text || platform.isSelf(speaker)) return;
    heardCount++;
    lastHeardAt = Date.now();
    // Meet rewrites a caption as the sentence goes on. Only the latest version of each
    // caption block is worth sending; the server replaces the line in place by this id.
    const id = blockId || `m${heardCount}`;
    const line = { id, speaker, text, at: Date.now() };
    const i = heard.findIndex((h) => h.id === id);
    if (i >= 0) heard[i] = line;
    else heard.push(line);

    const words = text.trim().split(/\s+/).length;
    wordsHeard += Math.max(0, words - (wordsIn.get(id) ?? 0));
    wordsIn.set(id, Math.max(words, wordsIn.get(id) ?? 0));

    // Somebody talked over her: stop, like a person would. Not for Meet correcting a
    // caption from a moment ago, which used to cut her off at her first word.
    if (speaking && wordsHeard - wordsWhenSheStarted >= 3) {
      void page.evaluate(() => window.__ava?.interrupt()).catch(() => {});
      speaking = false;
    }
    // A pause is the end of their turn: take it the moment it happens, not on the next
    // heartbeat.
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => wake(), 1100);

    // One-on-one, she answers everything — so have her face connecting while they are
    // still talking, and it is there by the time she replies.
    if (MODE === "avatar" && (people === null || people <= 2) && Date.now() - warmedAt > 3000) {
      warmedAt = Date.now();
      void page.evaluate(() => window.__ava?.warm()).catch(() => {});
    }
  });

  // Her face asks for a new session each time it connects: after resting, and ahead of
  // Anam's time limit.
  let avatarId = null;
  await context.exposeBinding("__avaAnamToken", async () => {
    const s = await app.anamSession();
    avatarId = s.avatarId;
    return s.sessionToken;
  });
  await context.exposeBinding("__avaIdleClip", (_src, frames) => {
    if (!avatarId || !Array.isArray(frames)) return;
    try {
      fs.writeFileSync(idleClipFile(avatarId), JSON.stringify(frames));
      log("  kept her idle clip for next time");
    } catch (e) {
      log(`  could not keep her idle clip: ${e.message}`);
    }
  });
  await context.addInitScript({
    content: `window.__AVA_MODE = ${JSON.stringify(MODE)}; window.__AVA_FACE = ${JSON.stringify({ ...FACE, name: DISPLAY_NAME })};`,
  });
  await context.addInitScript({ path: path.join(root, "dist", "ava.js") });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(platform.url(meeting.meetingUrl), { waitUntil: "domcontentloaded" });

  // 4 — her voice (and face, in avatar mode). Meet is already asking for devices; it
  // waits until these are up.
  let startWith = {};
  if (MODE === "avatar") {
    const s = await app.anamSession().catch((e) => {
      log(`  no face to start with (${e.message}) — she will speak without it`);
      return null;
    });
    if (s) avatarId = s.avatarId;
    // The face connects when somebody else is there: minutes spent on an empty room are
    // minutes billed for nothing.
    startWith = { token: s?.sessionToken, idleClip: readIdleClip(s?.avatarId), faceLater: true };
  }
  // Started on whichever page she is on, and again if it navigates: Teams' launcher loads
  // a new page, whose fresh copy of her script would otherwise leave Teams waiting for a
  // microphone that never comes.
  let announcedVoice = false;
  const ensureStarted = async () => {
    const started = await page.evaluate(() => Boolean(window.__ava?.started?.())).catch(() => true);
    if (started) return;
    await page.evaluate((o) => window.__ava?.start(o), startWith).catch(() => {});
    // The first Anam token is used up by the first start; later ones fetch their own.
    startWith = { ...startWith, token: undefined };
    if (!announcedVoice) {
      announcedVoice = true;
      log(MODE === "avatar" ? "  her voice is up, and her face" : "  her voice is up (voice mode, no camera)");
    }
  };
  // Meet asks for devices on the first page. Teams only on its pre-join page, and starting
  // her on the launcher before that would spend a face session on a page about to vanish.
  if (platform.id === "meet") await ensureStarted();

  // 5 — walk in.
  try {
    await platform.join(page, log, MODE, { ready: ensureStarted });
  } catch (e) {
    await page.evaluate(() => window.__ava?.end?.()).catch(() => {});
    await context.close().catch(() => {});
    // Nobody let her in, or the page was not what we expected: close the meeting so the
    // control room does not show her as in it.
    await app.stop().catch(() => {});
    throw e;
  }
  await platform.captionsOn(page, log);
  log("  in the meeting");

  // 6 — the conversation.
  let pending = null;
  /** A reply she held back because somebody carried on talking; the server re-queues it. */
  let dropped = null;
  let aloneSince = null;
  /** Whether anybody else has been in the call — until then, being alone is just early. */
  let sawOthers = false;
  /** Nobody else ever arrived: there is nothing to write up. */
  let nobodyCame = false;
  /** Email addresses typed in the meeting chat — every one seen, and those not yet sent on. */
  const chatEmails = new Set();
  const newEmails = [];
  const seenBots = new Set();
  /** Whether she is the only one in the call right now, and for how many checks in a row. */
  let alone = false;
  let aloneChecks = 0;
  /** Checks in a row that found no hang-up button: one alone is Teams hiding its toolbar. */
  let outOfCall = 0;
  const inCallAt = Date.now();
  let snapshotTaken = false;
  let over = false;
  let lastReason = null;
  let faceState = MODE === "avatar" ? "down" : "voice";
  /** Ended from the control room, which then writes and sends the notes itself. */
  let endedElsewhere = false;

  const finish = async (why) => {
    if (over) return;
    over = true;
    log(`  leaving: ${why}`);
  };
  process.once("SIGINT", () => void finish("stopped by you"));

  while (!over) {
    await ensureStarted();
    const lines = heard.splice(0);
    const delivered = pending;
    pending = null;

    try {
      const wordsBefore = wordsHeard;
      const out = await app.tick({
        lines,
        idle: !speaking,
        delivered: delivered?.key,
        deliveredText: delivered?.text,
        deliveredAt: delivered?.at,
        dropped,
        face: speaking ? "speaking" : faceState,
        captions: {
          socket: true,
          received: heardCount,
          secondsSinceLast: lastHeardAt ? Math.round((Date.now() - lastHeardAt) / 100) / 10 : null,
        },
        people,
        // Nobody else here yet: she holds her hello until somebody is.
        // Nobody else here — yet, or any more: nothing to say to an empty room.
        waiting: !sawOthers || alone,
        // Addresses given in the meeting chat since the last tick.
        emails: newEmails.splice(0),
      });

      // Why she is quiet, whenever that changes — "she stopped talking" should be
      // answerable from this log alone.
      if (out.reason && out.reason !== lastReason && !/mid-sentence|still speaking/.test(out.reason)) {
        log(`  · ${out.reason}`);
      }
      if (out.reason) lastReason = out.reason;

      dropped = null;

      // They carried on talking while she was deciding: what she was about to say may
      // answer something they have already moved past. She holds it back, and the server
      // puts what it answered back in her queue, for the next pause with what was said
      // since. Answers to her get more leeway than remarks she volunteers, and are held
      // back once at most — a question put to her has to get its answer eventually.
      const newWords = wordsHeard - wordsBefore;
      const tolerance = out.kind === "volunteer" ? 4 : (out.attempt ?? 0) >= 1 ? Number.POSITIVE_INFINITY : 8;
      if (out.say && out.key && newWords >= tolerance) {
        log(`  (held back — they kept talking; she answers at the next pause) ${out.say}`);
        dropped = out.key;
        out.say = null;
      }

      // Ended from the control room: leave the call. Without this her Chrome stayed in
      // the meeting after you had ended it, then sent the notes again when it finally left.
      if (out.status && out.status !== "live") {
        endedElsewhere = true;
        await finish(`the meeting was ended from the control room (${out.status})`);
        break;
      }

      if (out.say && !speaking) {
        speaking = true;
        wordsWhenSheStarted = wordsHeard;
        const { say, key } = out;
        const at = Date.now();
        log(`  ▸ ${say}`);
        // Not awaited: the loop keeps listening while she talks, which is what lets
        // somebody interrupt her.
        // Avatar mode sends raw audio, which is what her face lip-syncs to.
        const spoken = speech(say, MODE === "avatar" ? "pcm_16000" : undefined).then((audio) =>
          page.evaluate((a) => window.__ava.play(a), audio),
        );
        void spoken
          .then((ok) => {
            if (ok && key) pending = { key, text: say, at };
            else log("  (could not say it)");
          })
          .catch((e) => log(`  (could not say it: ${e.message})`))
          .finally(() => {
            speaking = false;
            wake();
          });
      }
    } catch (e) {
      if (delivered) pending = delivered;
      log(`  tick failed: ${e.message}`);
    }

    // Has the meeting ended, or has everybody gone?
    const state = await page
      .evaluate(platform.state, PEOPLE)
      .catch(() => ({ inCall: false, ended: false, alone: false, people: null, face: null }));
    if (state.face) faceState = state.face;
    // Other notetakers in the call are not people: say once which ones she is not counting.
    for (const b of state.bots ?? []) {
      if (seenBots.has(b)) continue;
      seenBots.add(b);
      log(`  not counting ${b} — a notetaker, not a person`);
    }
    if (state.people !== people && state.people) log(`  ${state.people} in the call`);
    people = state.people;

    // Teams is new to her: a snapshot of the page once she is settled in, to check what
    // she can see — captions, the people count — against what she reads from it.
    if (platform.id === "teams" && !snapshotTaken && Date.now() - inCallAt > 20_000) {
      snapshotTaken = true;
      await keepEvidence(page, "teams-in-call", log);
    }

    outOfCall = state.inCall ? 0 : outOfCall + 1;
    if (state.ended || outOfCall >= 3) {
      if (platform.id === "teams") await keepEvidence(page, "teams-ended", log);
      await finish(state.ended ? "the meeting ended" : "she is no longer in the call");
      break;
    }
    // Somebody else is here: say hello, and bring her face up for them.
    if (!sawOthers && ((state.people ?? 0) >= 2 || heardCount > 0)) {
      sawOthers = true;
      log("  somebody is here");
      if (MODE === "avatar") void page.evaluate(() => window.__ava?.warm()).catch(() => {});
      if (platform.askForEmails) {
        await platform.askForEmails(
          page,
          log,
          `Hi, I'm ${DISPLAY_NAME}, NDI's meeting assistant. I'll email a summary with the actions after the meeting — type your email address here if you'd like it.`,
        );
      }
      wake();
    }

    // Email addresses people typed in the meeting chat: they get the notes too.
    if (platform.chatEmails) {
      const found = await page.evaluate(platform.chatEmails).catch(() => []);
      for (const email of found) {
        if (chatEmails.has(email)) continue;
        chatEmails.add(email);
        newEmails.push(email);
        log(`  the notes will also go to ${email}`);
      }
    }

    // How she knows she is alone: the page's own count of people in the call is one —
    // her — or it says so in words ("You're the only one here", "Waiting for others to
    // join"). See `state` in platforms.mjs for each product.
    const aloneNow = state.alone || state.people === 1;
    aloneChecks = aloneNow ? aloneChecks + 1 : 0;

    // Her face is billed by the minute: put it to rest as soon as the room is empty, and
    // bring it back the moment somebody returns.
    if (MODE === "avatar" && sawOthers) {
      if (aloneChecks === ALONE_CHECKS) {
        log("  nobody else here — her face rests");
        void page.evaluate(() => window.__ava?.rest?.()).catch(() => {});
      } else if (!aloneNow && alone) {
        log("  somebody is back");
        void page.evaluate(() => window.__ava?.warm()).catch(() => {});
      }
    }
    alone = aloneNow;

    // Leaving an empty room: five minutes, whether nobody turned up (counted from the
    // start time — she may have come early) or everybody has gone (in case they come
    // back). Her face session is closed on the way out either way.
    if (!sawOthers) {
      const deadline = Math.max(inCallAt, meeting.startsAt ?? 0) + NOBODY_MS;
      if ((aloneNow && Date.now() > deadline) || Date.now() - inCallAt > NOBODY_CAP_MS) {
        nobodyCame = true;
        await finish("nobody came");
        break;
      }
    } else if (aloneNow) {
      aloneSince ??= Date.now();
      if (Date.now() - aloneSince > ALONE_MS) {
        await finish("everybody else left");
        break;
      }
    } else {
      aloneSince = null;
    }

    await Promise.race([sleep(TICK_MS), new Promise((r) => (wake = r))]);
  }

  // 7 — after: leave, then the notes.
  // Her face first: a session left for Anam to time out is billed until it does.
  await page.evaluate(() => window.__ava?.end?.()).catch(() => {});
  await platform.leave(page).catch(() => {});
  await context.close().catch(() => {});

  // The control room is already writing the notes when it ended the meeting. Writing
  // them here as well, a second later, would race it and mail the guests twice.
  if (endedElsewhere) {
    log("  notes are being sent from the control room");
    return;
  }

  await app.stop().catch((e) => log(`  could not close the meeting: ${e.message}`));
  if (nobodyCame) {
    log("  nobody came — no notes to send");
    return;
  }
  try {
    const r = await app.sendNotes();
    log(r.delivered?.sent ? `  notes sent to ${r.followUp?.to}` : "  notes written — nobody to send them to");
  } catch (e) {
    log(`  notes not sent: ${e.message}`);
  }
}
