"use client";

/**
 * The control room — your side of the glass.
 *
 * Ava is in the meeting; this is where you set up what she is moderating, watch what
 * she is hearing, and decide what leaves the building afterwards. Everything she does
 * automatically has a manual override here, because a moderator you cannot overrule is
 * worse than no moderator at all.
 */

import { useCallback, useEffect, useState } from "react";

type Config = {
  googleConnected: boolean;
  email: string | null;
  anthropic: boolean;
  recall: boolean;
  simli: boolean;
  elevenlabs: boolean;
  publicUrl: string;
  publicUrlReachable: boolean;
  botName: string;
  store: "redis" | "mongo" | "file";
};

type AgendaItem = { id?: string; title: string; minutes: number; owner?: string };
type Action = { id: string; text: string; owner?: string; due?: string; confirmed: boolean };
type TranscriptLine = { id: string; speaker: string; text: string; at: number };
type SharedFile = { id: string; name: string; link: string; sharedWith: string[] };

type Meeting = {
  id: string;
  title: string;
  meetingUrl: string;
  participants: string[];
  agenda: AgendaItem[];
  currentIndex: number;
  status: "draft" | "joining" | "live" | "ended";
  botId?: string;
  transcript: TranscriptLine[];
  actions: Action[];
  files: SharedFile[];
  minutes?: string;
  followUp?: { to: string; subject: string; body: string };
};

type Timer = {
  index: number;
  total: number;
  title: string | null;
  elapsed: number;
  planned: number;
  remaining: number;
  overrunning: boolean;
  meetingElapsed: number;
};

type DriveFile = { id: string; name: string; mimeType: string; link: string; owner?: string };
type CalMeeting = { id: string; title: string; start: string; meetingUrl: string; attendees: string[] };

const mmss = (s: number) => {
  const sign = s < 0 ? "-" : "";
  const abs = Math.abs(Math.floor(s));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

/* ------------------------------------------------------------ small pieces */

function Pill({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <span
      title={hint}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400"}`} />
      {label}
    </span>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-sky-400/60 focus:outline-none";
const button =
  "rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

/* ------------------------------------------------------------------- page */

export default function ControlRoom({
  config,
  initialMeeting,
  initialTimer,
}: {
  config: Config;
  initialMeeting: Meeting;
  initialTimer: Timer;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(initialMeeting);
  const [timer, setTimer] = useState<Timer | null>(initialTimer);
  const [calendar, setCalendar] = useState<CalMeeting[]>([]);
  const [drive, setDrive] = useState<DriveFile[]>([]);
  const [driveQuery, setDriveQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Local copies, seeded once from the server. The form is deliberately NOT driven by
  // the two-second poll — a field that rewrites itself under the cursor is unusable.
  const [draft, setDraft] = useState({
    title: initialMeeting.title === "Untitled meeting" ? "" : initialMeeting.title,
    meetingUrl: initialMeeting.meetingUrl,
    participants: initialMeeting.participants.join(", "),
  });
  const [agenda, setAgenda] = useState<AgendaItem[]>(
    initialMeeting.agenda.length ? initialMeeting.agenda : [{ title: "", minutes: 10, owner: "" }],
  );
  const [followUp, setFollowUp] = useState(
    initialMeeting.followUp ?? { to: "", subject: "", body: "" },
  );

  const say = (message: string) => {
    setNote(message);
    window.setTimeout(() => setNote((n) => (n === message ? null : n)), 4000);
  };

  /* ── load & poll ───────────────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/meeting");
      const data = await res.json();
      setMeeting(data.meeting);
      setTimer(data.timer);
    } catch {
      /* the poll retries */
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(refresh, 2000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!config.googleConnected) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/calendar?tz=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then((d) => setCalendar(d.meetings ?? []))
      .catch(() => undefined);
  }, [config.googleConnected]);

  /* The note-taker runs on its own clock, well away from her speaking loop. */
  useEffect(() => {
    if (meeting?.status !== "live") return;
    const id = window.setInterval(() => {
      fetch("/api/moderator/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [meeting?.status]);

  /* ── actions ───────────────────────────────────────────────────────────── */

  const call = async (label: string, fn: () => Promise<Response>) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      await refresh();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const savePlan = () =>
    call("save", () =>
      fetch("/api/meeting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          meetingUrl: draft.meetingUrl,
          participants: draft.participants.split(/[,\s;]+/).filter(Boolean),
          agenda: agenda.filter((a) => a.title.trim()),
        }),
      }),
    );

  const sendAva = async () => {
    await savePlan();
    const data = await call("start", () => fetch("/api/meeting/start", { method: "POST" }));
    if (data) say("Ava is knocking — let her in from the Meet window.");
  };

  const command = (cmd: string) =>
    call(cmd, () =>
      fetch("/api/meeting/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      }),
    );

  const writeFollowUp = async () => {
    const data = await call("followup", () => fetch("/api/meeting/followup", { method: "POST" }));
    if (data?.followUp) setFollowUp(data.followUp);
  };

  const deliver = async (mode: "draft" | "send") => {
    if (mode === "send" && !window.confirm(`Send this to ${followUp.to}? This cannot be undone.`)) return;
    const data = await call(mode, () =>
      fetch("/api/meeting/followup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...followUp }),
      }),
    );
    if (data) say(mode === "send" ? "Sent." : "Saved to your Gmail drafts.");
  };

  const searchDrive = async () => {
    const data = await call("drive", () => fetch(`/api/drive?q=${encodeURIComponent(driveQuery)}`));
    if (data) setDrive(data.files ?? []);
  };

  const share = async (file: DriveFile) => {
    if (!meeting?.participants.length) {
      setError("Add participant emails first — that is who gets access.");
      return;
    }
    if (!window.confirm(`Give ${meeting.participants.length} participant(s) access to "${file.name}"? They each get a notification email.`)) return;
    const data = await call(`share:${file.id}`, () =>
      fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, emails: meeting.participants }),
      }),
    );
    if (data) {
      const failed = (data.results ?? []).filter((r: { ok: boolean }) => !r.ok);
      say(failed.length ? `Shared, ${failed.length} address(es) refused.` : "Shared with everyone.");
    }
  };

  const fillFromCalendar = (m: CalMeeting) => {
    setDraft({ title: m.title, meetingUrl: m.meetingUrl, participants: m.attendees.join(", ") });
  };

  /* ── render ────────────────────────────────────────────────────────────── */

  const status = meeting?.status ?? "draft";
  const planning = status === "draft";
  const ready =
    config.googleConnected && config.recall && config.simli && config.elevenlabs && config.publicUrlReachable;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-6 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Meeting Moderator</h1>
          <p className="text-sm text-white/40">
            {config.botName ?? "Ava"} joins your Google Meet, keeps time, and writes the follow-up.
          </p>
        </div>
        {(
          <div className="flex flex-wrap items-center gap-2">
            <Pill ok={config.googleConnected} label={config.email ?? "Google"} />
            <Pill ok={config.recall} label="Recall" hint="RECALL_API_KEY" />
            <Pill ok={config.simli} label="Face" hint="SIMLI_API_KEY + SIMLI_FACE_ID" />
            <Pill ok={config.elevenlabs} label="Voice" hint="ELEVENLABS_API_KEY" />
            <Pill ok={config.publicUrlReachable} label="Public URL" hint={config.publicUrl || "PUBLIC_URL is not set"} />
            <Pill
              // On one local process a file is fine. On a serverless deployment it means
              // the stage and this page are looking at two different meetings.
              ok={config.store !== "file" || !config.publicUrl.includes("vercel.app")}
              label={{ redis: "Redis", mongo: "Mongo", file: "File store" }[config.store]}
              hint={
                config.store === "file"
                  ? "data/meeting.json — fine locally, broken on serverless. Set KV_REST_API_URL or MONGODB_URI."
                  : "Shared store — the stage and this page see the same meeting."
              }
            />
            {!config.googleConnected && (
              <a href="/api/auth/google" className={`${button} bg-sky-500 text-white hover:bg-sky-400`}>
                Connect Google
              </a>
            )}
          </div>
        )}
      </header>

      {!config.publicUrlReachable && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
          <strong className="font-semibold">PUBLIC_URL is not reachable.</strong> Recall&apos;s browser loads{" "}
          <code className="text-amber-100">/bot</code> over the internet, so localhost gives you a bot with a blank
          tile. Run <code className="text-amber-100">cloudflared tunnel --url http://localhost:3000</code> and put the
          https address it prints into <code className="text-amber-100">.env.local</code>.
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200">{error}</p>
      )}
      {note && (
        <p className="rounded-xl border border-sky-400/30 bg-sky-400/5 p-4 text-sm text-sky-200">{note}</p>
      )}

      {/* ── the plan ─────────────────────────────────────────────────────── */}
      {planning ? (
        <Section
          title="The meeting"
          aside={
            calendar.length > 0 ? (
              <select
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/70"
                defaultValue=""
                onChange={(e) => {
                  const found = calendar.find((c) => c.id === e.target.value);
                  if (found) fillFromCalendar(found);
                }}
              >
                <option value="">Fill from calendar…</option>
                {calendar.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            ) : null
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-white/40">Title</span>
              <input
                className={input}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Weekly product sync"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/40">Google Meet link</span>
              <input
                className={input}
                value={draft.meetingUrl}
                onChange={(e) => setDraft({ ...draft, meetingUrl: e.target.value })}
                placeholder="https://meet.google.com/abc-defg-hij"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-white/40">
                Participants — who gets the files and the follow-up
              </span>
              <input
                className={input}
                value={draft.participants}
                onChange={(e) => setDraft({ ...draft, participants: e.target.value })}
                placeholder="sam@acme.com, priya@acme.com"
              />
            </label>
          </div>

          <div className="mt-6 space-y-2">
            <p className="text-xs text-white/40">Agenda — she reads this out and times each item</p>
            {agenda.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${input} flex-1`}
                  value={item.title}
                  placeholder={`Item ${i + 1}`}
                  onChange={(e) =>
                    setAgenda(agenda.map((a, j) => (i === j ? { ...a, title: e.target.value } : a)))
                  }
                />
                <input
                  className={`${input} w-20`}
                  type="number"
                  min={1}
                  value={item.minutes}
                  onChange={(e) =>
                    setAgenda(agenda.map((a, j) => (i === j ? { ...a, minutes: Number(e.target.value) } : a)))
                  }
                />
                <input
                  className={`${input} w-40`}
                  value={item.owner ?? ""}
                  placeholder="Owner"
                  onChange={(e) =>
                    setAgenda(agenda.map((a, j) => (i === j ? { ...a, owner: e.target.value } : a)))
                  }
                />
                <button
                  className="px-2 text-white/30 hover:text-rose-300"
                  onClick={() => setAgenda(agenda.filter((_, j) => j !== i))}
                  aria-label="Remove item"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="text-sm text-sky-400 hover:text-sky-300"
              onClick={() => setAgenda([...agenda, { title: "", minutes: 10, owner: "" }])}
            >
              + Add item
            </button>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              className={`${button} bg-sky-500 text-white hover:bg-sky-400`}
              disabled={!ready || !draft.meetingUrl || busy !== null}
              onClick={sendAva}
            >
              {busy === "start" ? "Sending…" : `Send ${config.botName?.split("—")[0].trim() ?? "Ava"} to the meeting`}
            </button>
            <button className={`${button} bg-white/5 text-white/70 hover:bg-white/10`} onClick={savePlan}>
              Save plan
            </button>
            <button
              className={`${button} bg-white/5 text-white/70 hover:bg-white/10`}
              title="Run the agenda with no bot and no call. Open /bot in a tab and she performs it to you, on the real clock."
              onClick={async () => {
                await savePlan();
                await command("rehearse");
                window.open("/bot", "_blank");
              }}
              disabled={busy !== null}
            >
              Rehearse
            </button>
            {!ready && <span className="text-xs text-white/30">Fix the red pills above first.</span>}
          </div>
        </Section>
      ) : (
        /* ── live ───────────────────────────────────────────────────────── */
        <Section
          title={status === "joining" ? "Knocking — admit her in Google Meet" : "Live"}
          aside={
            <div className="flex gap-2">
              <button className={`${button} bg-white/5 text-white/70 hover:bg-white/10`} onClick={() => command("back")}>
                ← Back
              </button>
              <button className={`${button} bg-white/5 text-white/70 hover:bg-white/10`} onClick={() => command("advance")}>
                Next item →
              </button>
              <button className={`${button} bg-rose-500/80 text-white hover:bg-rose-500`} onClick={() => command("stop")}>
                End
              </button>
            </div>
          }
        >
          <div className="flex flex-wrap items-baseline gap-6">
            <div>
              <p className="text-xs text-white/40">
                {timer && timer.total > 0 ? `Item ${Math.min(timer.index + 1, timer.total)} of ${timer.total}` : "No agenda"}
              </p>
              <p className="text-xl font-medium">{timer?.title ?? "—"}</p>
            </div>
            <p className={`font-mono text-4xl tabular-nums ${timer?.overrunning ? "text-amber-400" : ""}`}>
              {timer ? mmss(timer.remaining) : "--:--"}
            </p>
            <p className="text-sm text-white/40">meeting {timer ? mmss(timer.meetingElapsed) : "--:--"}</p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-white/40">Heard</p>
              <div className="h-56 space-y-1.5 overflow-y-auto rounded-lg bg-black/30 p-3 text-sm">
                {meeting?.transcript.length ? (
                  meeting.transcript.slice(-60).map((l) => (
                    <p key={l.id}>
                      <span className="text-sky-300">{l.speaker}</span>{" "}
                      <span className="text-white/70">{l.text}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-white/25">
                    Nothing yet. Captions start once she is admitted and somebody speaks.
                  </p>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-white/40">
                Actions {meeting?.actions.length ? `· ${meeting.actions.length}` : ""}
              </p>
              <div className="h-56 space-y-2 overflow-y-auto rounded-lg bg-black/30 p-3 text-sm">
                {meeting?.actions.length ? (
                  meeting.actions.map((a) => (
                    <p key={a.id}>
                      {a.owner && <span className="font-medium">{a.owner} — </span>}
                      <span className="text-white/75">{a.text}</span>
                      {a.due && <span className="text-white/35"> ({a.due})</span>}
                    </p>
                  ))
                ) : (
                  <p className="text-white/25">She adds them as people commit to things.</p>
                )}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ── files ────────────────────────────────────────────────────────── */}
      <Section title="Files for the room">
        <div className="flex gap-2">
          <input
            className={input}
            value={driveQuery}
            placeholder="Search your Drive…"
            onChange={(e) => setDriveQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchDrive()}
          />
          <button
            className={`${button} bg-white/5 text-white/70 hover:bg-white/10`}
            onClick={searchDrive}
            disabled={!config.googleConnected}
          >
            Search
          </button>
        </div>
        {drive.length > 0 && (
          <ul className="mt-3 divide-y divide-white/5">
            {drive.map((f) => {
              const already = meeting?.files.find((s) => s.id === f.id);
              return (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <a href={f.link} target="_blank" rel="noreferrer" className="block truncate text-sm hover:text-sky-300">
                      {f.name}
                    </a>
                    <p className="text-xs text-white/30">{already ? `shared with ${already.sharedWith.length}` : f.owner}</p>
                  </div>
                  <button
                    className={`${button} shrink-0 bg-white/5 text-white/70 hover:bg-white/10`}
                    onClick={() => share(f)}
                    disabled={busy === `share:${f.id}`}
                  >
                    {busy === `share:${f.id}` ? "Sharing…" : already ? "Share again" : "Grant access"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── the write-up ─────────────────────────────────────────────────── */}
      <Section
        title="Follow-up"
        aside={
          <button
            className={`${button} bg-white/5 text-white/70 hover:bg-white/10`}
            onClick={writeFollowUp}
            disabled={!meeting?.transcript.length || busy === "followup"}
          >
            {busy === "followup" ? "Writing…" : "Write the minutes and email"}
          </button>
        }
      >
        {followUp.subject ? (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-white/40">To</span>
              <input className={input} value={followUp.to} onChange={(e) => setFollowUp({ ...followUp, to: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-white/40">Subject</span>
              <input
                className={input}
                value={followUp.subject}
                onChange={(e) => setFollowUp({ ...followUp, subject: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-white/40">Body — edit before it goes anywhere</span>
              <textarea
                className={`${input} h-64 resize-y font-mono text-xs leading-relaxed`}
                value={followUp.body}
                onChange={(e) => setFollowUp({ ...followUp, body: e.target.value })}
              />
            </label>
            <div className="flex items-center gap-3">
              <button
                className={`${button} bg-sky-500 text-white hover:bg-sky-400`}
                onClick={() => deliver("draft")}
                disabled={busy !== null}
              >
                Save as Gmail draft
              </button>
              <button
                className={`${button} bg-white/5 text-white/60 hover:bg-rose-500/20 hover:text-rose-200`}
                onClick={() => deliver("send")}
                disabled={busy !== null}
              >
                Send now
              </button>
              <span className="text-xs text-white/30">Draft is the safe one. Send cannot be undone.</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/30">
            After the meeting, this writes the minutes and an email with the actions and the file links.
          </p>
        )}
      </Section>

      {meeting?.minutes && (
        <Section title="Minutes">
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-white/75">
            {meeting.minutes}
          </pre>
        </Section>
      )}

      <footer className="flex items-center justify-between pt-2 text-xs text-white/25">
        <span>
          Stage preview:{" "}
          <a href="/bot" target="_blank" rel="noreferrer" className="hover:text-sky-300">
            /bot
          </a>{" "}
          — what the meeting sees
        </span>
        <button
          className="hover:text-rose-300"
          onClick={() => {
            if (window.confirm("Throw this meeting away and start a new one?")) {
                    call("reset", () => fetch("/api/meeting", { method: "DELETE" }));
            }
          }}
        >
          New meeting
        </button>
      </footer>
    </div>
  );
}
