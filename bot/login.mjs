// One-time: sign Ava in to her Google account.
//
// Opens an ordinary Chrome — not one driven by automation — with her own profile. Google
// refuses sign-ins from automated browsers ("this browser may not be secure"), so the
// sign-in has to happen in a normal one. Once it has, the runner reuses the same profile
// and she stays signed in.
//
//   npm run login
//
// Sign in as her, then just close the window.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { PROFILE, requireChrome } from "./lib/config.mjs";

const chrome = requireChrome();
fs.mkdirSync(PROFILE, { recursive: true });

console.log(`\n  Opening Chrome with Ava's profile:\n  ${PROFILE}\n`);
console.log("  1. Sign in as ava@new-digital-intelligence.com");
console.log("  2. Open https://meet.google.com once and allow anything it asks");
console.log("  3. Close the window. That's it — she stays signed in.\n");

const child = spawn(
  chrome,
  [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "https://accounts.google.com/"],
  { stdio: "ignore" },
);

child.on("exit", () => {
  console.log("  Chrome closed. Her profile is saved.\n");
});
