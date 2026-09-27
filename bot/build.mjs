// Bundles the in-page script (inject/ava.ts plus the Anam SDK) into one file that
// Playwright can drop into meet.google.com before Meet's own code runs.
import { build } from "esbuild";

await build({
  entryPoints: ["inject/ava.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: "dist/ava.js",
  logLevel: "warning",
});

console.log("built dist/ava.js");
