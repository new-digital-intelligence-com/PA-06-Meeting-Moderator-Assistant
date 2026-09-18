"use client";

/**
 * The control room — your side of the glass.
 *
 * Three steps, in order: brief her, send her in, read what came out. She does not need
 * running while the meeting is on — she listens, answers when somebody says her name,
 * and notes what was committed to. The only button that matters mid-meeting is the one
 * that ends it, and that is also what puts the notes in everyone's inbox.
 */

import { useCallback, useEffect, useState } from "react";

type Config = {
  googleConnected: boolean;
  email: string | null;
  anthropic: boolean;
  recall: boolean;
  anam: boolean;
  publicUrl: string;
  publicUrlReachable: boolean;
  botName: string;
  sessionSecret: boolean;
  googleClient: boolean;
  googleRedirectUri: string;
  store: "redis" | "mongo" | "file";
};

type Action = { id: string; text: string; owner?: string; due?: string };
type TranscriptLine = { id: string; speaker: string; text: string; at: number };
type SharedFile = { id: string; name: string; link: string; sharedWith: string[] };

type Meeting = {
  id: string;
  title: string;
  meetingUrl: string;
  context: string;
  recipients: string[];
  activity: "quiet" | "balanced" | "active";
  status: "draft" | "joining" | "live" | "ended";
  botId?: string;
  transcript: TranscriptLine[];
  actions: Action[];
  files: SharedFile[];
  summary?: string;
  followUp?: { to: string; subject: string; body: string; sentAt?: number };
};

type DriveFile = { id: string; name: string; mimeType: string; link: string; owner?: string };
type CalMeeting = { id: string; title: string; start: string; meetingUrl: string; attendees: string[] };

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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

const field =
  "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-sky-400/60 focus:outline-none";
const button =
  "rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

/* ------------------------------------------------------------------- page */

export default function ControlRoom({
  config,
  initialMeeting,
  initialElapsed,
  oauthError,
}: {
  config: Config;
  initialMeeting: Meeting;
  initialElapsed: number;
  oauthError: string | null;
}) {
  const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
  const [secs, setSecs] = useState(initialElapsed);
  const [calendar, setCalendar] = useState<CalMeeting[]>([]);
  const [drive, setDrive] = useState<DriveFile[]>([]);
  const [driveQuery, setDriveQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    oauthError ? `Google sign-in failed: ${oauthError}` : null,
  );
  const [note, setNote] = useState<string | null>(null);

  // Seeded once from the server. Deliberately not driven by the poll — a field that
  // rewrites itself under the cursor is unusable.
  const [draft, setDraft] = useState({
    title: initialMeeting.title === "Untitled meeting" ? "" : initialMeeting.title,
    meetingUrl: initialMeeting.meetingUrl,
    recipients: initialMeeting.recipients.join(", "),
    context: initialMeeting.context,
    activity: initialMeeting.activity ?? "active",
  });
  const [followUp, setFollowUp] = useState(
    initialMeeting.followUp ?? { to: "", subject: "", body: "" },
  );

  const say = (message: string) => {
    setNote(message);
    window.setTimeout(() => setNote((n) => (n === message ? null : n)), 6000);
  };

  /* ── poll ──────────────────────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/meeting");
      const data = await res.json();
      setMeeting(data.meeting);
      setSecs(data.elapsed);
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
    if (meeting.status !== "live") return;
    const id = window.setInterval(() => {
      fetch("/api/moderator/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [meeting.status]);

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
          context: draft.context,
          activity: draft.activity,
          recipients: draft.recipients.split(/[,\s;]+/).filter(Boolean),
        }),
      }),
    );

  const sendAva = async () => {
    await savePlan();
    const data = await call("start", () => fetch("/api/meeting/start", { method: "POST" }));
    if (data) say("She is knocking — let her in from the Meet window.");
  };

  /**
   * Ending the meeting is also what sends the notes out, which is the point of her
   * being there at all. Two requests rather than one: ending is instant, the write-up
   * needs a model call and a Gmail round trip, and folding them together would mean
   * staring at a spinner wondering whether she had even left the call.
   */
  const endAndSend = async () => {
    const stopped = await call("stop", () =>
      fetch("/api/meeting/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "stop" }),
      }),
    );
    if (!stopped) return;
    if (stopped.rehearsal) {
      say("Rehearsal over.");
      return;
    }

    const written = await call("write", () =>
      fetch("/api/meeting/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: meeting.recipients.length ? "send" : "compose" }),
      }),
    );
    if (written?.followUp) setFollowUp(written.followUp);
    if (written?.delivered?.sent) say(`Notes sent to ${written.followUp.to}.`);
    else if (written) say("Notes written — but there were no recipients. Add addresses below and send.");
  };

  const rehearse = async () => {
    await savePlan();
    await call("rehearse", () =>
      fetch("/api/meeting/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "rehearse" }),
      }),
    );
    window.open("/bot", "_blank");
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
    if (!meeting.recipients.length) {
      setError("Add recipient emails first — that is who gets access.");
      return;
    }
    if (!window.confirm(`Give ${meeting.recipients.length} recipient(s) access to "${file.name}"? They each get a notification email.`)) return;
    const data = await call(`share:${file.id}`, () =>
      fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, emails: meeting.recipients }),
      }),
    );
    if (data) {
      const failed = (data.results ?? []).filter((r: { ok: boolean }) => !r.ok);
      say(failed.length ? `Shared, ${failed.length} address(es) refused.` : "Shared with everyone.");
    }
  };

  /* ── render ────────────────────────────────────────────────────────────── */

  const status = meeting.status;
  const planning = status === "draft";
  const rehearsing = status === "live" && !meeting.botId;
  const ready = config.googleConnected && config.recall && config.anam && config.publicUrlReachable;
  const name = config.botName.split("—")[0].trim();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-6 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Meeting Moderator</h1>
          <p className="text-sm text-white/40">
            {name} sits in on your Google Meet, answers when asked, and emails the notes afterwards.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            ok={config.googleConnected}
            label={config.email ?? "Google"}
            hint={
              config.googleConnected
                ? "Gmail, Calendar and Drive are available."
                : !config.googleClient
                  ? "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set."
                  : !config.sessionSecret
                    ? "SESSION_SECRET is not set — sign-in cannot store its cookie."
                    : `Not signed in. Google must have this exact redirect URI registered: ${config.googleRedirectUri}`
            }
          />
          <Pill ok={config.recall} label="Recall" hint="RECALL_API_KEY + RECALL_REGION" />
          <Pill ok={config.anam} label="Face & voice" hint="ANAM_API_KEY + ANAM_PERSONA_ID" />
          <Pill ok={config.publicUrlReachable} label="Public URL" hint={config.publicUrl || "PUBLIC_URL is not set"} />
          <Pill
            ok={config.store !== "file" || !config.publicUrl.includes("vercel.app")}
            label={{ redis: "Redis", mongo: "Mongo", file: "File store" }[config.store]}
            hint={
              config.store === "file"
                ? "data/meeting.json — fine locally, broken on serverless."
                : "Shared store — she and this page see the same meeting."
            }
          />
          {!config.googleConnected && (
            <a href="/api/auth/google" className={`${button} bg-sky-500 text-white hover:bg-sky-400`}>
              Connect Google
            </a>
          )}
        </div>
      </header>

      {!config.publicUrlReachable && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
          <strong className="font-semibold">PUBLIC_URL is not reachable.</strong> Recall&apos;s browser loads{" "}
          <code className="text-amber-100">/bot</code> over the internet, so localhost gives you a bot with a blank
          tile.
        </p>
      )}
      {error && <p className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200">{error}</p>}
      {note && <p className="rounded-xl border border-sky-400/30 bg-sky-400/5 p-4 text-sm text-sky-200">{note}</p>}

      {/* ── brief her ────────────────────────────────────────────────────── */}
      {planning ? (
        <Section
          title="Brief her"
          aside={
            calendar.length > 0 ? (
              <select
                className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/70"
                defaultValue=""
                onChange={(e) => {
                  const found = calendar.find((c) => c.id === e.target.value);
                  if (found) {
                    setDraft((d) => ({
                      ...d,
                      title: found.title,
                      meetingUrl: found.meetingUrl,
                      recipients: found.attendees.join(", "),
                    }));
                  }
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
                className={`${field} w-full`}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Generative AI — client workshop"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/40">Google Meet link</span>
              <input
                className={`${field} w-full`}
                value={draft.meetingUrl}
                onChange={(e) => setDraft({ ...draft, meetingUrl: e.target.value })}
                placeholder="https://meet.google.com/abc-defg-hij"
              />
            </label>
          </div>

          <label className="mt-4 block space-y-1">
            <span className="text-xs text-white/40">
              What is this meeting about?{" "}
              <span className="text-white/25">
                The subject, who is attending, anything she should know walking in. This is the only
                briefing she gets — it is what she answers from when somebody asks her something.
              </span>
            </span>
            <textarea
              className={`${field} h-44 w-full resize-y leading-relaxed`}
              value={draft.context}
              onChange={(e) => setDraft({ ...draft, context: e.target.value })}
              placeholder={
                "Quarterly review with Acme. Sam (their CTO) and Priya (procurement) are joining.\n\n" +
                "We are proposing the enterprise tier. They pushed back on price last time and want to see\n" +
                "the security review before committing. Budget sign-off sits with Priya.\n\n" +
                "If anyone asks about timelines: pilot in March, full rollout by June."
              }
            />
          </label>

          <fieldset className="mt-4">
            <legend className="text-xs text-white/40">
              How much does she join in?{" "}
              <span className="text-white/25">Being asked something directly always gets an answer.</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["quiet", "Quiet", "Only ever answers when spoken to."],
                  ["balanced", "Balanced", "Offers something occasionally."],
                  ["active", "Active", "Joins in like a participant with a view."],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  title={hint}
                  onClick={() => setDraft({ ...draft, activity: value })}
                  className={`${button} ${
                    draft.activity === value
                      ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40"
                      : "bg-white/5 text-white/50 hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 block space-y-1">
            <span className="text-xs text-white/40">
              Email the notes to{" "}
              <span className="text-white/25">— the people in the meeting, not her; she joins on her own.</span>
            </span>
            <input
              className={`${field} w-full`}
              value={draft.recipients}
              onChange={(e) => setDraft({ ...draft, recipients: e.target.value })}
              placeholder="sam@acme.com, priya@acme.com"
            />
          </label>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className={`${button} bg-sky-500 text-white hover:bg-sky-400`}
              disabled={!ready || !draft.meetingUrl || busy !== null}
              onClick={sendAva}
            >
              {busy === "start" ? "Sending…" : `Send ${name} to the meeting`}
            </button>
            <button className={`${button} bg-white/5 text-white/70 hover:bg-white/10`} onClick={savePlan}>
              Save
            </button>
            <button
              className={`${button} bg-white/5 text-white/70 hover:bg-white/10`}
              title="Run her with no bot and no call — check her face and voice work before a room does."
              onClick={rehearse}
              disabled={busy !== null}
            >
              Rehearse
            </button>
            {!ready && <span className="text-xs text-white/30">Fix the red pills above first.</span>}
          </div>
        </Section>
      ) : (
        /* ── in the room ──────────────────────────────────────────────────── */
        <Section
          title={
            status === "joining"
              ? "Knocking — admit her in Google Meet"
              : rehearsing
                ? "Rehearsing — no bot, no call"
                : status === "ended"
                  ? "Ended"
                  : "In the meeting"
          }
          aside={
            status !== "ended" ? (
              <button
                className={`${button} bg-rose-500/80 text-white hover:bg-rose-500`}
                onClick={endAndSend}
                disabled={busy !== null}
              >
                {busy === "stop"
                  ? "Ending…"
                  : busy === "write"
                    ? "Writing the notes…"
                    : rehearsing
                      ? "Stop rehearsal"
                      : "End & send notes"}
              </button>
            ) : null
          }
        >
          <div className="flex flex-wrap items-baseline gap-6">
            <p className="font-mono text-3xl tabular-nums">{mmss(secs)}</p>
            <p className="text-sm text-white/40">
              {meeting.transcript.length} line{meeting.transcript.length === 1 ? "" : "s"} heard ·{" "}
              {meeting.actions.length} action{meeting.actions.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-white/40">Heard</p>
              <div className="h-64 space-y-1.5 overflow-y-auto rounded-lg bg-black/30 p-3 text-sm">
                {meeting.transcript.length ? (
                  meeting.transcript.slice(-80).map((l) => (
                    <p key={l.id}>
                      <span className="text-sky-300">{l.speaker}</span>{" "}
                      <span className="text-white/70">{l.text}</span>
                    </p>
                  ))
                ) : (
                  <p className="text-white/25">
                    Nothing yet. Captions start once she is admitted and somebody speaks — turn on live
                    captions in the Meet window if this stays empty.
                  </p>
                )}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-white/40">Actions</p>
              <div className="h-64 space-y-2 overflow-y-auto rounded-lg bg-black/30 p-3 text-sm">
                {meeting.actions.length ? (
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

          {status !== "ended" && (
            <label className="mt-4 block space-y-1">
              <span className="text-xs text-white/40">
                Tell her something mid-meeting{" "}
                <span className="text-white/25">— added to her briefing; the next answer will know it.</span>
              </span>
              <div className="flex gap-2">
                <textarea
                  className={`${field} h-16 min-w-0 flex-1 resize-y`}
                  value={draft.context}
                  onChange={(e) => setDraft({ ...draft, context: e.target.value })}
                />
                <button className={`${button} shrink-0 bg-white/5 text-white/70 hover:bg-white/10`} onClick={savePlan}>
                  Update
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/30">Joins in:</span>
                {(["quiet", "balanced", "active"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={async () => {
                      setDraft((d) => ({ ...d, activity: value }));
                      await call("save", () =>
                        fetch("/api/meeting", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ activity: value }),
                        }),
                      );
                    }}
                    className={`rounded-md px-2 py-1 text-xs ${
                      meeting.activity === value
                        ? "bg-sky-500/20 text-sky-200"
                        : "bg-white/5 text-white/40 hover:bg-white/10"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </label>
          )}
        </Section>
      )}

      {/* ── files ────────────────────────────────────────────────────────── */}
      <Section title="Files for the room">
        <div className="flex gap-2">
          <input
            className={`${field} min-w-0 flex-1`}
            value={driveQuery}
            placeholder="Search your Drive…"
            onChange={(e) => setDriveQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchDrive()}
          />
          <button
            className={`${button} shrink-0 bg-white/5 text-white/70 hover:bg-white/10`}
            onClick={searchDrive}
            disabled={!config.googleConnected}
          >
            Search
          </button>
        </div>
        {drive.length > 0 && (
          <ul className="mt-3 divide-y divide-white/5">
            {drive.map((f) => {
              const already = meeting.files.find((s) => s.id === f.id);
              return (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <a href={f.link} target="_blank" rel="noreferrer" className="block truncate text-sm hover:text-sky-300">
                      {f.name}
                    </a>
                    <p className="text-xs text-white/30">
                      {already ? `shared with ${already.sharedWith.length}` : f.owner}
                    </p>
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

      {/* ── what went out ────────────────────────────────────────────────── */}
      {followUp.subject && (
        <Section
          title={meeting.followUp?.sentAt ? "Sent" : "Notes — not sent yet"}
          aside={
            <span className="text-xs text-white/30">
              {meeting.followUp?.sentAt ? `to ${followUp.to}` : "edit below, then send"}
            </span>
          }
        >
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs text-white/40">To</span>
              <input
                className={`${field} w-full`}
                value={followUp.to}
                onChange={(e) => setFollowUp({ ...followUp, to: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-white/40">Subject</span>
              <input
                className={`${field} w-full`}
                value={followUp.subject}
                onChange={(e) => setFollowUp({ ...followUp, subject: e.target.value })}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-white/40">Body</span>
              <textarea
                className={`${field} h-72 w-full resize-y font-mono text-xs leading-relaxed`}
                value={followUp.body}
                onChange={(e) => setFollowUp({ ...followUp, body: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                className={`${button} bg-white/5 text-white/70 hover:bg-white/10`}
                onClick={() => deliver("draft")}
                disabled={busy !== null}
              >
                Save as Gmail draft
              </button>
              <button
                className={`${button} bg-sky-500 text-white hover:bg-sky-400`}
                onClick={() => deliver("send")}
                disabled={busy !== null}
              >
                {meeting.followUp?.sentAt ? "Send again" : "Send"}
              </button>
            </div>
          </div>
        </Section>
      )}

      <footer className="flex items-center justify-between pt-2 text-xs text-white/25">
        <span>
          Her tile:{" "}
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
