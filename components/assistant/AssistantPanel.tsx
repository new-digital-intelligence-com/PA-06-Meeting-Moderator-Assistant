"use client";

/**
 * The assistant sidebar: questions about the meetings, Ava's preparation and briefs, the
 * follow-ups, documents and people the user can already see — answered by Claude from the
 * app's own data (app/api/assistant). Read-only: it changes nothing.
 *
 * Docked on the right from 900px wide, opened and closed from the top bar and remembered
 * in localStorage; narrower, a drawer opened by a round button. The conversation lasts as
 * long as the tab (sessionStorage). The panel is drawn into <body>: the top bar's blur
 * would otherwise hold a fixed panel inside it.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Mode = "workspace" | "preview";
type Role = "admin" | "client" | "visitor";
type Msg = { id: string; role: "user" | "assistant"; content: string; files?: string[]; failed?: boolean };
type Picked = { name: string; size: number; data: string };

const PANEL_ID = "ava-assistant";
const OPEN_KEY = "ava-assistant-open";
const ACCEPT = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md", ".csv", ".tsv", ".json"];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 2_000;
const HISTORY_TURNS = 10;
const HISTORY_CHARS = 2_400;
const KEPT_MESSAGES = 40;

/* ----------------------------------------------- open or closed, for every page */

let openNow: boolean | null = null;
const listeners = new Set<() => void>();
const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches;

function getOpen(): boolean {
  if (openNow === null) {
    try {
      // Docked again where it was left open; a phone starts with it closed.
      openNow = localStorage.getItem(OPEN_KEY) === "1" && wide();
    } catch {
      openNow = false;
    }
  }
  return openNow;
}

function setOpen(value: boolean) {
  openNow = value;
  try {
    localStorage.setItem(OPEN_KEY, value ? "1" : "0");
  } catch {
    /* private window: it is only not remembered */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const never = () => () => {};

/* ----------------------------------------------------------------- words */

function namesFor(mode: Mode) {
  return mode === "preview"
    ? { name: "Walkthrough assistant", status: "Grounded in the fictional example" }
    : { name: "Workspace assistant", status: "Grounded in this workspace" };
}

const MEETING_PAGE = /^\/(client\/meetings|admin\/clients\/[^/]+\/meetings)\/[^/]+/;

function startersFor(mode: Mode, role: Role | undefined, path: string): string[] {
  if (mode === "preview") {
    return ["What does Ava do before a meeting?", "What were the example action items?", "How do I get access to the real workspace?"];
  }
  if (MEETING_PAGE.test(path)) {
    return ["Summarise what Ava walks into this meeting with", "What follow-ups were agreed?", "What is missing from the preparation?"];
  }
  if (role === "admin" && !path.startsWith("/admin/clients/")) {
    return ["Which clients have meetings coming up?", "Is Ava in a meeting right now?", "How do I add a new client?"];
  }
  return ["Which meetings are coming up this week?", "Is Ava prepared for the next meeting?", "What actions came out of the last meeting?", "How do I prepare Ava for a meeting?"];
}

function introFor(mode: Mode, role: Role | undefined) {
  if (mode === "preview") return "Ask about the fictional example on this page. Real meetings need workspace access.";
  return role === "admin"
    ? "Ask about clients, meetings, Ava's preparation and briefs, follow-ups and documents — answered from what you can see here."
    : "Ask about your meetings, Ava's preparation and briefs, follow-ups, documents and people — answered only from what you can see in this workspace.";
}

/** What the server is told about the page: it decides itself what may be read for it. */
function contextFor(path: string) {
  const meeting = path.match(/\/meetings\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
  const view = path.startsWith("/preview")
    ? "public walkthrough"
    : MEETING_PAGE.test(path)
      ? "meeting page"
      : path.startsWith("/admin/clients/")
        ? "client workspace"
        : path.startsWith("/admin")
          ? "clients list"
          : path.startsWith("/client")
            ? "client workspace"
            : path === "/"
              ? "control room"
              : "app";
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return { path, view, ...(meeting ? { selectedId: meeting } : {}), ...(timeZone ? { timeZone } : {}) };
}

/* ------------------------------------------------------------- downloads */

const MIME: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  md: "text/markdown",
  txt: "text/plain",
};

function download(text: string, name: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Files written out in the answer: a fenced csv, tsv, json or markdown block each. */
function fencedFiles(text: string) {
  return [...text.matchAll(/```(csv|tsv|json|txt|markdown|md)[^\S\n]*\n([\s\S]*?)\n```/g)].map((m) => ({
    ext: m[1] === "markdown" ? "md" : m[1],
    body: m[2],
  }));
}

/* -------------------------------------------------------------- markdown */

/** Never raw HTML (react-markdown escapes it) and never images: a picture could carry data out. */
const markdown: Components = {
  p: ({ children }) => <p className="my-1.5 leading-6 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <p className="mb-1 mt-3 font-semibold text-slate-900 first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 font-semibold text-slate-900 first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-2 font-semibold text-slate-900 first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mb-1 mt-2 font-semibold text-slate-900 first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-slate-400">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-slate-400">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-6">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 underline-offset-2 hover:text-blue-700 hover:underline">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded-md bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>,
  pre: ({ children }) => (
    <pre className="my-2 max-w-full overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-4 border-slate-200 pl-3 text-slate-600">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="bg-slate-50 px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-slate-100 px-2 py-1.5">{children}</td>,
};

function Answer({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words text-sm text-slate-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown} disallowedElements={["img"]} unwrapDisallowed>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ----------------------------------------------------------------- icons */

const ChatIcon = ({ className = "size-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeWidth={2.6} />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="size-4" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/* ----------------------------------------------------------------- panel */

let counter = 0;
const uid = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

function loadChat(key: string): Msg[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(saved)
      ? saved.filter((m): m is Msg => Boolean(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      : [];
  } catch {
    return [];
  }
}

const sizeOf = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function Panel({ mode, role, email, open }: { mode: Mode; role?: Role; email?: string; open: boolean }) {
  const path = usePathname() ?? "/";
  const { name, status } = namesFor(mode);
  const storeKey = `ava-assistant-chat:${mode}:${email ?? "guest"}`;
  const [messages, setMessages] = useState<Msg[]>(() => loadChat(storeKey));
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const helpId = useId();

  useEffect(() => {
    try {
      sessionStorage.setItem(storeKey, JSON.stringify(messages.slice(-KEPT_MESSAGES)));
    } catch {
      /* full or blocked: it is only not kept */
    }
  }, [messages, storeKey]);

  useEffect(() => {
    let live = true;
    fetch("/api/assistant", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { configured?: boolean } | null) => {
        if (live && s) setConfigured(Boolean(s.configured));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    if (!open) return;
    if (wide()) inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !wide()) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const off = configured === false;

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const selected = [...(input.files ?? [])];
    input.value = "";
    if (!selected.length) return;
    setError("");
    try {
      if (files.length + selected.length > MAX_FILES) throw new Error("Attach up to three files.");
      const total = files.reduce((n, f) => n + f.size, 0) + selected.reduce((n, f) => n + f.size, 0);
      if (total > MAX_TOTAL_BYTES) throw new Error("Attachments must total at most 8 MB.");
      for (const file of selected) {
        const ext = `.${file.name.split(".").at(-1)?.toLowerCase() ?? ""}`;
        if (!file.name.includes(".") || !ACCEPT.includes(ext)) throw new Error(`${file.name}: use PDF, PNG, JPEG, WebP, TXT, Markdown, CSV, TSV or JSON.`);
        if (!file.size || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: use a non-empty file of at most 5 MB.`);
      }
      setReading(true);
      const read = await Promise.all(selected.map(async (file) => ({ name: file.name, size: file.size, data: await readFile(file) })));
      setFiles((now) => [...now, ...read].slice(0, MAX_FILES));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the files.");
    } finally {
      setReading(false);
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    if (reading) return setError("Wait for the files to finish reading.");
    if (message.length > MAX_CHARS) return setError(`Keep your question under ${MAX_CHARS.toLocaleString("en")} characters.`);
    const history = messages
      .filter((m) => !m.failed)
      .slice(-HISTORY_TURNS)
      .map((m) => ({
        role: m.role,
        content: (m.files?.length ? `${m.content}\n[Files attached then, not sent again: ${m.files.join(", ")}]` : m.content).slice(0, HISTORY_CHARS),
      }));
    const sent = files;
    const mine: Msg = { id: uid(), role: "user", content: message, ...(sent.length ? { files: sent.map((f) => f.name) } : {}) };
    setMessages((now) => [...now, mine]);
    setDraft("");
    setFiles([]);
    setError("");
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history, attachments: sent.map(({ name, data }) => ({ name, data })), context: contextFor(path) }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { answer?: string; error?: string; code?: string };
      if (!res.ok || !body.answer) {
        if (body.code === "not_configured") setConfigured(false);
        throw new Error(body.error || "The assistant could not answer. Try again.");
      }
      setMessages((now) => [...now, { id: uid(), role: "assistant", content: body.answer! }]);
    } catch (err) {
      setMessages((now) => now.map((m) => (m.id === mine.id ? { ...m, failed: true } : m)));
      setError(err instanceof Error && err.name === "AbortError" ? "The assistant took too long. Try again." : err instanceof Error ? err.message : "Something went wrong.");
      // Back in the box, to send again.
      setDraft((d) => d || message);
      setFiles((f) => (f.length ? f : sent));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  function newChat() {
    setMessages([]);
    setDraft("");
    setFiles([]);
    setError("");
    inputRef.current?.focus();
  }

  const starters = startersFor(mode, role, path);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open the ${name.toLowerCase()}`}
          aria-controls={PANEL_ID}
          aria-expanded={false}
          className="fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-blue-600 text-white shadow-lg shadow-blue-600/30 ring-4 ring-white transition hover:scale-105 focus-visible:outline-none focus-visible:ring-blue-300 min-[900px]:hidden"
        >
          <ChatIcon className="size-6" />
        </button>
      )}
      {open && <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-900/30 min-[900px]:hidden" />}
      <aside
        id={PANEL_ID}
        aria-label={name}
        hidden={!open}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-slate-200 bg-white text-slate-900 shadow-2xl min-[900px]:z-40 min-[900px]:w-96 min-[900px]:max-w-none min-[900px]:shadow-[-8px_0_24px_-12px_rgba(15,23,42,0.12)]"
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/70 px-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-blue-600 text-white shadow-sm ring-2 ring-white">
            <ChatIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold tracking-tight text-slate-900">{name}</h2>
            <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
              <span className={`size-1.5 shrink-0 rounded-full ${off ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden="true" />
              {off ? "Not configured" : status}
            </p>
          </div>
          <button
            type="button"
            onClick={newChat}
            disabled={busy}
            className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={`Close the ${name.toLowerCase()}`}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <CloseIcon />
          </button>
        </header>

        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Conversation"
          aria-busy={busy}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden bg-slate-50/60 px-4 py-4"
        >
          {off && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              The assistant is not configured on this server yet. Ask NDI to set it up.
            </p>
          )}
          {!messages.length ? (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-slate-600">{introFor(mode, role)}</p>
              <div className="flex flex-col gap-2">
                {starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || off}
                    onClick={() => void send(s)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex flex-col items-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-linear-to-b from-blue-500 to-blue-600 px-3.5 py-2.5 text-sm text-white shadow-sm">
                    <p className="whitespace-pre-wrap break-words leading-6">{m.content}</p>
                    {m.files?.length ? <p className="mt-1 break-words text-xs text-blue-100">Attached: {m.files.join(", ")}</p> : null}
                  </div>
                  {m.failed && <p className="mt-1 text-xs text-rose-700">Not answered</p>}
                </div>
              ) : (
                <div key={m.id} className="flex">
                  <div className="min-w-0 max-w-full rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
                    <Answer text={m.content} />
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                      <button
                        type="button"
                        onClick={() => download(m.content, "ava-assistant-answer.md", MIME.md)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                      >
                        Download answer
                      </button>
                      {fencedFiles(m.content).map((f, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => download(f.body, `ava-assistant-file-${i + 1}.${f.ext}`, MIME[f.ext])}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                        >
                          Download .{f.ext}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ),
            )
          )}
          {busy && (
            <div className="flex">
              <p className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="size-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-blue-500" />
                </span>
                Looking through the app…
              </p>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="shrink-0 border-t border-slate-200 bg-white p-3"
        >
          {error && (
            <p role="alert" className="mb-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
              {error}
            </p>
          )}
          {files.length > 0 && (
            <ul aria-label="Files to send" className="mb-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-0.5 text-xs text-slate-700">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-slate-400">{sizeOf(f.size)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setFiles((now) => now.filter((_, j) => j !== i))}
                    aria-label={`Remove ${f.name}`}
                    className="rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-rose-700"
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-xl border border-slate-300 bg-white shadow-sm transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
            <label htmlFor={inputId} className="sr-only">
              Your question for the {name.toLowerCase()}
            </label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={2}
              value={draft}
              maxLength={MAX_CHARS}
              disabled={off}
              aria-describedby={helpId}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={mode === "preview" ? "Ask about the example…" : "Ask about your meetings…"}
              className="block max-h-40 min-h-[3.25rem] w-full resize-y bg-transparent px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition focus-within:ring-4 focus-within:ring-blue-500/20 hover:border-slate-300 hover:bg-slate-50 ${busy || reading || off || files.length >= MAX_FILES ? "pointer-events-none opacity-50" : ""}`}
                >
                  <input
                    type="file"
                    multiple
                    accept={ACCEPT.join(",")}
                    onChange={pick}
                    disabled={busy || reading || off || files.length >= MAX_FILES}
                    className="sr-only"
                    aria-label="Attach files to your question"
                  />
                  {reading ? "Reading…" : "Attach"}
                </label>
                {draft.length > MAX_CHARS - 300 && (
                  <span className="text-[11px] text-slate-400" aria-live="polite">
                    {draft.length}/{MAX_CHARS}
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={busy || reading || off || !draft.trim()}
                className="inline-flex items-center justify-center rounded-lg bg-linear-to-b from-blue-500 to-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
          <p id={helpId} className="mt-1.5 text-[11px] leading-4 text-slate-400">
            Enter sends, Shift+Enter starts a new line. Up to 3 files (PDF, PNG, JPEG, WebP, TXT, MD, CSV, TSV, JSON), 5 MB each, 8 MB in total. It answers; it changes nothing.
          </p>
        </form>
      </aside>
    </>
  );
}

/* --------------------------------------------------------------- the bar */

/**
 * The assistant: its button in the top bar (wide screens), and the panel with its round
 * button for narrow ones. `mode` "preview" is the public walkthrough's, grounded on its
 * fictional example only.
 */
export default function Assistant({ mode = "workspace", role, email }: { mode?: Mode; role?: Role; email?: string }) {
  const open = useSyncExternalStore(subscribe, getOpen, () => false);
  const onClient = useSyncExternalStore(never, () => true, () => false);
  const { name } = namesFor(mode);

  // Docked: the page makes room for it (app/globals.css).
  useEffect(() => {
    const root = document.documentElement;
    if (open) root.setAttribute("data-assistant", "open");
    else root.removeAttribute("data-assistant");
    return () => root.removeAttribute("data-assistant");
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        title={open ? `Close the ${name.toLowerCase()}` : `Open the ${name.toLowerCase()}`}
        className={`hidden items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition min-[900px]:inline-flex ${
          open ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/10" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <ChatIcon className="size-4" />
        Assistant
      </button>
      {onClient && createPortal(<Panel mode={mode} role={role} email={email} open={open} />, document.body)}
    </>
  );
}
