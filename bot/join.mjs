// Ava joins one meeting, now, by link.
//
//   npm run join -- https://meet.google.com/abc-defg-hij
//   npm run join -- https://meet.google.com/abc-defg-hij --to sam@acme.com,priya@acme.com --about "Q3 review"
//   npm run join -- <a Teams meeting link>          (she joins as a guest; admit her from the lobby)
//
// For the everyday case — she turns up to whatever she is invited to — use `npm run watch`.

import { attend } from "./lib/meet.mjs";
import { platformOf } from "./lib/platforms.mjs";

const args = process.argv.slice(2);
const meetingUrl = args.find((a) => platformOf(a));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!meetingUrl) {
  console.error("\n  Usage: npm run join -- <a Google Meet or Teams link> [--to a@x.com,b@y.com] [--about \"what it is about\"]\n");
  process.exit(1);
}

try {
  await attend({
    meetingUrl,
    title: flag("title") || "Meeting",
    context: flag("about") || "",
    recipients: (flag("to") || "").split(",").map((s) => s.trim()).filter(Boolean),
  });
} catch (e) {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
}
