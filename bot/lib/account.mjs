// Is she signed in to Google in her Chrome profile — and if not, get her signed in.
//
// On the server there is nobody at a keyboard, so signing in happens through the web view
// of her screen (https://<host>/vnc.html): a normal Chrome window opens there at the
// Google sign-in page, you sign in as her, and close it. That has to be a normal window,
// not one driven by automation, because Google refuses sign-ins from automated browsers.
// Checking whether she is signed in, on the other hand, is fine to automate.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { chromium } from "playwright-core";
import { IN_CONTAINER, PROFILE, platformArgs, requireChrome } from "./config.mjs";

const SIGN_IN_TIMEOUT_MS = 30 * 60_000;

/** Returns her signed-in address, or null if she is signed out. */
export async function signedInAs() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: requireChrome(),
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", ...platformArgs()],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    // Signed out, Google bounces to its sign-in page on accounts.google.com.
    if (new URL(page.url()).hostname !== "myaccount.google.com") return null;
    const label = await page
      .locator('[aria-label*="Google Account"]')
      .first()
      .getAttribute("aria-label", { timeout: 5000 })
      .catch(() => null);
    return label?.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "signed in";
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Blocks until she is signed in. Opens the sign-in window whenever she is not, and keeps
 * asking — a runner that silently carries on signed out would knock on every meeting as
 * an anonymous guest, which is precisely what this whole arrangement exists to avoid.
 */
export async function ensureSignedIn({ log = console.log } = {}) {
  for (;;) {
    const who = await signedInAs().catch((e) => {
      log(`  could not check her Google sign-in: ${e.message}`);
      return null;
    });
    if (who) {
      log(`  signed in to Google as ${who}`);
      return who;
    }

    log("  ─────────────────────────────────────────────────────────────");
    log("  She is NOT signed in to Google.");
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
        `--user-data-dir=${PROFILE}`,
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
