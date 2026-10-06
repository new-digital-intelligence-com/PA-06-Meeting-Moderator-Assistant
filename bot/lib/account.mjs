// Is she signed in to Google in her Chrome profile — and if not, get her signed in.
//
// On the server there is nobody at a keyboard, so signing in happens through the web view
// of her screen (https://<host>/vnc.html): a normal Chrome window opens there at the
// Google sign-in page, you sign in as her, and close it. That has to be a normal window,
// not one driven by automation, because Google refuses sign-ins from automated browsers.
// Checking whether she is signed in, on the other hand, is fine to automate.
//
// Each of her seats has its own profile (config.mjs, profileFor). Seat 1 is signed in as
// above; the others are copies of seat 1's — the same signed-in Google account — so she is
// signed in once, not once per seat.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { IN_CONTAINER, PROFILE, platformArgs, profileFor, requireChrome } from "./config.mjs";

const SIGN_IN_TIMEOUT_MS = 30 * 60_000;

/** Returns her signed-in address in a seat's profile, or null if she is signed out there. */
export async function signedInAs(seat = 1) {
  const dir = profileFor(seat);
  fs.mkdirSync(dir, { recursive: true });
  const context = await chromium.launchPersistentContext(dir, {
    executablePath: requireChrome(),
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", ...platformArgs()],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://myaccount.google.com/personal-info", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    // Signed out, Google bounces to its sign-in page on accounts.google.com.
    if (new URL(page.url()).hostname !== "myaccount.google.com") return null;
    // Her address is on the personal-info page. Workspace also shows an internal alias
    // ending in .test-google-a.com, which is not the one anybody means.
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])];
    return emails.find((e) => !e.endsWith(".test-google-a.com")) ?? emails[0] ?? "an unidentified account";
  } finally {
    await context.close().catch(() => {});
  }
}

/** What is not copied from a profile: a running Chrome's locks, and caches — a copy that size would take minutes on a small disk. */
const NOT_COPIED =
  /[\\/](Singleton\w*|lockfile|Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad|Crash Reports|component_crx_cache|BrowserMetrics[^\\/]*)$/;

/**
 * A seat's profile as a copy of seat 1's — signed in as her the same way — when it has
 * none yet, or `again` (Google signed that seat out). Only while no Chrome uses either.
 * Returns whether it copied.
 */
export function copyProfile(seat, { log = console.log, again = false } = {}) {
  const to = profileFor(seat);
  if (to === PROFILE) return false;
  if (!again && fs.existsSync(path.join(to, "Default"))) return false;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(PROFILE, to, { recursive: true, filter: (src) => !NOT_COPIED.test(src) });
  log(`  seat ${seat}: her Chrome profile copied from seat 1`);
  return true;
}

/**
 * Blocks until she is signed in (in seat 1's profile, unless another seat is said). Opens
 * the sign-in window whenever she is not, and keeps asking — a runner that silently
 * carries on signed out would knock on every meeting as an anonymous guest, which is
 * precisely what this whole arrangement exists to avoid.
 */
export async function ensureSignedIn({ log = console.log, seat = 1 } = {}) {
  for (;;) {
    const who = await signedInAs(seat).catch((e) => {
      log(`  could not check her Google sign-in: ${e.message}`);
      return null;
    });
    if (who) {
      log(`  signed in to Google as ${who}${seat > 1 ? ` (seat ${seat})` : ""}`);
      return who;
    }

    log("  ─────────────────────────────────────────────────────────────");
    log(`  She is NOT signed in to Google${seat > 1 ? ` in seat ${seat}` : ""}.`);
    log(
      IN_CONTAINER
        ? "  Open https://<this server>/vnc.html  (user: ava, password: AVA_ADMIN_PASSWORD)"
        : "  A Chrome window is opening on this machine.",
    );
    log("  Sign in there as ava@…, then CLOSE that Chrome window.");
    log("  ─────────────────────────────────────────────────────────────");

    const chrome = spawn(
      requireChrome(),
      [
        `--user-data-dir=${profileFor(seat)}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized",
        ...platformArgs(),
        "https://accounts.google.com/",
      ],
      { stdio: "ignore" },
    );
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.kill();
        resolve();
      }, SIGN_IN_TIMEOUT_MS);
      chrome.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    log("  sign-in window closed — checking again");
  }
}

/**
 * Her other seats, ready: each a copy of seat 1's profile, checked like it, and copied
 * again if Google signed it out. Seats count from 1 without gaps — the first that cannot
 * be signed in ends the list. Returns the seats ready, [1] at least.
 */
export async function readySeats(count, { log = console.log } = {}) {
  const ready = [1];
  for (let seat = 2; seat <= count; seat++) {
    try {
      copyProfile(seat, { log });
      let who = await signedInAs(seat);
      if (!who && copyProfile(seat, { log, again: true })) who = await signedInAs(seat);
      if (!who) {
        log(`  seat ${seat}: not signed in — she uses ${ready.length} seat${ready.length > 1 ? "s" : ""}`);
        break;
      }
      ready.push(seat);
      log(`  seat ${seat}: signed in as ${who}`);
    } catch (e) {
      log(`  seat ${seat}: ${e.message} — she uses ${ready.length} seat${ready.length > 1 ? "s" : ""}`);
      break;
    }
  }
  return ready;
}
