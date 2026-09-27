// Ava attending one meeting, in person: her own signed-in Chrome, her avatar as the
// camera, her voice as the microphone, Meet's captions as her ears.
import path from "node:path";
import { chromium } from "playwright-core";
import * as app from "./app.mjs";
import { MODE, NAMES, PROFILE, platformArgs, requireChrome, root } from "./config.mjs";
import { speech } from "./voice.mjs";

/** The heartbeat. Being named cuts it short — see `wake`. */
const TICK_MS = 1200;
/** How long she stays once she is the only one left. */
const ALONE_MS = 3 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Attends one meeting from start to finish, then writes and sends the notes.
 *
 * @param {{ meetingUrl: string, title?: string, context?: string, recipients?: string[] }} meeting
 */
export async function attend(meeting, { log = console.log } = {}) {
  // Any of her names — captions often hear "Ava" as "Eva".
  const escaped = NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const name = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");

  // 1 — brief her, and tell the server this is a real meeting she is attending in person.
  await app.brief({
    title: meeting.title || "Meeting",
    meetingUrl: meeting.meetingUrl,
    context: meeting.context || "",
    recipients: meeting.recipients || [],
    joinAt: null,
  });
  await app.attend();
  log(`  briefed: ${meeting.title || meeting.meetingUrl}`);

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
  await context.grantPermissions(["camera", "microphone"], { origin: "https://meet.google.com" });

  // 3 — her ears. Meet labels your own captions "You", which is her: never an input.
  const heard = [];
  let heardCount = 0;
  let lastHeardAt = null;
  let speaking = false;
  let wake = () => {};

  await context.exposeBinding("__avaLog", (_src, m) => log(`  [meet] ${m}`));
  await context.exposeBinding("__avaHeard", (_src, speaker, text, blockId) => {
    if (!text || /^you$/i.test(speaker)) return;
    heardCount++;
    lastHeardAt = Date.now();
    // Meet rewrites a caption as the sentence goes on. Only the latest version of each
    // caption block is worth sending; the server replaces the line in place by this id.
    const id = blockId || `m${heardCount}`;
    const line = { id, speaker, text, at: Date.now() };
    const i = heard.findIndex((h) => h.id === id);
    if (i >= 0) heard[i] = line;
    else heard.push(line);

    // Somebody talked over her: stop, like a person would.
    if (speaking) {
      void page.evaluate(() => window.__ava?.interrupt()).catch(() => {});
      speaking = false;
    }
    // Named: answer now rather than on the next heartbeat.
    if (name.test(text)) wake();
  });
  await context.addInitScript({ content: `window.__AVA_MODE = ${JSON.stringify(MODE)};` });
  await context.addInitScript({ path: path.join(root, "dist", "ava.js") });

  const page = context.pages()[0] ?? (await context.newPage());
  const url = new URL(meeting.meetingUrl);
  url.searchParams.set("hl", "en"); // English UI, so the buttons below have names we know
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });

  // 4 — her voice (and face, in avatar mode). Meet is already asking for devices; it
  // waits until these are up.
  const token = MODE === "avatar" ? await app.anamToken() : undefined;
  await page.evaluate((t) => window.__ava.start(t), token);
  log(MODE === "avatar" ? "  her face and voice are up" : "  her voice is up (voice mode, no camera)");

  // 5 — walk in.
  await join(page, log, MODE);
  await captionsOn(page, log);
  log("  in the meeting");

  // 6 — the conversation.
  let pending = null;
  let aloneSince = null;
  let over = false;
  /** Ended from the control room, which then writes and sends the notes itself. */
  let endedElsewhere = false;

  const finish = async (why) => {
    if (over) return;
    over = true;
    log(`  leaving: ${why}`);
  };
  process.once("SIGINT", () => void finish("stopped by you"));

  while (!over) {
    const lines = heard.splice(0);
    const delivered = pending;
    pending = null;

    try {
      const out = await app.tick({
        lines,
        idle: !speaking,
        delivered: delivered?.key,
        deliveredText: delivered?.text,
        face: speaking ? "speaking" : "live",
        captions: {
          socket: true,
          received: heardCount,
          secondsSinceLast: lastHeardAt ? Math.round((Date.now() - lastHeardAt) / 1000) : null,
        },
      });

      // Ended from the control room: leave the call. Without this her Chrome stayed in
      // the meeting after you had ended it, then sent the notes again when it finally left.
      if (out.status && out.status !== "live") {
        endedElsewhere = true;
        await finish(`the meeting was ended from the control room (${out.status})`);
        break;
      }

      if (out.say && !speaking) {
        speaking = true;
        const { say, key } = out;
        log(`  ▸ ${say}`);
        // Not awaited: the loop keeps listening while she talks, which is what lets
        // somebody interrupt her.
        const spoken =
          MODE === "avatar"
            ? page.evaluate((t) => window.__ava.talk(t), say)
            : speech(say).then((audio) => page.evaluate((a) => window.__ava.play(a), audio));
        void spoken
          .then((ok) => {
            if (ok && key) pending = { key, text: say };
          })
          .catch(() => {})
          .finally(() => {
            speaking = false;
          });
      }
    } catch (e) {
      if (delivered) pending = delivered;
      log(`  tick failed: ${e.message}`);
    }

    // Has the meeting ended, or has everybody gone?
    const state = await page
      .evaluate(() => ({
        inCall: Boolean(document.querySelector('[aria-label*="Leave call" i]')),
        text: document.body?.innerText?.slice(0, 4000) ?? "",
      }))
      .catch(() => ({ inCall: false, text: "" }));

    if (!state.inCall || /you left the meeting|meeting has ended|you've been removed|return to home screen/i.test(state.text)) {
      await finish("the meeting ended");
      break;
    }
    if (/you're the only one here|only one here/i.test(state.text)) {
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
  await page
    .getByRole("button", { name: /leave call/i })
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await context.close().catch(() => {});

  // The control room is already writing the notes when it ended the meeting. Writing
  // them here as well, a second later, would race it and mail the guests twice.
  if (endedElsewhere) {
    log("  notes are being sent from the control room");
    return;
  }

  await app.stop().catch((e) => log(`  could not close the meeting: ${e.message}`));
  try {
    const r = await app.sendNotes();
    log(r.delivered?.sent ? `  notes sent to ${r.followUp?.to}` : "  notes written — nobody to send them to");
  } catch (e) {
    log(`  notes not sent: ${e.message}`);
  }
}

/** Gets from the pre-join screen into the call. */
async function join(page, log, mode = "voice") {
  // A guest name box means she is not signed in, and would arrive as an anonymous
  // stranger knocking at the door. Refuse rather than do that.
  const guest = page.getByRole("textbox", { name: /your name/i });
  if (await guest.isVisible({ timeout: 8000 }).catch(() => false)) {
    throw new Error("She is not signed in to Google in this profile. Run `npm run login` first.");
  }

  // Meet layers tips and announcements over the pre-join screen ("Got it", "Dismiss"),
  // and one sitting on top of the Join button is enough to strand her in the lobby.
  await dismissPopups(page);

  // Make sure camera and microphone are on before walking in — Meet remembers the last
  // choice per account, and she must never arrive muted with her camera off.
  // In voice mode there is no camera to turn on — she joins with her profile photo.
  const wanted = mode === "avatar" ? [/turn on microphone/i, /turn on camera/i] : [/turn on microphone/i];
  for (const label of wanted) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.isVisible({ timeout: 1500 }).catch(() => false)) await b.click().catch(() => {});
  }

  const button = page.getByRole("button", { name: /^(join now|ask to join|join)$/i }).first();
  await button.waitFor({ state: "visible", timeout: 60_000 });
  const label = (await button.textContent())?.trim();
  await button.click();
  log(`  pressed "${label}"`);
  // A confirmation can follow the click in voice mode ("continue without camera?").
  await dismissPopups(page);

  if (/ask to join/i.test(label ?? "")) {
    log("  she is waiting to be let in — this meeting does not recognise her as invited");
  }

  await page.waitForSelector('[aria-label*="Leave call" i]', { timeout: 10 * 60_000 });
}

/** Clears Meet's tips and one-off announcements, which otherwise block the buttons. */
async function dismissPopups(page) {
  for (let round = 0; round < 3; round++) {
    let cleared = false;
    // "Continue without camera" / "Join anyway": in voice mode she has no camera on
    // purpose, and Meet can ask to confirm that before letting her in.
    for (const label of [/^got it$/i, /^dismiss$/i, /^no thanks$/i, /^close$/i, /continue without (camera|video)/i, /^join anyway$/i]) {
      const b = page.getByRole("button", { name: label }).first();
      if (await b.isVisible({ timeout: 800 }).catch(() => false)) {
        await b.click().catch(() => {});
        cleared = true;
      }
    }
    if (!cleared) return;
  }
}

/** Her ears are Meet's own captions, so they must be on. */
async function captionsOn(page, log) {
  const on = page.getByRole("button", { name: /turn on captions/i }).first();
  if (await on.isVisible({ timeout: 5000 }).catch(() => false)) {
    await on.click().catch(() => {});
  } else {
    await page.keyboard.press("c").catch(() => {});
  }
  log("  captions on");
}
