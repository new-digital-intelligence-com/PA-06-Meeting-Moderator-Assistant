"use client";

/**
 * Ava's meeting, live, on the client's own page — only when it is theirs (the server
 * decides: /api/portal/live) — and sending her to one right now.
 *
 * The page follows it every few seconds while she is in one of their meetings, and every
 * fifteen otherwise, so a meeting from their calendar shows up by itself when it starts.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PLATFORM_NAME, platformOf } from "@/lib/platform";
import { BoltIcon, ChatIcon, CheckIcon, ClockIcon, UsersIcon, VideoIcon } from "./icons";
import { api, quiet } from "./ui";

export type Live = {
  title: string;
  meetingUrl: string;
  platform: "meet" | "teams" | null;
  phase: "sent" | "joining" | "live" | "ended";
  from: "calendar" | "dispatch";
  elapsed: number;
  people: number | null;
  transcript: { id: string; speaker: string; text: string; at: number }[];
  actions: { id: string; text: string; owner: string | null; due: string | null }[];
  notes: { subject: string; to: string; sentAt: number | null } | null;
  summary: string | null;
  /** Ended from the site before she left by herself: who pressed it. */
  endedBy: string | null;
  endedAt: number | null;
  /** Lines heard: none means no notes are coming. */
  heard: number;
};

/** Her meeting for this client, if any, and whether she is free to be sent. */
export function useLive(q: string) {
  const [state, setState] = useState<{ live: Live | null; busy: boolean; at: number }>({ live: null, busy: false, at: 0 });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const active = Boolean(state.live && state.live.phase !== "ended");

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      // Not while the tab is hidden: nobody is looking, and every look is a request.
      if (document.visibilityState === "visible") {
        try {
          const d = await api<{ live: Live | null; busy: boolean }>(`/api/portal/live${q}`);
          if (alive) setState({ ...d, at: Date.now() });
        } catch {
          /* the next look tries again */
        }
      }
      if (alive) timer = window.setTimeout(load, active ? 3000 : 15000);
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, version, active]);

  return { ...state, refresh };
}

const mmss = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

const SPEAKER_TONES = ["text-blue-700", "text-violet-700", "text-emerald-700", "text-amber-700", "text-rose-700", "text-sky-700", "text-teal-700"];
const speakerTone = (name: string) => SPEAKER_TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % SPEAKER_TONES.length];

/** Her meeting as it happens: who said what, the actions, telling her something, ending it. */
export function LivePanel({ live, at, q, onChanged }: { live: Live; at: number; q: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [told, setTold] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const heard = useRef<HTMLDivElement>(null);
  const lastLine = live.transcript.at(-1)?.id;

  // The clock runs between looks at the server — in the meeting, and while the notes are awaited.
  const ticking = live.phase === "live" || (live.phase === "ended" && !live.summary);
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  // New lines scroll into view — unless you scrolled up to read.
  useEffect(() => {
    const box = heard.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }, [lastLine]);

  async function act(label: string, body: object) {
    setBusy(label);
    setError(null);
    try {
      await api(`/api/portal/live${q}`, { method: "POST", body: JSON.stringify(body) });
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const seconds = live.phase === "live" ? live.elapsed + Math.max(0, (tick - at) / 1000) : live.elapsed;
  const product = live.platform ? PLATFORM_NAME[live.platform] : "the meeting";
  const look = {
    sent: { ring: "ring-blue-200", band: "from-blue-600 to-indigo-600", label: "Sent", title: "On her way — her server picks it up in a few seconds" },
    joining: {
      ring: "ring-blue-200",
      band: "from-blue-600 to-indigo-600",
      label: "Joining",
      title: live.platform === "teams" ? "Joining — admit her from the Teams lobby" : "Joining the meeting",
    },
    live: { ring: "ring-emerald-200", band: "from-emerald-600 to-teal-600", label: "Live", title: "Ava is in your meeting" },
    ended: { ring: "ring-slate-200", band: "from-slate-600 to-slate-700", label: "Ended", title: "The meeting has ended" },
  }[live.phase];

  return (
    <section className={`overflow-hidden rounded-2xl bg-white shadow-lg shadow-slate-900/5 ring-1 ${look.ring}`} aria-live="polite">
      <div className={`flex flex-wrap items-center justify-between gap-3 bg-linear-to-r ${look.band} px-5 py-4 text-white`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-3 shrink-0">
            {live.phase !== "ended" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />}
            <span className="relative inline-flex size-3 rounded-full bg-white" />
          </span>
          <span className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.18em]">{look.label}</span>
          <h2 className="truncate text-base font-semibold">{look.title}</h2>
        </div>
        {live.phase !== "ended" ? (
          <button
            className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white hover:text-rose-700 disabled:opacity-60"
            disabled={busy !== null}
            onClick={() => {
              const call = live.phase === "sent" ? "Call it off? She will not go." : "End the meeting for her? She leaves at once and writes the notes.";
              if (window.confirm(call)) void act("end", { action: "end" });
            }}
          >
            {busy === "end" ? "Ending…" : live.phase === "sent" ? "Call it off" : "End meeting"}
          </button>
        ) : null}
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="min-w-0 truncate font-semibold text-slate-900">{live.title}</span>
          {live.meetingUrl && (
            <a href={live.meetingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700">
              <VideoIcon className="size-4" />
              {product} ↗
            </a>
          )}
          {(live.phase === "live" || live.phase === "ended") && (
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-slate-700">
              <ClockIcon className="size-4 text-slate-400" />
              {mmss(seconds)}
            </span>
          )}
          {live.people !== null && live.phase === "live" && (
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <UsersIcon className="size-4 text-slate-400" />
              {live.people} in the call
            </span>
          )}
          <span className="text-xs text-slate-400">{live.from === "dispatch" ? "Sent from this page" : "From her calendar"}</span>
        </div>

        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}

        {live.phase === "ended" ? (
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-inset ring-slate-200">
            <CheckIcon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            <div className="space-y-1">
              {live.endedBy && <p className="text-xs text-slate-500">Ended by {live.endedBy === "her runner" ? "Ava herself" : live.endedBy}.</p>}
              {live.summary ? (
                <>
                  <p className="font-medium text-slate-800">
                    Notes written{live.notes?.sentAt ? ` and sent to ${live.notes.to}` : " and filed under Past meetings"}.
                  </p>
                  <p className="leading-relaxed">{live.summary}</p>
                </>
              ) : live.heard === 0 ? (
                <p>Nothing was said while she was there, so there are no notes. Its history is under Past meetings.</p>
              ) : live.endedAt && tick - live.endedAt > 3 * 60_000 ? (
                <p>The notes could not be written. What she heard is kept — ask NDI to write them up.</p>
              ) : (
                <p>She is writing the notes — they appear under Past meetings in a minute.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <ChatIcon className="size-4" /> Heard
              </p>
              <div ref={heard} className="h-64 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
                {live.transcript.length ? (
                  live.transcript.map((l) =>
                    // Her own lines stand apart from the room's.
                    /^ava\b/i.test(l.speaker) ? (
                      <p key={l.id} className="rounded-lg bg-indigo-50 px-2.5 py-1.5 leading-relaxed ring-1 ring-inset ring-indigo-100">
                        <span className="font-semibold text-indigo-700">{l.speaker}</span> <span className="text-slate-700">{l.text}</span>
                      </p>
                    ) : (
                      <p key={l.id} className="px-2.5 leading-relaxed">
                        <span className={`font-semibold ${speakerTone(l.speaker)}`}>{l.speaker}</span>{" "}
                        <span className="text-slate-700">{l.text}</span>
                      </p>
                    ),
                  )
                ) : (
                  <p className="text-slate-400">
                    {live.phase === "live"
                      ? "Nothing yet — what is said appears here as she hears it."
                      : "When she is in, what is said appears here."}
                  </p>
                )}
              </div>
            </div>
            <div className="lg:col-span-2">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <CheckIcon className="size-4" /> Actions
              </p>
              <div className="h-64 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
                {live.actions.length ? (
                  live.actions.map((a) => (
                    <div key={a.id} className="rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-slate-200/70">
                      <p className="text-slate-800">{a.text}</p>
                      {(a.owner || a.due) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {a.owner}
                          {a.owner && a.due ? " · " : ""}
                          {a.due}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400">She notes them as people commit to things.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {live.phase !== "ended" && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("tell", { action: "tell", text })) {
                setText("");
                setTold(true);
                window.setTimeout(() => setTold(false), 4000);
              }
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              placeholder="Tell her something she should know — her next answer will have it"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className={quiet} disabled={busy !== null || !text.trim()}>
              {busy === "tell" ? "Telling…" : told ? "Told ✓" : "Tell her"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

/** "Need Ava now?": a meeting link, a line about it if you like, and she goes. */
export function SendNow({
  q,
  clientName,
  busy,
  onClose,
  onSent,
}: {
  q: string;
  clientName: string;
  busy: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const platform = platformOf(url);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  const close = () => dialog.current?.close();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api(`/api/portal/live${q}`, { method: "POST", body: JSON.stringify({ action: "send", url, note }) });
      onSent();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "She could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-auto w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={send}>
        <div className="bg-linear-to-br from-blue-600 to-indigo-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25">
              <BoltIcon className="size-5" />
            </span>
            <div>
              <h2 id={heading} className="text-lg font-semibold">
                Need Ava now?
              </h2>
              <p className="text-sm text-blue-100">She joins in a few seconds, knowing what she knows about {clientName}.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-800">The meeting link</span>
            <div className="relative">
              <input
                autoFocus
                required
                type="url"
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-3 pr-32 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                placeholder="https://meet.google.com/abc-defg-hij"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {url.trim() && (
                <span
                  className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium ${
                    platform ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {platform ? PLATFORM_NAME[platform] : "Not Meet or Teams"}
                </span>
              )}
            </div>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-800">
              What is it about? <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              placeholder="Quote review with Sami — he wants the GA-101 delivery dates."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-500 ring-1 ring-inset ring-slate-200">
            {platform === "teams"
              ? "Teams: she joins as a guest named Ava — someone in the meeting admits her from the lobby."
              : "Google Meet: she joins as her own account — straight in if she is on the invite, otherwise someone admits her."}{" "}
            Her notes are filed under your past meetings.
          </p>
          {busy && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">Ava is in another meeting right now.</p>}
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button type="button" className={quiet} onClick={close}>
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-b from-blue-500 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-600/25 transition hover:to-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!platform || sending || busy}
          >
            <BoltIcon className="size-4" />
            {sending ? "Sending…" : "Send Ava"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
