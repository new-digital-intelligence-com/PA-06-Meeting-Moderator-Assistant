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
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ].find((p) => p && fs.existsSync(p));

/**
 * voice (default): she joins camera-off with her profile photo and an ElevenLabs voice.
 * avatar: the same voice, plus the Anam face as her camera, lip-synced to it.
 */
export const MODE = process.env.AVA_MODE === "avatar" ? "avatar" : "voice";

/**
 * Her face's limits. Anam cuts each session off after a set time that depends on the
 * plan (three minutes on Free, five on Starter, ten on Explorer, two hours on Growth), so
 * she renews it before then. And it bills by the minute, so the face rests when the
 * conversation goes quiet.
 */
export const FACE = {
  sessionSeconds: Number(process.env.ANAM_SESSION_SECONDS || 180),
  idleSeconds: Number(process.env.AVA_FACE_IDLE_SECONDS || 45),
};

/** Her name where she has to type one: joining Teams as a guest. */
export const DISPLAY_NAME = (process.env.AVA_DISPLAY_NAME || "Ava").trim();

/** Running in the server container rather than on somebody's desktop. */
export const IN_CONTAINER = process.env.AVA_CONTAINER === "1";

/** Where she keeps what must survive a restart — the list of meetings already attended. */
export const STATE_DIR = process.env.AVA_STATE_DIR || root;

/**
 * Chrome flags that differ between a desktop and the server container.
 *
 * In the container Chrome runs as root, where its sandbox cannot start, and /dev/shm is
 * tiny, which crashes tabs under load. There is also no desktop keyring, and without
 * `basic` Chrome stalls waiting for one — or fails to keep her signed-in cookies at all.
 */
export function platformArgs() {
  const args = [];
  if (IN_CONTAINER) args.push("--no-sandbox", "--disable-dev-shm-usage");
  if (process.platform === "linux") args.push("--password-store=basic");
  return args;
}

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
