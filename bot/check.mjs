// Is she working in a meeting? Opens a Google Meet or Teams pre-join screen with a
// throwaway profile, starts her voice (and face), has her say a line and takes a
// screenshot. It never presses Join, so nobody in the meeting is notified.
//
//   npm run check -- https://meet.google.com/abc-defg-hij
//   npm run check -- <a Teams meeting link>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { anamSession } from "./lib/app.mjs";
import { FACE, MODE, platformArgs, requireChrome, root } from "./lib/config.mjs";
import { speech } from "./lib/voice.mjs";
import { platformOf } from "./lib/platforms.mjs";

const url = process.argv[2];
const platform = platformOf(url ?? "");
if (!platform) {
  console.error("\n  Usage: npm run check -- <a Google Meet or Teams link>\n");
  process.exit(1);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ava-camtest-"));
const shot = process.argv[3] || path.join(os.tmpdir(), "ava-prejoin.png");

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: requireChrome(),
  headless: false,
  bypassCSP: true,
  viewport: { width: 1280, height: 800 },
  ignoreDefaultArgs: ["--enable-automation"],
  args: [
    "--disable-blink-features=AutomationControlled",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    ...platformArgs(),
  ],
});
const logs = [];
await ctx.exposeBinding("__avaLog", (_s, m) => logs.push(m));
await ctx.exposeBinding("__avaHeard", () => {});
await ctx.exposeBinding("__avaAnamToken", async () => (await anamSession()).sessionToken);
await ctx.exposeBinding("__avaIdleClip", (_s, frames) => logs.push(`idle clip: ${frames.length} frames`));
await ctx.addInitScript({
  content: `window.__AVA_MODE = ${JSON.stringify(MODE)}; window.__AVA_FACE = ${JSON.stringify(FACE)};`,
});
await ctx.addInitScript({ path: path.join(root, "dist", "ava.js") });
console.log(`  ${platform.name}, mode: ${MODE}`);

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(platform.url(url), { waitUntil: "domcontentloaded" });

const start = async () => {
  const t0 = Date.now();
  const token = MODE === "avatar" ? (await anamSession()).sessionToken : undefined;
  await page.evaluate((t) => window.__ava.start({ token: t }), token);
  console.log(`  ${MODE} started in ${((Date.now() - t0) / 1000).toFixed(1)}s, face: ${await page.evaluate(() => window.__ava.face())}`);
};

if (platform.id === "teams") {
  // Through the launcher to the pre-join screen, name typed in — everything short of Join.
  await platform.prejoin(page, (m) => console.log(m), MODE, { ready: start });
} else {
  await start();
}
console.log("  in-page script loaded:", await page.evaluate(() => typeof window.__ava?.start === "function"));

// Have her actually say something, which proves the whole path — ElevenLabs, then either
// her microphone directly or her face lip-syncing to it.
const t1 = Date.now();
const audio = await speech("Hi, this is Ava checking my microphone and my face.", MODE === "avatar" ? "pcm_16000" : undefined);
const shotWhileSpeaking = page.waitForTimeout(2500).then(() => page.screenshot({ path: shot.replace(/\.png$/, "-speaking.png") }));
const played = await page.evaluate((a) => window.__ava.play(a), audio);
await shotWhileSpeaking.catch(() => {});
console.log(`  spoke: ${played} (${((Date.now() - t1) / 1000).toFixed(1)}s including voice generation)`);

await page.waitForTimeout(9000);

const state = await page.evaluate(() => {
  const vids = [...document.querySelectorAll("video")].map((v) => ({
    id: v.id,
    playing: !v.paused && v.readyState >= 2,
    w: v.videoWidth,
    h: v.videoHeight,
    tracks: v.srcObject ? v.srcObject.getTracks().map((t) => `${t.kind}:${t.readyState}`) : [],
  }));
  const text = document.body.innerText.slice(0, 600).replace(/\s+/g, " ");
  return { vids, text };
});
console.log("  videos on the page:", JSON.stringify(state.vids, null, 1));
console.log("  page says:", state.text.slice(0, 300));
console.log("  in-page log:", logs);

await page.screenshot({ path: shot });
console.log("  screenshot:", shot);
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
