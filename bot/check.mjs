// Is her face working in Meet? Opens a meeting's pre-join screen with a throwaway guest
// profile, turns her on as the camera and takes a screenshot. It never presses Join, so
// nobody in the meeting is notified.
//
//   npm run check -- https://meet.google.com/abc-defg-hij
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { anamToken } from "./lib/app.mjs";
import { requireChrome, root } from "./lib/config.mjs";

const url = process.argv[2];
if (!url?.startsWith("https://meet.google.com/")) {
  console.error("\n  Usage: npm run check -- https://meet.google.com/abc-defg-hij\n");
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
  ],
});
const logs = [];
await ctx.exposeBinding("__avaLog", (_s, m) => logs.push(m));
await ctx.exposeBinding("__avaHeard", () => {});
await ctx.addInitScript({ path: path.join(root, "dist", "ava.js") });

const page = ctx.pages()[0] ?? (await ctx.newPage());
const u = new URL(url);
u.searchParams.set("hl", "en");
await page.goto(u.toString(), { waitUntil: "domcontentloaded" });

const hasAva = await page.evaluate(() => typeof window.__ava?.start === "function");
console.log("  in-page script loaded:", hasAva);

const t0 = Date.now();
await page.evaluate((t) => window.__ava.start(t), await anamToken());
console.log(`  anam started in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

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
