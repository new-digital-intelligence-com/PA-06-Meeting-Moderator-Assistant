// Settings for the runner, from bot/.env.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "..");

const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

/** The deployed app: her brain, her memory, her Anam token. */
export const APP = (process.env.AVA_APP_URL || "").replace(/\/$/, "");

/**
 * Where her signed-in Chrome profile lives.
 *
 * Deliberately NOT inside the project folder: this project sits in OneDrive, and a
 * Chrome profile being synced mid-write corrupts it — the usual symptom is being signed
 * out at random. Local app data is never synced.
 */
export const PROFILE =
  process.env.AVA_PROFILE_DIR ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "ava-runner", "chrome-profile");

/** Real Chrome, not bundled Chromium: Google trusts it, and Meet supports it fully. */
export const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((p) => p && fs.existsSync(p));

/** Her calendar's private iCal address. Her invites arrive here. */
export const CALENDAR_ICS = process.env.AVA_CALENDAR_ICS_URL || "";

/** How long before the start time she opens the meeting. */
export const EARLY_MS = Number(process.env.AVA_JOIN_EARLY_SECONDS || 60) * 1000;

export function requireApp() {
  if (!APP) {
    throw new Error("AVA_APP_URL is not set in bot/.env — it is the deployed app, e.g. https://pa-06-meeting-moderator-assistant.vercel.app");
  }
  return APP;
}

export function requireChrome() {
  if (!CHROME) throw new Error("Could not find Google Chrome. Install it, or set CHROME_PATH in bot/.env.");
  return CHROME;
}
