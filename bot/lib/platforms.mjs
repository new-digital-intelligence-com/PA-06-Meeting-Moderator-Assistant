// What differs between meeting products: how she gets in, how she switches on the
// captions she listens with, how to tell the call is over, and how to leave. Everything
// else — her voice, her ears, the brain — is the same whichever one it is.
import fs from "node:fs";
import path from "node:path";
import { DISPLAY_NAME, STATE_DIR } from "./config.mjs";
import { CAPTION_LANGUAGE } from "./language.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Other notetaker bots in the call — Fireflies, Otter, Read.ai… They are participants to
 * the meeting, but not people: counting them, she would never find the room empty, and
 * would sit in a finished meeting with one of them, face on, for as long as it stayed.
 * Matched on the name each shows. AVA_IGNORE_PARTICIPANTS adds more, comma-separated.
 */
const BOTS = [
  "fireflies",
  "otter\\.ai",
  "read\\.ai",
  "fathom",
  "tl;?dv",
  "meetgeek",
  "avoma",
  "sembly",
  "bluedot",
  "airgram",
  "supernormal",
  "circleback",
  "tactiq",
  "leexi",
  "noota",
  "claap",
  "notta",
  "krisp",
  "gong\\.io",
  "grain\\.com",
  "recall\\.ai",
  "note ?-?taker",
  "\\bbot\\b",
  "\\brecorder\\b",
  "\\bai notes\\b",
  "meeting notes",
  "\\bai assistant\\b",
  "meeting assistant",
  "\\(ai\\)",
  ...(process.env.AVA_IGNORE_PARTICIPANTS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean),
];

/**
 * What the in-page `state` checks need to tell people from bots, and her from everybody:
 * her own tile says "You" (Meet) or her name (Teams), and is never a bot.
 */
export const PEOPLE = {
  bots: BOTS.join("|"),
  self: `^(you|${DISPLAY_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b|\\(you\\)`,
};

/** Which product a link belongs to, or null. Mirrors lib/platform.ts in the app. */
export function platformOf(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "meet.google.com") return meet;
  if (/^teams\.(microsoft\.com|live\.com|cloud\.microsoft)$/.test(host)) return teams;
  return null;
}

/**
 * When a step fails, keep what the page looked like — a screenshot and its HTML — on her
 * disk. Teams and Meet change their pages without notice, and this is the only way to see
 * what she saw.
 */
export async function keepEvidence(page, step, log) {
  try {
    const base = path.join(STATE_DIR, `debug-${step}`);
    await page.screenshot({ path: `${base}.png` });
    fs.writeFileSync(`${base}.html`, await page.content());
    log(`  saved what she saw to ${base}.png / .html`);
  } catch {
    /* the page is gone; nothing to keep */
  }
}

/* ─────────────────────────────── Google Meet ─────────────────────────────── */

export const meet = {
  id: "meet",
  name: "Google Meet",
  origins: ["https://meet.google.com"],

  /** English UI, so the buttons have names we know. */
  url(link) {
    const u = new URL(link);
    u.searchParams.set("hl", "en");
    return u.toString();
  },

  /** Her own captions are labelled "You". */
  isSelf: (speaker) => /^you$/i.test(speaker),

  async join(page, log, mode = "voice", hooks = {}) {
    await hooks.ready?.();
    // A guest name box means she is not signed in, and would arrive as an anonymous
    // stranger knocking at the door. Refuse rather than do that.
    const guest = page.getByRole("textbox", { name: /your name/i });
    if (await guest.isVisible({ timeout: 8000 }).catch(() => false)) {
      throw new Error("She is not signed in to Google in this profile. Run `npm run login` first.");
    }

    // Meet layers tips and announcements over the pre-join screen ("Got it", "Dismiss"),
    // and one sitting on top of the Join button is enough to strand her in the lobby.
    await dismissMeetPopups(page);

    // Make sure the microphone (and in avatar mode the camera) is on before walking in —
    // Meet remembers the last choice per account, and she must never arrive muted.
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
    await dismissMeetPopups(page);

    if (/ask to join/i.test(label ?? "")) {
      log("  she is waiting to be let in — this meeting does not recognise her as invited");
    }

    await page.waitForSelector('[aria-label*="Leave call" i]', { timeout: 10 * 60_000 });
  },

  /** Her ears are Meet's own captions, so they must be on. */
  async captionsOn(page, log) {
    const on = page.getByRole("button", { name: /turn on captions/i }).first();
    if (await on.isVisible({ timeout: 5000 }).catch(() => false)) {
      await on.click().catch(() => {});
    } else {
      await page.keyboard.press("c").catch(() => {});
    }
    log("  captions on");
  },

  /**
   * The spoken language the captions listen for — Meet's "Meeting language" picker,
   * which sits in the captions bar. Pop-ups (Gemini's among them) can cover it, so it is
   * opened with the keyboard and the option chosen with a direct click event.
   */
  async setLanguage(page, log, lang) {
    const want = CAPTION_LANGUAGE.meet[lang];
    const picker = page.getByRole("combobox", { name: /meeting language/i }).first();
    if (!(await picker.isVisible({ timeout: 5000 }).catch(() => false))) {
      log("  could not find Meet's caption language picker");
      return false;
    }
    if (want.test(((await picker.textContent()) ?? "").replace(/^language/i, "").trim())) {
      log(`  captions already in ${lang}`);
      return true;
    }
    for (const close of [/^close$/i, /^don't show again$/i]) {
      const b = page.locator("[role=dialog]").getByRole("button", { name: close }).first();
      if (await b.isVisible({ timeout: 500 }).catch(() => false)) await b.click().catch(() => {});
    }
    await picker.focus();
    await page.keyboard.press("Enter");
    await sleep(800);
    const options = page.getByRole("option");
    const names = await options.allTextContents();
    const i = names.findIndex((n) => want.test(n.replace(/BETA$/i, "").trim()));
    if (i < 0) {
      await page.keyboard.press("Escape").catch(() => {});
      log(`  Meet offers no caption language matching ${want}`);
      return false;
    }
    await options.nth(i).evaluate((el) => el.click());
    await sleep(1500);
    // Meet can ask to confirm the change for everybody.
    const confirm = page.locator("[role=dialog]").getByRole("button", { name: /^(change|confirm|ok|continue)/i }).first();
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click().catch(() => {});
    log(`  captions switched to ${names[i].replace(/BETA$/i, "").trim()}`);
    return true;
  },

  /** Runs inside the page, so it must be self-contained (and an arrow function: Playwright sends its source). */
  state: (who) => {
    const bot = new RegExp(who.bots, "i");
    const me = new RegExp(who.self, "i");
    // One tile per person, her included, each showing their name. Nested elements repeat
    // the id, so the fullest text for each id is the one to read.
    const tiles = new Map();
    for (const el of document.querySelectorAll("[data-participant-id]")) {
      const id = el.getAttribute("data-participant-id");
      const text = (el.innerText ?? "").trim();
      if (!tiles.has(id) || text.length > tiles.get(id).length) tiles.set(id, text);
    }
    let humans = 0;
    const bots = [];
    for (const text of tiles.values()) {
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const name = lines.find((l) => bot.test(l));
      if (name && !lines.some((l) => me.test(l))) bots.push(name);
      else humans++;
    }
    // The People button's number counts everybody, bots too; it only matters when there
    // are more people than tiles on screen, and then she is plainly not alone.
    let badge = 0;
    for (const b of document.querySelectorAll("button[aria-label]")) {
      if (!/people|everyone|participants/i.test(b.getAttribute("aria-label") ?? "")) continue;
      const n = (b.textContent ?? "").match(/\d+/);
      if (n) badge = Math.max(badge, Number(n[0]));
    }
    const text = document.body?.innerText?.slice(0, 4000) ?? "";
    return {
      inCall: Boolean(document.querySelector('[aria-label*="Leave call" i]')),
      ended: /you left the meeting|meeting has ended|you've been removed|return to home screen/i.test(text),
      alone: /you're the only one here|only one here/i.test(text),
      people: (badge > tiles.size ? badge - bots.length : humans) || null,
      bots,
      face: window.__ava?.face?.() ?? null,
    };
  },

  /**
   * Meet's own voice processing, off. "Studio sound" has Gemini rebuild the voice to sound
   * studio-recorded, and "Adaptive audio" merges laptops sharing a room. Her voice is
   * already clean and synthetic: processed again it came out watery, with an echo, and not
   * the voice GPT-Live made. Meet's tips cover the buttons, so they are clicked from inside
   * the page or forced.
   */
  async cleanAudio(page, log) {
    try {
      await page.evaluate(() => document.querySelector('[aria-label="Audio settings"]')?.click());
      await sleep(1200);
      await page.getByRole("button", { name: "Settings", exact: true }).last().click({ force: true, timeout: 5000 });
      await sleep(1500);
      await page.getByRole("tab", { name: /audio/i }).first().click({ force: true, timeout: 3000 }).catch(() => {});
      await sleep(800);
      for (const name of ["Studio sound", "Adaptive audio"]) {
        const toggle = page.getByRole("switch", { name, exact: true }).first();
        if (!(await toggle.isVisible({ timeout: 1500 }).catch(() => false))) continue;
        if ((await toggle.getAttribute("aria-checked")) !== "true") continue;
        await toggle.click({ force: true }).catch(() => {});
        await sleep(600);
        log((await toggle.getAttribute("aria-checked")) === "false" ? `  Meet's ${name} off` : `  could not turn Meet's ${name} off`);
      }
    } catch (e) {
      log(`  could not open Meet's audio settings: ${e.message.split("\n")[0]}`);
    } finally {
      await page.getByRole("button", { name: "Close dialog" }).first().click({ force: true, timeout: 2000 }).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
    }
  },

  /**
   * Meet shows her nobody's email either. The invite's guests get the notes; a meeting
   * she was sent to without any, she asks in the chat, as in Teams.
   */
  async askForEmails(page, log, message) {
    const box = page.getByRole("textbox", { name: /send a message/i }).first();
    if (!(await box.isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.evaluate(() => document.querySelector('[aria-label="Chat with everyone"]')?.click());
      await sleep(1200);
    }
    if (!(await box.isVisible({ timeout: 5000 }).catch(() => false))) {
      await keepEvidence(page, "meet-chat", log);
      log("  could not open the meeting chat to ask for emails");
      return false;
    }
    await box.click({ force: true });
    await page.keyboard.type(message, { delay: 5 });
    await page.keyboard.press("Enter");
    log("  asked in the chat for emails to send the notes to");
    return true;
  },

  /** Runs inside the page: every email address typed in the meeting chat. */
  chatEmails: () => {
    const text = [...document.querySelectorAll("[data-message-id]")].map((m) => m.innerText || "").join("\n");
    return [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
  },

  async leave(page) {
    await page.getByRole("button", { name: /leave call/i }).first().click({ timeout: 3000 });
  },
};

/** Clears Meet's tips and one-off announcements, which otherwise block the buttons. */
async function dismissMeetPopups(page) {
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

/* ───────────────────────────── Microsoft Teams ───────────────────────────── */

/** The hang-up button, under the names Teams has used for it. Its presence means "in the call". */
const TEAMS_LEAVE =
  '#hangup-button, [data-tid="hangup-main-btn"], [data-tid="call-hangup"], button[aria-label^="Leave" i], button[aria-label^="Hang up" i]';

/**
 * Teams, from the browser, as a guest. No Microsoft account: she types her name, joins,
 * and waits in the lobby until somebody admits her. Nothing reaches her calendar, so she
 * is sent here from the control room.
 */
export const teams = {
  id: "teams",
  name: "Microsoft Teams",
  origins: ["https://teams.microsoft.com", "https://teams.live.com", "https://teams.cloud.microsoft"],

  url: (link) => link,

  /** Teams labels captions with the display name, hers included. */
  isSelf: (speaker) => new RegExp(`^(you|${DISPLAY_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i").test(speaker.trim()),

  /** From the link to the moment she presses Join — also what `npm run check` goes through. */
  async prejoin(page, log, mode = "voice", hooks = {}) {
    // 1 — the launcher offers the desktop app; she stays in the browser.
    const web = page
      .getByRole("button", { name: /continue on this browser|join on the web|use the web app|continue in this browser/i })
      .or(page.getByRole("link", { name: /continue on this browser|join on the web|use the web app/i }))
      .first();
    if (await web.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await web.click().catch(() => {});
      log('  chose "continue on this browser"');
    }

    // 2 — her name. Only guests are asked, which is what she is here.
    const nameBox = page
      .locator('input[data-tid="prejoin-display-name-input"], input[placeholder*="name" i]')
      .or(page.getByRole("textbox", { name: /name/i }))
      .first();
    try {
      await nameBox.waitFor({ state: "visible", timeout: 90_000 });
    } catch {
      await keepEvidence(page, "teams-prejoin", log);
      throw new Error("Teams never showed the name box — see the saved screenshot");
    }
    // This page is the one that asks for a microphone: she must be started on it.
    await hooks.ready?.();
    await nameBox.fill(DISPLAY_NAME);
    log(`  name: ${DISPLAY_NAME}`);

    // 3 — microphone on; the camera only when she has a face.
    await setToggle(page, /microphone|mic\b|audio/i, true, log);
    await setToggle(page, /camera|video/i, mode === "avatar", log);
  },

  async join(page, log, mode = "voice", hooks = {}) {
    await this.prejoin(page, log, mode, hooks);

    const button = page.getByRole("button", { name: /^join now$/i }).first();
    try {
      await button.waitFor({ state: "visible", timeout: 30_000 });
    } catch {
      await keepEvidence(page, "teams-join-button", log);
      throw new Error("Teams showed no Join now button — see the saved screenshot");
    }
    await button.click();
    log('  pressed "Join now" — waiting in the lobby for somebody to admit her');

    // 4 — the lobby. Up to twenty minutes; somebody has to let her in.
    const leave = page.locator(TEAMS_LEAVE).first();
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until) {
      if (await leave.isVisible().catch(() => false)) {
        log("  admitted");
        return;
      }
      const text = (await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "").catch(() => "")) || "";
      if (/denied access|you were removed from the lobby|nobody let you in|no one responded|couldn't join|can't join/i.test(text)) {
        await keepEvidence(page, "teams-lobby", log);
        throw new Error("Teams: she was not let in");
      }
      await sleep(2000);
    }
    await keepEvidence(page, "teams-lobby", log);
    throw new Error("Teams: nobody admitted her within twenty minutes");
  },

  /**
   * The spoken language Teams' captions listen for: caption settings → language → the
   * language → confirm. Worked out from Teams' own names; a step that fails leaves a
   * screenshot, and the captions stay in English.
   */
  async setLanguage(page, log, lang) {
    if (lang === "en") return true;
    const want = CAPTION_LANGUAGE.teams[lang];
    const settings = page
      .locator('[data-tid="closed-captions-settings-menu-trigger-button"], [aria-label*="Caption Settings" i]')
      .first();
    if (!(await settings.isVisible({ timeout: 5000 }).catch(() => false))) {
      await keepEvidence(page, "teams-language", log);
      log("  could not find Teams' caption settings to change the language");
      return false;
    }
    await settings.click().catch(() => {});
    await sleep(700);
    const item = page
      .getByRole("menuitem", { name: /language|spoken/i })
      .or(page.getByRole("button", { name: /language settings|spoken language/i }))
      .first();
    if (!(await item.isVisible({ timeout: 3000 }).catch(() => false))) {
      await keepEvidence(page, "teams-language", log);
      await page.keyboard.press("Escape").catch(() => {});
      log("  Teams showed no caption language setting");
      return false;
    }
    await item.click().catch(() => {});
    await sleep(1000);
    // A dialog with a drop-down of spoken languages.
    const dropdown = page.locator("[role=dialog]").getByRole("combobox").first();
    if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) await dropdown.click().catch(() => {});
    await sleep(700);
    const options = page.getByRole("option");
    const names = await options.allTextContents();
    const i = names.findIndex((n) => want.test(n.trim()));
    if (i < 0) {
      await keepEvidence(page, "teams-language", log);
      await page.keyboard.press("Escape").catch(() => {});
      log(`  Teams offers no caption language matching ${want}`);
      return false;
    }
    await options.nth(i).click().catch(() => options.nth(i).evaluate((el) => el.click()));
    await sleep(500);
    const confirm = page.locator("[role=dialog]").getByRole("button", { name: /^(update|save|confirm|ok|apply)/i }).first();
    if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click().catch(() => {});
    log(`  captions switched to ${names[i].trim()}`);
    return true;
  },

  /** Her ears are Teams' live captions: More → Language and speech → Turn on live captions. */
  async captionsOn(page, log) {
    const captions = /turn on live captions|show live captions|live captions|captions/i;
    const tryMenuItem = async (name) => {
      const item = page
        .getByRole("menuitem", { name })
        .or(page.getByRole("menuitemcheckbox", { name }))
        .or(page.getByRole("button", { name }))
        .first();
      if (await item.isVisible({ timeout: 2500 }).catch(() => false)) {
        await item.click().catch(() => {});
        return true;
      }
      return false;
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      const more = page
        .locator('#callingButtons-showMoreBtn, [data-tid="more-button"], button[aria-label="More"], button[aria-label^="More actions" i]')
        .first();
      if (!(await more.isVisible({ timeout: 5000 }).catch(() => false))) break;
      await more.click().catch(() => {});
      await sleep(600);
      // Newer Teams nests captions under "Language and speech"; older puts them at the top.
      if (await tryMenuItem(/language and speech/i)) await sleep(500);
      if (await tryMenuItem(captions)) {
        log("  live captions on");
        return;
      }
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(800);
    }
    await keepEvidence(page, "teams-captions", log);
    log("  could not find the live captions switch — she cannot hear the room (see the saved screenshot)");
  },

  /** Runs inside the page, so it must be self-contained (and an arrow function: Playwright sends its source). */
  state: (who) => {
    const bot = new RegExp(who.bots, "i");
    const me = new RegExp(who.self, "i");
    const text = document.body?.innerText?.slice(0, 6000) ?? "";
    // The People button's number counts everybody, bots too. Read by its id first: its
    // "People" label is not on the button itself, and a real call showed "3 People"
    // while she counted two.
    let roster = Number((document.querySelector("#roster-button")?.textContent ?? "").match(/\d{1,3}/)?.[0] ?? 0);
    for (const b of document.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
      const label = b.getAttribute("aria-label") ?? "";
      if (!/people|participants|roster/i.test(label)) continue;
      const n = `${label} ${b.textContent ?? ""}`.match(/\b(\d{1,3})\b/);
      if (n) roster = Math.max(roster, Number(n[1]));
    }
    // One tile per person, her included, named in its data-tid:
    // data-tid="video-item-container-<name>".
    const names = [
      ...new Set(
        [...document.querySelectorAll('[data-tid^="video-item-container-"]')].map((e) =>
          (e.getAttribute("data-tid") ?? "").slice("video-item-container-".length),
        ),
      ),
    ];
    const bots = names.filter((n) => bot.test(n) && !me.test(n));
    const humans = names.length - bots.length;
    // More people than tiles on screen: some are off it, and she is plainly not alone.
    const people = names.length ? (roster > names.length ? roster - bots.length : humans) : roster;
    return {
      inCall: Boolean(
        document.querySelector(
          '#hangup-button, [data-tid="hangup-main-btn"], [data-tid="call-hangup"], button[aria-label^="Leave" i], button[aria-label^="Hang up" i]',
        ),
      ),
      ended: /you left the meeting|the meeting has ended|this meeting has ended|you've been removed|you have been removed|call ended/i.test(text),
      alone: /waiting for others to join|you're the only one here|no one else is here/i.test(text),
      people: people || null,
      bots,
      face: window.__ava?.face?.() ?? null,
    };
  },

  // Teams' own noise suppression is not something a guest can reach from the call.
  cleanAudio: null,

  /**
   * Teams shows her nobody's email — guests have none there, and a signed-in person's is
   * not visible to a guest — so she asks in the meeting chat, which everybody can type in.
   */
  async askForEmails(page, log, message) {
    const box = page.locator('[data-tid="ckeditor"][role="textbox"], [role="textbox"][aria-label="Type a message"]').first();
    if (!(await box.isVisible({ timeout: 1500 }).catch(() => false))) {
      await page.locator('#chat-button, button[aria-label="Chat"]').first().click().catch(() => {});
      await sleep(800);
    }
    if (!(await box.isVisible({ timeout: 5000 }).catch(() => false))) {
      await keepEvidence(page, "teams-chat", log);
      log("  could not open the meeting chat to ask for emails");
      return false;
    }
    await box.click();
    await page.keyboard.type(message, { delay: 5 });
    await page.keyboard.press("Enter");
    log("  asked in the chat for emails to send the notes to");
    return true;
  },

  /** Runs inside the page: every email address typed in the meeting chat. */
  chatEmails: () => {
    const pane =
      document.querySelector('[data-tid="message-pane-list-viewport"]') ??
      document.querySelector('[data-tid="message-pane-body"]');
    const text = pane?.innerText ?? "";
    return [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
  },

  async leave(page) {
    await page.locator(TEAMS_LEAVE).first().click({ timeout: 3000 });
  },
};

/**
 * Sets an on/off switch on the pre-join screen. Teams draws them as switches or
 * checkboxes named after the device; whatever their exact wording, the state is in
 * `aria-checked` / `aria-pressed`.
 */
async function setToggle(page, what, on, log) {
  for (const role of ["switch", "checkbox", "button"]) {
    const el = page.getByRole(role, { name: what }).first();
    if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) continue;
    const state = (await el.getAttribute("aria-checked").catch(() => null)) ?? (await el.getAttribute("aria-pressed").catch(() => null));
    if (state === null) return; // a button with no state: leave it alone rather than guess
    if ((state === "true") !== on) {
      await el.click().catch(() => {});
      log(`  ${what.source.split("|")[0]} ${on ? "on" : "off"}`);
    }
    return;
  }
}
