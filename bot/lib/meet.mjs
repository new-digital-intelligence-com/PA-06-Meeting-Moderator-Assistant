// Ava attending one meeting, in person: her own Chrome, her voice as the microphone (and
// in avatar mode her face as the camera), the meeting's own captions as her ears. What
// differs between Google Meet and Teams lives in platforms.mjs.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import * as app from "./app.mjs";
import { BRAIN, DISPLAY_NAME, FACE, MODE, PROFILE, STATE_DIR, platformArgs, requireChrome, root } from "./config.mjs";
import { connectLive } from "./live.mjs";
import { speech } from "./voice.mjs";
import { PEOPLE, keepEvidence, platformOf } from "./platforms.mjs";
import { CHAT_ASK, langOf } from "./language.mjs";

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

const LANGUAGE_NAME = { en: "English", de: "German", ar: "Arabic" };

/**
 * What GPT-Live is told at the start of a session: who she is, the briefing, and the
 * policies OpenAI's Live prompting guide asks for — backchannels, interruptions, and
 * what to hand over to Claude.
 */
function liveInstructions(meeting, lang, product) {
  const language = LANGUAGE_NAME[lang];
  return [
    "# Role",
    `You are ${DISPLAY_NAME}, NDI's meeting assistant, taking part in a live ${product} meeting as one of the participants — a colleague on the call, not a phone agent. You hear the meeting's sound; several people may be in it, and silent notes like "[Helmi is speaking]" tell you who is talking. You are taking notes: after the meeting a summary with the actions is emailed to the participants.`,
    "",
    "# This meeting",
    `Title: ${meeting.title || "Meeting"}`,
    "What you were told beforehand:",
    (meeting.context?.trim() || "(nothing — you were given no briefing)").slice(0, 30_000),
    "",
    "# Personality and speech",
    "Warm, calm and to the point. Plain spoken language, usually one to three short sentences; no lists, no reading out of links. Use people's names when you answer them. Lead with the useful bit — no 'great question'.",
    "",
    "# Language",
    `Speak ${language}${lang === "ar" ? " — clear Modern Standard Arabic, following the register people use with you" : ""}. If somebody speaks to you in English, German or Arabic, answer in that language.`,
    "",
    "# When to speak",
    "- One-on-one (you and one other person): everything they say is said to you. Talk with them naturally — answer, react, engage with what they bring up.",
    `- A group: respond when somebody addresses you — by name (${DISPLAY_NAME}; it may sound like Eva) or as "the assistant" — or asks the room something you can clearly answer. Otherwise keep listening while people talk to each other.`,
    "- You will be told when the meeting changes between one-on-one and a group.",
    "- Greet people once. Confirm an instruction once, then act on it. If they give you a role — interviewer, facilitator, timekeeper — play it fully, keep track of where it stands, and move it on yourself.",
    "",
    "# Backchannel policy",
    "One-on-one, an occasional short 'mm-hm' or 'right' while they talk is fine. In a group, do not backchannel.",
    "",
    "# Interruption policy",
    "Stop speaking when somebody interrupts. Listen to what they say and respond to that.",
    "",
    "# Delegation policy",
    "Your backend has the full transcript of this meeting, the actions noted so far and your working notes. Delegate to the backend when:",
    "- somebody asks what was said, agreed or decided earlier in this meeting, for a recap, or for the actions so far;",
    "- somebody asks you to note down or remember an action, a decision or a task;",
    "- the answer depends on facts about this company, these people or this project that are not in what you were told above.",
    "Delegate before answering anything that depends on it: say at most a very short 'one moment' and do not guess the result. Answer general questions from your own knowledge without delegating.",
    "",
    "# Facts",
    "Facts about this company, these people or this project come only from what you were told, what was said, or your backend; otherwise say you don't know. Never invent a decision, a commitment or a deadline.",
  ].join("\n");
}

/** Whether a piece of her voice has any sound in it — Live may stream silence between turns. */
function voiced(b64) {
  const buf = Buffer.from(b64, "base64");
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    if (s > 300 || s < -300) return true;
  }
  return false;
}

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
  // English, German or Arabic: her captions, her voice, what she types in the chat.
  const lang = langOf(meeting.language);

  // 1 — brief her, and tell the server this is a real meeting she is attending in person.
  if (!briefed) {
    await app.brief({
      title: meeting.title || "Meeting",
      meetingUrl: meeting.meetingUrl,
      context: meeting.context || "",
      recipients: meeting.recipients || [],
      joinAt: null,
      language: lang,
    });
  }
  await app.attend();
  log(`  ${briefed ? "sent from the control room" : "briefed"}: ${meeting.title || meeting.meetingUrl} (${platform.name}, ${lang})`);

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

  // GPT-Live (AVA_BRAIN=live): OpenAI's model hears the meeting and holds the conversation.
  const live = BRAIN === "live";
  let rt = null;
  /** "one-on-one" or "group", as last told to her. */
  let rtRoom = null;
  let rtExpiresAt = 0;
  let rtChain = Promise.resolve();
  let rtGreeted = false;
  let rtFailures = 0;
  /** No key, or it keeps failing: she stays quiet rather than retry all meeting. */
  let rtGaveUp = false;
  let rtLastSpeaker = "";
  /** Her voice: the reply being played, and when it last had sound in it. */
  let rtTurn = 0;
  let rtInTurn = false;
  let rtVoicedAt = 0;
  let rtTurnEnd = null;
  /** What the room said, as she heard it — for what she hands over to Claude. */
  let rtHeard = "";
  /** Her lines as GPT-Live transcribes them — reported to the app one per heartbeat. */
  const said = [];
  /** The conversation by caption block, to brief a new session after a reconnect. */
  const recent = new Map();
  /** Who has spoken lately, from the captions: two voices make a group. */
  const voices = new Map();

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

    voices.set(speaker, Date.now());
    if (live) {
      recent.set(id, `${speaker}: ${text}`);
      if (recent.size > 80) recent.delete(recent.keys().next().value);
      // Sound carries no names; the captions do.
      if (rt && speaker !== rtLastSpeaker) {
        rtLastSpeaker = speaker;
        rt.think(`[${speaker} is speaking]`);
      }
    }

    // Somebody talked over her: stop, like a person would. Not for Meet correcting a
    // caption from a moment ago, which used to cut her off at her first word. (GPT-Live
    // hears interruptions for itself.)
    if (!live && speaking && wordsHeard - wordsWhenSheStarted >= 3) {
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
  // The meeting's sound, from her page, straight on to OpenAI — only with somebody there.
  await context.exposeBinding("__avaHear", (_src, b64) => {
    if (rt && !alone) rt.appendAudio(b64);
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
  if (lang !== "en") await platform.setLanguage(page, log, lang).catch((e) => log(`  could not change the caption language: ${e.message}`));
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
    rt?.close();
    rt = null;
  };

  /** One-on-one or a group: two people in the call and one voice lately, or more. */
  const roomNow = () => {
    const since = Date.now() - 10 * 60_000;
    const lately = [...voices.values()].filter((at) => at >= since).length;
    return (people ?? 2) <= 2 && lately <= 1 ? "one-on-one" : "group";
  };
  const tellRoom = () => {
    const room = roomNow();
    if (!rt || room === rtRoom) return;
    rtRoom = room;
    rt.instruct(
      room === "one-on-one"
        ? "The meeting is now one-on-one: just you and one other person. Everything they say is said to you — talk with them naturally."
        : `The meeting is now a group${people ? ` of ${people - 1} people besides you` : ""}. Respond when somebody addresses you or asks something you can clearly answer; otherwise keep listening.`,
    );
    log(room === "one-on-one" ? "  one-on-one: she talks with them" : "  a group: she answers when asked");
  };

  /** Her voice, as GPT-Live makes it: played at once, the silence between turns skipped. */
  const playLive = (b64) => {
    const now = Date.now();
    const sound = voiced(b64);
    if (!sound && (!rtInTurn || now - rtVoicedAt > 700)) return;
    if (sound) rtVoicedAt = now;
    if (!rtInTurn) {
      rtInTurn = true;
      rtTurn++;
      // Her face, for what she is about to say (it connects in about a second and a half).
      if (MODE === "avatar") void page.evaluate(() => window.__ava?.warm()).catch(() => {});
    }
    const turn = `t${rtTurn}`;
    rtChain = rtChain.then(() => page.evaluate(([a, t]) => window.__ava?.feed(a, t), [b64, turn])).catch(() => {});
    clearTimeout(rtTurnEnd);
    rtTurnEnd = setTimeout(() => {
      rtInTurn = false;
      rtChain = rtChain.then(() => page.evaluate(() => window.__ava?.feedDone())).catch(() => {});
    }, 800);
  };

  /** GPT-Live handed something over: Claude answers from the whole meeting. */
  const answerDelegation = async (id) => {
    const asked = rtHeard.slice(-1500);
    log(`  she asks her memory: …${asked.slice(-120).trim()}`);
    try {
      const { say } = await app.ask(asked);
      if (!rt) return;
      if (say) rt.say(say, id);
      else rt.think("Nothing in the meeting or the briefing answers this.", id);
    } catch (e) {
      log(`  her memory did not answer: ${e.message}`);
      rt?.think("The backend could not answer just now. Say you could not check it.", id);
    }
  };

  /**
   * Opens her GPT-Live session: when somebody arrives, when somebody is back after she
   * was alone, and again when it drops or runs out — with the conversation so far.
   */
  const startLive = (resume = false) => {
    if (rtGaveUp) return;
    const openedAt = Date.now();
    const recap = [...recent.values()].join("\n").slice(-16_000);
    rtRoom = null;
    rtExpiresAt = 0;
    try {
      rt = openLive(resume, recap, openedAt);
    } catch (e) {
      rtGaveUp = true;
      log(`  GPT-Live could not start (${e.message}) — she stays quiet`);
      return;
    }
    void page.evaluate(() => window.__ava?.listen(true)).catch(() => {});
    if (!rtGreeted) {
      rtGreeted = true;
      rt.say(
        `You have just joined. Introduce yourself to the room now, briefly, in ${LANGUAGE_NAME[lang]}: you are ${DISPLAY_NAME}, NDI's meeting assistant; you will follow along, take notes and send everyone a summary with the actions afterwards${
          platform.id === "teams" ? ", and anyone who wants the notes can type their email in the meeting chat" : ""
        }.`,
      );
    }
    log(`  GPT-Live is her ears and voice${resume ? " again" : ""}; Claude is her memory`);
  };

  const openLive = (resume, recap, openedAt) => {
    const session = connectLive({
      instructions: liveInstructions(meeting, lang, platform.name),
      history: resume && recap ? `The meeting so far, from its captions (your session was reconnected; carry on from here):\n${recap}` : null,
      log,
      onStarted: (expiresAt) => {
        rtExpiresAt = expiresAt;
        rtFailures = 0;
        tellRoom();
      },
      onAudio: playLive,
      onHeard: (piece) => {
        rtHeard = (rtHeard + piece).slice(-4000);
      },
      onSaid: (text, at) => {
        log(`  ▸ ${text}`);
        recent.set(`said:${at}`, `${DISPLAY_NAME}: ${text}`);
        said.push({ key: `live:${at.toString(36)}:${said.length}`, text, at });
      },
      onDelegation: (id) => void answerDelegation(id),
      onClose: (why, byUs) => {
        // A session she replaced or closed herself: nothing to do.
        if (rt !== session) return;
        rt = null;
        if (byUs || over || alone) return;
        rtFailures = Date.now() - openedAt < 15_000 ? rtFailures + 1 : 0;
        if (rtFailures >= 3) {
          rtGaveUp = true;
          log(`  GPT-Live keeps closing (${why}) — she stays quiet; check OPENAI_API_KEY`);
          return;
        }
        log(`  GPT-Live session ended (${why}) — reconnecting`);
        setTimeout(() => {
          if (!over && !alone && !rt) startLive(true);
        }, 1000);
      },
    });
    return session;
  };

  /** Her session is closed while nobody is there to talk to: it is billed by the minute. */
  const stopLive = (why) => {
    if (!rt) return;
    rt.close();
    rt = null;
    void page.evaluate(() => window.__ava?.listen(false)).catch(() => {});
    log(`  GPT-Live closed — ${why}`);
  };
  process.once("SIGINT", () => void finish("stopped by you"));

  while (!over) {
    await ensureStarted();
    const lines = heard.splice(0);
    const delivered = live ? said.shift() ?? null : pending;
    if (!live) pending = null;

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
        // GPT-Live speaks for her: the app keeps the transcript but says nothing.
        listenOnly: live,
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
        const spoken = speech(say, MODE === "avatar" ? "pcm_16000" : undefined, lang).then((audio) =>
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
      if (delivered) {
        if (live) said.unshift(delivered);
        else pending = delivered;
      }
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
    tellRoom();
    // Live sessions run out after a while: renew ahead of it, in a quiet moment, rather
    // than be cut off mid-sentence.
    if (rt && rtExpiresAt && Date.now() > rtExpiresAt - 60_000 && Date.now() - rtVoicedAt > 3000 && Date.now() - (lastHeardAt ?? 0) > 2000) {
      stopLive("renewing before it runs out");
      startLive(true);
    }

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
      if (live && !rt) startLive();
      if (MODE === "avatar") void page.evaluate(() => window.__ava?.warm()).catch(() => {});
      if (platform.askForEmails) {
        await platform.askForEmails(
          page,
          log,
          CHAT_ASK[lang](DISPLAY_NAME),
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
    if (live && sawOthers) {
      if (aloneChecks === ALONE_CHECKS) stopLive("nobody else here");
      else if (!aloneNow && !rt && !over) startLive(true);
    }

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
