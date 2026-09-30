// Her live log in a browser, at /logs on the same HTTPS address as her screen, with the
// same user and password (ava / AVA_ADMIN_PASSWORD). It reads the files her runner writes
// to /data/logs, one per day, and streams each new line the moment it is written — so it
// needs no access to Docker, and shows what the terminal shows.
//
//   node logs.mjs            (started by start.sh, on AVA_LOGS_PORT, 8081 by default)

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const DIR = path.join(process.env.AVA_STATE_DIR || "/data", "logs");
const PORT = Number(process.env.AVA_LOGS_PORT || 8081);
const PASSWORD = process.env.AVA_ADMIN_PASSWORD || "";
/** The file of the day, named as her runner names it (UTC date). */
const fileOf = (day) => path.join(DIR, `${day}.log`);
const today = () => new Date().toISOString().slice(0, 10);

/** User "ava" and her screen's password, compared in constant time. */
function authorised(req) {
  const m = /^Basic (.+)$/.exec(req.headers.authorization || "");
  if (!m || !PASSWORD) return false;
  const given = Buffer.from(Buffer.from(m[1], "base64").toString("utf8"));
  const wanted = Buffer.from(`ava:${PASSWORD}`);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

/** The last lines of the day, then every new one as it is written (server-sent events). */
function stream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);

  let day = today();
  let pos = 0;
  let rest = "";
  try {
    const text = fs.readFileSync(fileOf(day), "utf8");
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines.slice(-500)) send(line);
    pos = Buffer.byteLength(text);
  } catch {
    send("(nothing logged yet today)");
  }

  const follow = setInterval(() => {
    if (today() !== day) {
      day = today();
      pos = 0;
      rest = "";
      send(`──────── ${day} ────────`);
    }
    let size;
    try {
      size = fs.statSync(fileOf(day)).size;
    } catch {
      return;
    }
    if (size < pos) pos = 0;
    if (size === pos) return;
    const buf = Buffer.alloc(size - pos);
    const fd = fs.openSync(fileOf(day), "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, pos);
    } finally {
      fs.closeSync(fd);
    }
    pos = size;
    const lines = (rest + buf.toString("utf8")).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) send(line);
  }, 400);
  // Proxies close a quiet connection: a comment every 20 s keeps it open.
  const keepAlive = setInterval(() => res.write(": still here\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(follow);
    clearInterval(keepAlive);
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ava — live log</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0d10; color: #d6dae0; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  header { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: #0b0d10ee; border-bottom: 1px solid #1f242b; }
  header b { font-family: system-ui, sans-serif; font-size: 14px; color: #fff; }
  #dot { width: 8px; height: 8px; border-radius: 50%; background: #666; }
  #dot.live { background: #34d399; box-shadow: 0 0 8px #34d399; }
  #state { color: #8a929c; font-family: system-ui, sans-serif; font-size: 12px; }
  button { margin-left: auto; background: #1a1f26; color: #c9ced6; border: 1px solid #2a313a; border-radius: 6px; padding: 4px 10px; font: 12px system-ui, sans-serif; cursor: pointer; }
  main { padding: 10px 16px 40px; white-space: pre-wrap; word-break: break-word; }
  .l { padding: 0 2px; }
  .said { color: #7dd3fc; }
  .bad { color: #fb7185; }
  .good { color: #6ee7b7; }
  .meet { color: #fcd34d; }
  .dim { color: #6b7380; }
</style>
</head>
<body>
<header><span id="dot"></span><b>Ava — live log</b><span id="state">connecting…</span><button id="pause">Pause</button></header>
<main id="log"></main>
<script>
  const log = document.getElementById("log");
  const dot = document.getElementById("dot");
  const state = document.getElementById("state");
  const pauseButton = document.getElementById("pause");
  let paused = false;
  const held = [];
  const kind = (t) =>
    /▸/.test(t) ? "said" :
    /error|failed|could not|refused|not sent|keeps closing|out of minutes/i.test(t) ? "bad" :
    /notes sent|face live|connected|in the meeting|turned off/i.test(t) ? "good" :
    /→|leaving|finished|somebody is|nobody else/i.test(t) ? "meet" :
    /reading the calendar|still here/i.test(t) ? "dim" : "";
  const nearBottom = () => innerHeight + scrollY >= document.body.scrollHeight - 80;
  const add = (t) => {
    const stick = nearBottom();
    const div = document.createElement("div");
    div.className = "l " + kind(t);
    div.textContent = t;
    log.appendChild(div);
    while (log.childElementCount > 5000) log.firstChild.remove();
    if (stick) scrollTo(0, document.body.scrollHeight);
  };
  pauseButton.onclick = () => {
    paused = !paused;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    if (!paused) held.splice(0).forEach(add);
  };
  const es = new EventSource("/logs/stream");
  es.onopen = () => { dot.className = "live"; state.textContent = "live — new lines appear as they happen"; };
  es.onerror = () => { dot.className = ""; state.textContent = "reconnecting…"; };
  es.onmessage = (e) => { const t = JSON.parse(e.data); paused ? held.push(t) : add(t); };
</script>
</body>
</html>`;

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (!authorised(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Ava log", charset="UTF-8"', "Content-Type": "text/plain" });
      res.end("User ava, and her screen's password.");
      return;
    }
    if (pathname === "/logs" || pathname === "/logs/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(PAGE);
      return;
    }
    if (pathname === "/logs/stream") return stream(req, res);
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`Her live log: https://<this-host>/logs  (user: ava, password: AVA_ADMIN_PASSWORD)`));
