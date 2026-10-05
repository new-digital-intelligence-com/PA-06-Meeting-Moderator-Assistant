// Her live log in a browser, at /logs on the same HTTPS address as her screen, with the
// same user and password (ava / AVA_ADMIN_PASSWORD). It reads the files her runner writes
// to /data/logs, one per day, and streams each new line the moment it is written — so it
// needs no access to Docker, and shows what the terminal shows.
//
//   /logs                  everything, today
//   /logs/clients          the clients she has a log for
//   /logs/client/<id>      one client's meetings alone: their last days, then live
//                          (/data/logs/clients/<id>, written by watch.mjs)
//
//   node logs.mjs            (started by start.sh, on AVA_LOGS_PORT, 8081 by default)

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const DIR = path.join(process.env.AVA_STATE_DIR || "/data", "logs");
const CLIENTS = path.join(DIR, "clients");
const PORT = Number(process.env.AVA_LOGS_PORT || 8081);
const PASSWORD = process.env.AVA_ADMIN_PASSWORD || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A file of the day, named as her runner names it (UTC date). */
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.log$/;
const today = () => new Date().toISOString().slice(0, 10);
const rule = (day) => `──────── ${day} ────────`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** User "ava" and her screen's password, compared in constant time. */
function authorised(req) {
  const m = /^Basic (.+)$/.exec(req.headers.authorization || "");
  if (!m || !PASSWORD) return false;
  const given = Buffer.from(Buffer.from(m[1], "base64").toString("utf8"));
  const wanted = Buffer.from(`ava:${PASSWORD}`);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

function dayFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => DAY_FILE.test(f)).sort();
  } catch {
    return [];
  }
}

/** Their name as her runner last wrote it; before their first meeting, the one in the link. */
function clientName(id, fallback = "") {
  try {
    return fs.readFileSync(path.join(CLIENTS, id, "name.txt"), "utf8").trim() || fallback.trim() || id;
  } catch {
    return fallback.trim().slice(0, 120) || id;
  }
}

/**
 * The last lines of the day, then every new one as it is written (server-sent events).
 * With `earlier`, the lines of the days before come first, each under its date — a
 * client's meetings are days apart, and their log would mostly start empty.
 */
function stream(req, res, dir, { earlier = false } = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  const fileOf = (day) => path.join(dir, `${day}.log`);

  let day = today();
  let pos = 0;
  let rest = "";
  const shown = [];
  try {
    const text = fs.readFileSync(fileOf(day), "utf8");
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    pos = Buffer.byteLength(text);
    shown.push(...lines);
  } catch {
    /* nothing today yet */
  }
  if (earlier) {
    if (shown.length) shown.unshift(rule(day));
    for (const f of dayFiles(dir).filter((f) => f < `${day}.log`).reverse()) {
      if (shown.length >= 500) break;
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
      if (lines.at(-1) === "") lines.pop();
      shown.unshift(rule(f.slice(0, 10)), ...lines);
    }
  }
  if (shown.length) for (const line of shown.slice(-500)) send(line);
  else send(earlier ? "(nothing logged for them yet — their lines appear here while she is in one of their meetings)" : "(nothing logged yet today)");

  const follow = setInterval(() => {
    if (today() !== day) {
      day = today();
      pos = 0;
      rest = "";
      send(rule(day));
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

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0d10; color: #d6dae0; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  header { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 10px 16px; background: #0b0d10ee; border-bottom: 1px solid #1f242b; }
  header b { font-family: system-ui, sans-serif; font-size: 14px; color: #fff; }
  #dot { width: 8px; height: 8px; border-radius: 50%; background: #666; }
  #dot.live { background: #34d399; box-shadow: 0 0 8px #34d399; }
  #state { color: #8a929c; font-family: system-ui, sans-serif; font-size: 12px; }
  nav { margin-left: auto; display: flex; gap: 8px; }
  button, nav a { background: #1a1f26; color: #c9ced6; border: 1px solid #2a313a; border-radius: 6px; padding: 4px 10px; font: 12px system-ui, sans-serif; cursor: pointer; text-decoration: none; }
  nav a:hover, button:hover { border-color: #3a434e; color: #fff; }
  main { padding: 10px 16px 40px; white-space: pre-wrap; word-break: break-word; }
  .l { padding: 0 2px; }
  .said { color: #7dd3fc; }
  .bad { color: #fb7185; }
  .good { color: #6ee7b7; }
  .meet { color: #fcd34d; }
  .dim { color: #6b7380; }
`;

/** A live log page: `source` is the stream it reads. */
function logPage({ title, source, links }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><span id="dot"></span><b>${esc(title)}</b><span id="state">connecting…</span><nav>${links
    .map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`)
    .join("")}<button id="pause">Pause</button></nav></header>
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
    /→|leaving|finished|somebody is|nobody else|────/i.test(t) ? "meet" :
    /reading the calendar|still here|^\\(nothing logged/i.test(t) ? "dim" : "";
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
  const es = new EventSource(${JSON.stringify(source)});
  es.onopen = () => { dot.className = "live"; state.textContent = "live — new lines appear as they happen"; };
  es.onerror = () => { dot.className = ""; state.textContent = "reconnecting…"; };
  es.onmessage = (e) => { const t = JSON.parse(e.data); paused ? held.push(t) : add(t); };
</script>
</body>
</html>`;
}

/** The clients she has a log for, the most recent first. */
function clientsPage() {
  const rows = [];
  try {
    for (const d of fs.readdirSync(CLIENTS, { withFileTypes: true })) {
      if (!d.isDirectory() || !UUID.test(d.name)) continue;
      const days = dayFiles(path.join(CLIENTS, d.name));
      rows.push({ id: d.name, name: clientName(d.name), last: days.at(-1)?.slice(0, 10) ?? "", days: days.length });
    }
  } catch {
    /* none yet */
  }
  rows.sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
  const list = rows.length
    ? rows
        .map(
          (r) =>
            `<li><a href="/logs/client/${r.id}">${esc(r.name)}</a><span>${r.last ? `last ${r.last} · ${r.days} day${r.days === 1 ? "" : "s"}` : "nothing yet"}</span></li>`,
        )
        .join("")
    : `<li class="none">No client's meeting logged yet: a client's log starts the first time she is in one of their meetings.</li>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ava — clients' logs</title>
<style>${STYLE}
  ul { list-style: none; margin: 0; padding: 12px 16px; font-family: system-ui, sans-serif; font-size: 14px; }
  li { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; padding: 10px 0; border-bottom: 1px solid #1f242b; }
  li a { color: #7dd3fc; text-decoration: none; }
  li a:hover { text-decoration: underline; }
  li span, .none { color: #8a929c; font-size: 12px; }
</style>
</head>
<body>
<header><b>Ava — clients' logs</b><span id="state">each client's meetings alone</span><nav><a href="/logs">All of her log</a></nav></header>
<ul>${list}</ul>
</body>
</html>`;
}

http
  .createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");
    if (!authorised(req)) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Ava log", charset="UTF-8"', "Content-Type": "text/plain" });
      res.end("User ava, and her screen's password.");
      return;
    }
    const html = (body) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
    };
    if (pathname === "/logs" || pathname === "/logs/") {
      return html(logPage({ title: "Ava — live log", source: "/logs/stream", links: [["/logs/clients", "Clients"]] }));
    }
    if (pathname === "/logs/stream") return stream(req, res, DIR);
    if (pathname === "/logs/clients" || pathname === "/logs/clients/") return html(clientsPage());

    // One client's: the id is checked before it is ever part of a path.
    const one = /^\/logs\/client\/([^/]+)(\/stream)?\/?$/.exec(pathname);
    if (one && UUID.test(one[1])) {
      const id = one[1].toLowerCase();
      if (one[2]) return stream(req, res, path.join(CLIENTS, id), { earlier: true });
      return html(
        logPage({
          title: `Ava — ${clientName(id, searchParams.get("name") ?? "")}`,
          source: `/logs/client/${id}/stream`,
          links: [
            ["/logs/clients", "Clients"],
            ["/logs", "All of her log"],
          ],
        }),
      );
    }
    res.writeHead(404).end();
  })
  .listen(PORT, () => console.log(`Her live log: https://<this-host>/logs  (user: ava, password: AVA_ADMIN_PASSWORD)`));
