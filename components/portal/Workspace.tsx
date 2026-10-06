"use client";

/**
 * A client's Ava: what she knows about them, how they want her to work, and their
 * meetings — each of which they can prepare her for. The client sees their own; an NDI
 * admin sees any client's (`clientId`), the same page.
 */

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { pickFromDrive, type PickerConfig } from "./drivePicker";
import { BoltIcon, BookIcon, CalendarIcon, DriveIcon, FileIcon, LinkIcon, SettingsIcon, SparkIcon, TextIcon, UploadIcon } from "./icons";
import { LivePanel, SendNow, useLive } from "./Live";
import Markdown from "./Markdown";
import MeetingRecord from "./MeetingRecord";
import Setup from "./Setup";
import { Chip, CompanyLogo, IconTile, Notice, Section, ago, api, danger, field, primary, quiet, when } from "./ui";

type Doc = {
  id: string;
  meeting_id: string | null;
  kind: "upload" | "drive" | "link" | "text";
  title: string;
  mime: string | null;
  source: string | null;
  status: "processing" | "ready" | "failed";
  error: string | null;
  chars: number;
  summary: string | null;
  created_at: string;
};

type Prep = { goal?: string; agenda?: string; people?: string; avoid?: string; notes?: string };

type Meeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  meeting_url: string | null;
  organizer: string | null;
  organizer_name: string | null;
  guests: { email: string; name?: string }[];
  description: string;
  status: string;
  prep: Prep;
  prep_at: string | null;
  brief: string | null;
  brief_at: string | null;
  notes: { to?: string; subject?: string; body?: string; summary?: string; sentAt?: number } | null;
  ended_at: string | null;
  documents: number;
};

type Data = {
  client: {
    id: string;
    name: string;
    instructions: string;
    digest: string;
    digest_at: string | null;
    domains: string[];
    addresses: string[];
    status: string;
    logo_url: string | null;
  };
  documents: Doc[];
  meetings: Meeting[];
  ava: string | null;
};

const ACCEPT =
  ".pdf,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp,.txt,.md,.json,.html,.htm,.png,.jpg,.jpeg,.webp,.gif";

/* ----------------------------------------------------------------- page */

export default function Workspace({ clientId, picker = null }: { clientId?: string; picker?: PickerConfig | null }) {
  const q = clientId ? `?client=${clientId}` : "";
  const [data, setData] = useState<Data | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [digesting, setDigesting] = useState(false);
  const [tab, setTab] = useState<Tab>("meetings");
  // Which meetings are past and which are about to start: read with the data, and each minute.
  const [now, setNow] = useState(() => Date.now());
  // Her meeting, if it is theirs, followed live; and "Need Ava now?" open or not.
  const live = useLive(q);
  const [sendingNow, setSendingNow] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Data>(`/api/portal/workspace${q}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setNow(Date.now());
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load."));
    return () => {
      alive = false;
    };
  }, [q, version]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const rebuildDigest = useCallback(async () => {
    setDigesting(true);
    try {
      const d = await api<{ digest: string; digest_at: string }>(`/api/portal/digest${q}`, { method: "POST" });
      setData((prev) => (prev ? { ...prev, client: { ...prev.client, digest: d.digest, digest_at: d.digest_at } } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update what she knows.");
    } finally {
      setDigesting(false);
    }
  }, [q]);

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          // The page's shape while it loads: header, tabs, a section.
          <div className="space-y-5" aria-label="Loading">
            <div className="h-44 animate-pulse rounded-3xl bg-linear-to-br from-blue-200/70 to-indigo-200/60" />
            <div className="h-14 animate-pulse rounded-2xl bg-slate-200/70" />
            <div className="h-72 animate-pulse rounded-2xl bg-slate-200/50" />
          </div>
        )}
      </div>
    );
  }

  const { client } = data;
  // Called off — deleted by the host, or she was taken off the invite — kept apart, with their history.
  const cancelled = data.meetings.filter((m) => m.status === "cancelled").reverse();
  const held = data.meetings.filter((m) => m.status !== "cancelled");
  const upcoming = held.filter((m) => new Date(m.ends_at ?? m.starts_at).getTime() > now);
  const past = held.filter((m) => new Date(m.ends_at ?? m.starts_at).getTime() <= now).reverse();
  const ava = data.ava ?? "Ava";
  const routes = [...client.domains.map((d) => `anyone @${d}`), ...client.addresses];
  const paused = client.status !== "active";
  const tabs: { id: Tab; label: string; icon: (p: { className?: string }) => React.ReactNode; count?: number }[] = [
    { id: "meetings", label: "Meetings", icon: CalendarIcon, count: upcoming.length },
    { id: "knowledge", label: "What she knows", icon: BookIcon, count: data.documents.filter((d) => d.status === "ready").length },
    { id: "instructions", label: "How she works for you", icon: SparkIcon },
    // Their logo, name and who can use her. NDI has the whole setup above this page instead.
    ...(clientId ? [] : [{ id: "setup" as const, label: "Setup", icon: SettingsIcon }]),
  ];
  const mine = live.live && live.live.phase !== "ended";
  const state = paused
    ? { text: "Paused — she skips your meetings", dot: "bg-amber-300" }
    : mine
      ? { text: live.live!.phase === "live" ? "In your meeting right now" : "On her way to your meeting", dot: "bg-emerald-300 animate-pulse" }
      : live.busy
        ? { text: "In another meeting right now", dot: "bg-amber-300" }
        : { text: "Free — she can join a meeting now", dot: "bg-emerald-300" };

  return (
    <PickerContext.Provider value={picker}>
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
      <header className="relative overflow-hidden rounded-3xl bg-linear-to-br from-blue-600 via-blue-600 to-indigo-700 p-6 text-white shadow-xl shadow-blue-900/15 sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-sky-300/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 left-1/4 size-80 rounded-full bg-indigo-400/30 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="shrink-0 rounded-2xl bg-white p-1.5 shadow-lg shadow-blue-950/20">
              <CompanyLogo name={client.name} url={client.logo_url} size={56} decorative />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">Ava for</p>
              <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{client.name}</h1>
              <p className="mt-1.5 flex items-center gap-2 text-sm text-blue-100">
                <span className={`size-2 rounded-full ${state.dot}`} />
                {state.text}
              </p>
            </div>
          </div>
          {/* Not while she is already in a meeting — theirs is below, another client's is not theirs to see. */}
          <button
            onClick={() => setSendingNow(true)}
            disabled={paused || live.busy}
            title={live.busy ? (mine ? "She is in your meeting — it is below." : "Ava is in another meeting right now.") : undefined}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-blue-700 shadow-lg shadow-blue-950/20 transition duration-150 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 sm:w-auto"
          >
            <BoltIcon className="size-5 transition group-hover:scale-110" />
            {mine ? "She is in your meeting" : live.busy ? "In another meeting" : "Need Ava now?"}
          </button>
        </div>
        <p className="relative mt-6 max-w-3xl text-sm leading-relaxed text-blue-50/90">
          Invite <span className="font-semibold text-white">{ava}</span> to your meetings from your calendar, like a colleague — or send
          her to one right now. Here you give her what she should know about {client.name}, and prepare her for each meeting.
          {routes.length > 0 && <> Meetings organised by {routes.join(", ")} are yours too.</>}
        </p>
      </header>

      {live.live && <LivePanel live={live.live} at={live.at} q={q} onChanged={live.refresh} />}
      {sendingNow && (
        <SendNow q={q} clientName={client.name} busy={live.busy && !mine} onClose={() => setSendingNow(false)} onSent={live.refresh} />
      )}

      {/* One part at a time. All stay loaded, so a file uploading or a note being typed survives a switch. */}
      <nav
        role="tablist"
        aria-label={`Ava for ${client.name}`}
        className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200/70 bg-white p-1.5 shadow-sm"
      >
        {tabs.map((t) => {
          const on = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition duration-150 ${
                on ? "bg-blue-600 text-white shadow-md shadow-blue-600/25" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
              {t.count !== undefined && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {error && (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div role="tabpanel" hidden={tab !== "meetings"}>
      <Section
        title="Meetings"
        icon={<CalendarIcon />}
        description={upcoming.length ? `${upcoming.length} coming up — prepare her for each` : "Nothing coming up yet"}
      >
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
            <IconTile className="size-12">
              <CalendarIcon className="size-6" />
            </IconTile>
            <p className="font-medium text-slate-800">No meetings coming up</p>
            <p className="max-w-md text-sm leading-relaxed text-slate-500">
              Invite {ava} to a meeting from your calendar — it shows here within a minute, ready to prepare. Or send her to one
              right now.
            </p>
            {!paused && !live.busy && (
              <button className={primary} onClick={() => setSendingNow(true)}>
                <BoltIcon className="size-4" />
                Need Ava now?
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((m) => (
              <UpcomingMeeting key={m.id} meeting={m} now={now} q={q} onChange={reload} onError={setError} />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <div className="mt-6 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Past 30 days</h3>
            <ul className="space-y-2">
              {past.map((m) => (
                <PastMeeting key={m.id} meeting={m} q={q} />
              ))}
            </ul>
          </div>
        )}
        {cancelled.length > 0 && (
          <div className="mt-6 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Called off — deleted or taken off her calendar</h3>
            <ul className="space-y-2">
              {cancelled.map((m) => (
                <PastMeeting key={m.id} meeting={m} q={q} />
              ))}
            </ul>
          </div>
        )}
      </Section>
      </div>

      <div role="tabpanel" hidden={tab !== "knowledge"} className="space-y-5">
      <Section
        title="Her documents"
        icon={<BookIcon />}
        tone="violet"
        description="She reads them now, and in a meeting looks up what she needs. Files are kept in NDI's Google Drive; nothing is shared."
        aside={
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
            {data.documents.filter((d) => d.status === "ready").length} read
          </span>
        }
      >
        <AddDocuments
          q={q}
          onAdded={(doc) => setData((prev) => (prev ? { ...prev, documents: [doc, ...prev.documents] } : prev))}
          onBatchDone={(added) => {
            if (added) void rebuildDigest();
          }}
          onError={setError}
        />
        <DocumentList
          documents={data.documents}
          q={q}
          onRemoved={(id) => {
            setData((prev) => (prev ? { ...prev, documents: prev.documents.filter((d) => d.id !== id) } : prev));
            void rebuildDigest();
          }}
          onReplaced={(oldId, doc) => {
            setData((prev) => (prev ? { ...prev, documents: prev.documents.map((d) => (d.id === oldId ? doc : d)) } : prev));
            if (doc.status === "ready") void rebuildDigest();
          }}
          onError={setError}
        />
      </Section>

      {/* What she took from them, shown like a project's README under its files. */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.14)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-linear-to-r from-emerald-50/80 to-white px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3 text-sm font-semibold text-slate-800">
            <IconTile tone="emerald" className="size-8">
              <SparkIcon className="size-4" />
            </IconTile>
            <span className="truncate">What Ava knows about {client.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{digesting ? "Reading your documents…" : client.digest_at ? `Updated ${ago(client.digest_at)}` : ""}</span>
            <button className={quiet} onClick={() => void rebuildDigest()} disabled={digesting}>
              {digesting ? "Updating…" : "Update"}
            </button>
          </div>
        </div>
        <div className="px-5 py-5 sm:px-8 sm:py-6">
          {client.digest ? (
            <Markdown>{client.digest}</Markdown>
          ) : (
            <p className="text-sm text-slate-500">Nothing yet. Add documents and she writes down what she takes from them.</p>
          )}
        </div>
      </section>
      </div>

      <div role="tabpanel" hidden={tab !== "instructions"}>
        <Instructions key={client.id} initial={client.instructions} name={client.name} q={q} onError={setError} />
      </div>

      {!clientId && (
        <div role="tabpanel" hidden={tab !== "setup"}>
          <Setup onChanged={reload} />
        </div>
      )}
    </div>
    </PickerContext.Provider>
  );
}

/** The page's parts, one shown at a time: three, and Setup for the client's own people. */
type Tab = "meetings" | "knowledge" | "instructions" | "setup";

/* ------------------------------------------------------------ documents */

/** Google's file picker settings, from the page — null hides "From Google Drive". */
const PickerContext = createContext<PickerConfig | null>(null);

function AddDocuments({
  q,
  meetingId,
  onAdded,
  onBatchDone,
  onError,
}: {
  q: string;
  meetingId?: string;
  onAdded: (doc: Doc) => void;
  onBatchDone?: (added: number) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [link, setLink] = useState("");
  const [writing, setWriting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState({ title: "", text: "" });
  const input = useRef<HTMLInputElement>(null);
  const picker = useContext(PickerContext);

  /** One at a time, each in its own request: every file gets the server's whole time limit. Returns how many she read. */
  async function run(jobs: { label: string; send: () => Promise<{ document: Doc }> }[]): Promise<number> {
    if (!jobs.length) return 0;
    setPending((p) => [...p, ...jobs.map((j) => j.label)]);
    let added = 0;
    for (const job of jobs) {
      try {
        const { document } = await job.send();
        onAdded(document);
        if (document.status === "ready") added++;
        else onError(`${document.title}: ${document.error ?? "could not be read"}`);
      } catch (e) {
        onError(`${job.label}: ${e instanceof Error ? e.message : "failed"}`);
      } finally {
        setPending((p) => {
          const i = p.indexOf(job.label);
          return i < 0 ? p : [...p.slice(0, i), ...p.slice(i + 1)];
        });
      }
    }
    onBatchDone?.(added);
    return added;
  }

  function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    void run(
      Array.from(files).map((file) => ({
        label: file.name,
        send: () => {
          const form = new FormData();
          form.set("file", file);
          if (meetingId) form.set("meeting", meetingId);
          return api<{ document: Doc }>(`/api/portal/knowledge${q}`, { method: "POST", body: form });
        },
      })),
    );
    if (input.current) input.current.value = "";
  }

  async function fromDrive() {
    if (!picker) return;
    try {
      const picked = await pickFromDrive(picker);
      if (!picked) return;
      void run(
        picked.files.map((f) => ({
          label: f.name,
          send: () =>
            api<{ document: Doc }>(`/api/portal/knowledge${q}`, {
              method: "POST",
              body: JSON.stringify({ kind: "drive", token: picked.token, fileId: f.id, meeting: meetingId }),
            }),
        })),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Google Drive did not open.");
    }
  }

  function addLink(e: React.FormEvent) {
    e.preventDefault();
    const url = link.trim();
    if (!url) return;
    setLink("");
    setLinking(false);
    void run([
      {
        label: url,
        send: () =>
          api<{ document: Doc }>(`/api/portal/knowledge${q}`, {
            method: "POST",
            body: JSON.stringify({ kind: "link", url, meeting: meetingId }),
          }),
      },
    ]);
  }

  /** The text stays in the form until she has read it, so nothing typed is lost to an error. */
  async function addText(e: React.FormEvent) {
    e.preventDefault();
    const text = note.text.trim();
    if (!text) return;
    const title = note.title.trim();
    setWriting(false);
    const added = await run([
      {
        label: title || "your text",
        send: () =>
          api<{ document: Doc }>(`/api/portal/knowledge${q}`, {
            method: "POST",
            body: JSON.stringify({ kind: "text", title, text, meeting: meetingId }),
          }),
      },
    ]);
    if (added) setNote({ title: "", text: "" });
    else setWriting(true);
  }

  return (
    <div className="space-y-3">
      <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
      {/* Files can be dropped anywhere on it; the buttons are every other way in. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-5 transition duration-150 ${
          dragging ? "scale-[1.01] border-blue-400 bg-blue-50/80" : "border-slate-200 bg-slate-50/50 hover:border-slate-300"
        }`}
      >
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <IconTile tone={dragging ? "blue" : "violet"} className="size-11">
            <UploadIcon className="size-5" />
          </IconTile>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">{dragging ? "Drop them — she reads them at once" : "Drop files here, or add them another way"}</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              PDF, Word, Excel, PowerPoint, Google Docs, Sheets and Slides, images and text — up to 4 MB here
              {picker ? "; bigger files through Google Drive (its Upload tab takes them from your computer)." : "."}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button className={quiet} onClick={() => input.current?.click()}>
            <UploadIcon className="size-4" />
            Upload files
          </button>
          {picker && (
            <button className={quiet} onClick={() => void fromDrive()}>
              <DriveIcon className="size-4" />
              From Google Drive
            </button>
          )}
          <button
            className={`${quiet} ${linking ? "border-blue-300 bg-blue-50 text-blue-700" : ""}`}
            onClick={() => {
              setLinking((v) => !v);
              setWriting(false);
            }}
          >
            <LinkIcon className="size-4" />
            Add a link
          </button>
          {/* A meeting has its own notes in its preparation; this is for what she knows about them. */}
          {!meetingId && (
            <button
              className={`${quiet} ${writing ? "border-blue-300 bg-blue-50 text-blue-700" : ""}`}
              onClick={() => {
                setWriting((v) => !v);
                setLinking(false);
              }}
            >
              <TextIcon className="size-4" />
              Add text
            </button>
          )}
        </div>
      </div>
      {writing && (
        <form onSubmit={(e) => void addText(e)} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input
            className={field}
            placeholder="Title (optional) — e.g. Prices for 2026, Who is who"
            maxLength={300}
            value={note.title}
            onChange={(e) => setNote((n) => ({ ...n, title: e.target.value }))}
          />
          <textarea
            autoFocus
            rows={7}
            className={field}
            placeholder="Anything she should know: who is who, prices and terms, how to answer a question, what not to say…"
            value={note.text}
            onChange={(e) => setNote((n) => ({ ...n, text: e.target.value }))}
          />
          <div className="flex items-center gap-2">
            <button className={primary} disabled={!note.text.trim()}>
              Add
            </button>
            <button type="button" className={quiet} onClick={() => setWriting(false)}>
              Cancel
            </button>
            <span className="text-xs text-slate-400">She reads it like a document and can look it up in a meeting.</span>
          </div>
        </form>
      )}
      {linking && (
        <form onSubmit={addLink} className="flex flex-col gap-2 sm:flex-row">
          <input
            autoFocus
            type="url"
            className={field}
            placeholder="https://your-company.com/about, or a public Google Doc"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button className={primary} disabled={!link.trim()}>
            Add
          </button>
        </form>
      )}
      {pending.length > 0 && (
        <ul className="space-y-2">
          {pending.map((label, i) => (
            <li key={`${label}-${i}`} className="flex items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-800 ring-1 ring-inset ring-blue-200">
              <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
              <span className="min-w-0 truncate">Reading {label}…</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND = {
  upload: { label: "File", icon: FileIcon, tone: "violet" },
  drive: { label: "From Drive", icon: DriveIcon, tone: "emerald" },
  link: { label: "Link", icon: LinkIcon, tone: "sky" },
  text: { label: "Text", icon: TextIcon, tone: "amber" },
} as const;

function DocumentList({
  documents,
  q,
  onRemoved,
  onReplaced,
  onError,
}: {
  documents: Doc[];
  q: string;
  onRemoved: (id: string) => void;
  /** A link that could not be read, read again: the new try in place of the old. */
  onReplaced: (oldId: string, doc: Doc) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Doc | null>(null);
  if (!documents.length) return null;

  /** The same link, read again; the failed try goes once the new one is in. */
  async function retry(doc: Doc) {
    setRetrying(doc.id);
    try {
      const { document } = await api<{ document: Doc }>(`/api/portal/knowledge${q}`, {
        method: "POST",
        body: JSON.stringify({ kind: "link", url: doc.source, meeting: doc.meeting_id ?? undefined }),
      });
      await api(`/api/portal/knowledge/${doc.id}${q}`, { method: "DELETE" }).catch(() => undefined);
      onReplaced(doc.id, document);
      if (document.status !== "ready") onError(`${document.title}: ${document.error ?? "could not be read"}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not read it again.");
    } finally {
      setRetrying(null);
    }
  }

  async function remove(doc: Doc) {
    if (!window.confirm(`Remove “${doc.title}”? She will no longer know what is in it.`)) return;
    setRemoving(doc.id);
    try {
      await api(`/api/portal/knowledge/${doc.id}${q}`, { method: "DELETE" });
      onRemoved(doc.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not remove it.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <>
    <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80">
      {documents.map((doc) => {
        const kind = KIND[doc.kind];
        const KindIcon = kind.icon;
        return (
        <li key={doc.id} className="p-3 transition hover:bg-slate-50/80">
          <div className="flex flex-wrap items-center gap-3">
            <span title={kind.label}>
              <IconTile tone={kind.tone} className="size-8">
                <KindIcon className="size-4" />
              </IconTile>
            </span>
            <button
              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 hover:text-blue-700"
              onClick={() => setOpen(open === doc.id ? null : doc.id)}
              title={doc.title}
            >
              {doc.title}
            </button>
            {doc.status === "ready" ? (
              <span className="text-xs text-slate-400">
                {kind.label} · {doc.chars.toLocaleString()} characters · {ago(doc.created_at)}
              </span>
            ) : doc.status === "failed" ? (
              <Chip tone="bad">Could not read</Chip>
            ) : (
              <Chip tone="info">Reading…</Chip>
            )}
            {doc.status === "ready" && (
              <button
                className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 hover:text-blue-700"
                onClick={() => setPreviewing(doc)}
              >
                Preview
              </button>
            )}
            {doc.status === "failed" && doc.kind === "link" && doc.source && (
              <button
                className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 hover:text-blue-700 disabled:opacity-60"
                onClick={() => void retry(doc)}
                disabled={retrying !== null}
              >
                {retrying === doc.id ? "Reading…" : "Try again"}
              </button>
            )}
            <button
              className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"
              onClick={() => void remove(doc)}
              disabled={removing === doc.id}
            >
              {removing === doc.id ? "Removing…" : "Remove"}
            </button>
          </div>
          {/* Why it failed, said where it failed — not behind a click. */}
          {doc.status === "failed" && doc.error && <p className="mt-1.5 text-xs leading-5 text-rose-700 sm:ml-11">{doc.error}</p>}
          {open === doc.id && (doc.summary || doc.source) && (
            <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-inset ring-slate-200/70 sm:ml-11">
              {doc.summary && <p className="whitespace-pre-wrap leading-relaxed">{doc.summary}</p>}
              {doc.source && /^https?:/.test(doc.source) && (
                <a href={doc.source} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                  Open the original ↗
                </a>
              )}
            </div>
          )}
        </li>
        );
      })}
    </ul>
    {previewing && <Preview doc={previewing} q={q} onClose={() => setPreviewing(null)} />}
    </>
  );
}

type Loaded<T> = T | { error: string } | null;

/**
 * One document, two ways: the file as it was given (the copy kept in NDI's Drive — Google
 * files as a PDF), and the text she read from it, which is what she searches in a meeting.
 * A link, and text written on the page, have only the second.
 */
function Preview({ doc, q, onClose }: { doc: Doc; q: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const hasFile = doc.kind === "upload" || doc.kind === "drive";
  const [view, setView] = useState<"file" | "text">(hasFile ? "file" : "text");
  const [file, setFile] = useState<Loaded<{ url: string; type: string; text?: string }>>(null);
  const [read, setRead] = useState<Loaded<{ text: string }>>(null);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  // Fetched rather than framed: when there is no copy to show, the reason reads as a sentence, not as raw JSON.
  useEffect(() => {
    if (!hasFile) return;
    let alive = true;
    let url = "";
    (async () => {
      const res = await fetch(`/api/portal/knowledge/${doc.id}/file${q}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const text = blob.type.startsWith("text/") ? await blob.text() : undefined;
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setFile({ url, type: blob.type, text });
    })().catch((e) => alive && setFile({ error: e instanceof Error ? e.message : "Could not load it." }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [hasFile, doc.id, q]);

  useEffect(() => {
    if (view !== "text" || read) return;
    let alive = true;
    api<{ text: string }>(`/api/portal/knowledge/${doc.id}${q}`)
      .then((d) => alive && setRead({ text: d.text }))
      .catch((e) => alive && setRead({ error: e instanceof Error ? e.message : "Could not load it." }));
    return () => {
      alive = false;
    };
  }, [view, read, doc.id, q]);

  const close = () => dialog.current?.close();
  const original = doc.source && /^https?:/.test(doc.source) ? doc.source : null;
  const loading = <p className="p-6 text-sm text-slate-500">Loading…</p>;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-auto h-[calc(100dvh-2rem)] max-h-[56rem] w-[calc(100vw-2rem)] max-w-5xl overflow-hidden rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-slate-900/50"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 id={heading} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900" title={doc.title}>
            {doc.title}
          </h2>
          {hasFile && (
            <div role="tablist" aria-label="Show" className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              {(["file", "text"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {v === "file" ? "The file" : "What she read"}
                </button>
              ))}
            </div>
          )}
          {original && (
            <a href={original} target="_blank" rel="noreferrer" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              {doc.kind === "link" ? "Open the page ↗" : "Open the original ↗"}
            </a>
          )}
          <button
            onClick={close}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            ✕
          </button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain bg-slate-50">
          {view === "file" ? (
            !file ? (
              loading
            ) : "error" in file ? (
              <div className="space-y-3 p-6 text-sm text-slate-600">
                <p>{file.error}</p>
                <button className={quiet} onClick={() => setView("text")}>
                  See what she read
                </button>
              </div>
            ) : file.type.startsWith("image/") ? (
              // A local object URL: next/image has nothing to optimise here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.url} alt={doc.title} className="mx-auto max-h-full max-w-full object-contain p-4" />
            ) : file.type === "application/pdf" ? (
              <iframe src={file.url} title={doc.title} className="absolute inset-0 h-full w-full bg-white" />
            ) : file.text !== undefined ? (
              <pre className="whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed text-slate-800">{file.text}</pre>
            ) : (
              <div className="space-y-3 p-6 text-sm text-slate-600">
                <p>This kind of file cannot be shown here.</p>
                <a href={file.url} download={doc.title} className={quiet}>
                  Download it
                </a>
              </div>
            )
          ) : !read ? (
            loading
          ) : "error" in read ? (
            <p className="p-6 text-sm text-rose-700">{read.error}</p>
          ) : (
            <div className="p-5">
              <p className="mb-3 text-xs text-slate-400">
                {doc.chars.toLocaleString()} characters — what she searches when this comes up in a meeting.
              </p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
                {read.text || "Nothing was read from it."}
              </pre>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------- meetings */

function briefState(m: Meeting): { tone: "good" | "warn" | "neutral"; label: string } {
  const prepared = Object.values(m.prep ?? {}).some((v) => typeof v === "string" && v.trim()) || m.documents > 0;
  if (m.brief && (!m.prep_at || !m.brief_at || m.brief_at >= m.prep_at)) return { tone: "good", label: "Prepared" };
  if (prepared) return { tone: "warn", label: m.brief ? "Brief out of date" : "Preparation saved" };
  return { tone: "neutral", label: "Not prepared" };
}

function UpcomingMeeting({
  meeting,
  now,
  q,
  onChange,
  onError,
}: {
  meeting: Meeting;
  now: number;
  q: string;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const state = briefState(meeting);
  const soon = new Date(meeting.starts_at).getTime() - now < 15 * 60_000;
  const start = new Date(meeting.starts_at);
  return (
    <li
      className={`rounded-2xl border bg-white transition duration-150 ${
        open ? "border-blue-200 shadow-lg shadow-blue-900/5 ring-4 ring-blue-500/5" : "border-slate-200/80 hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
      }`}
    >
      <div className="flex flex-wrap items-center gap-4 p-4">
        {/* The day, as on a calendar page. */}
        <div className="flex w-12 shrink-0 flex-col items-center overflow-hidden rounded-xl border border-slate-200 bg-white text-center shadow-sm">
          <span className="w-full bg-linear-to-b from-blue-500 to-blue-600 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            {start.toLocaleDateString([], { month: "short" })}
          </span>
          <span className="py-1 text-lg font-semibold leading-none text-slate-900">{start.getDate()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">{meeting.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {when(meeting.starts_at)}
            {meeting.organizer && <> · organised by {meeting.organizer_name || meeting.organizer}</>}
            {meeting.guests?.length > 0 && <> · {meeting.guests.length} invited</>}
          </p>
        </div>
        {soon && <Chip tone="info">Starting soon</Chip>}
        <Chip tone={state.tone}>{state.label}</Chip>
        <button className={open || state.tone === "good" ? quiet : primary} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : state.tone === "good" ? "Edit preparation" : "Prepare her"}
        </button>
      </div>
      {open && <PrepPanel meeting={meeting} q={q} onSaved={onChange} onError={onError} />}
    </li>
  );
}

const PREP_FIELDS: { key: keyof Prep; label: string; hint: string; rows: number }[] = [
  { key: "goal", label: "What is this meeting for?", hint: "e.g. Agree the scope and price of phase 2 with Acme.", rows: 2 },
  { key: "agenda", label: "Agenda", hint: "One point per line. She can keep time and move it on.", rows: 4 },
  { key: "people", label: "Who is coming, and what she should know about them", hint: "e.g. Anna Weber, Acme's CFO: cares about cost, decides.", rows: 3 },
  { key: "avoid", label: "What to avoid", hint: "e.g. Do not discuss the merger. No prices before Anna joins.", rows: 2 },
  { key: "notes", label: "Anything else", hint: "Her role, open questions, what a good outcome is…", rows: 3 },
];

function PrepPanel({
  meeting,
  q,
  onSaved,
  onError,
}: {
  meeting: Meeting;
  q: string;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [prep, setPrep] = useState<Prep>(meeting.prep ?? {});
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [brief, setBrief] = useState<{ text: string | null; at: string | null }>({ text: meeting.brief, at: meeting.brief_at });
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const sep = q ? "&" : "?";

  useEffect(() => {
    let alive = true;
    api<{ documents: Doc[] }>(`/api/portal/knowledge${q}${sep}meeting=${meeting.id}`)
      .then((d) => alive && setDocs(d.documents))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
    };
  }, [meeting.id, q, sep]);

  async function save(rewriteOnly = false) {
    setSaving(true);
    try {
      const { meeting: m } = rewriteOnly
        ? await api<{ meeting: Meeting }>(`/api/portal/meetings/${meeting.id}${q}`, { method: "POST" })
        : await api<{ meeting: Meeting }>(`/api/portal/meetings/${meeting.id}${q}`, { method: "PUT", body: JSON.stringify({ prep }) });
      setBrief({ text: m.brief, at: m.brief_at });
      setChanged(false);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 border-t border-slate-200 p-4">
      {meeting.description.trim() && (
        <details className="text-sm text-slate-500">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-600">The invite&apos;s description</summary>
          <p className="mt-2 whitespace-pre-wrap">{meeting.description}</p>
        </details>
      )}

      <div className="grid gap-4">
        {PREP_FIELDS.map((f) => (
          <label key={f.key} className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600">{f.label}</span>
            <textarea
              rows={f.rows}
              className={field}
              placeholder={f.hint}
              value={prep[f.key] ?? ""}
              onChange={(e) => {
                setPrep((p) => ({ ...p, [f.key]: e.target.value }));
                setChanged(true);
              }}
            />
          </label>
        ))}
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-slate-600">Documents for this meeting only</h4>
        <AddDocuments
          q={q}
          meetingId={meeting.id}
          onAdded={(doc) => {
            setDocs((d) => [doc, ...(d ?? [])]);
            setChanged(true);
          }}
          onError={onError}
        />
        {docs && (
          <DocumentList
            documents={docs}
            q={q}
            onRemoved={(id) => {
              setDocs((d) => (d ?? []).filter((x) => x.id !== id));
              setChanged(true);
            }}
            onReplaced={(oldId, doc) => {
              setDocs((d) => (d ?? []).map((x) => (x.id === oldId ? doc : x)));
              setChanged(true);
            }}
            onError={onError}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={primary} onClick={() => void save()} disabled={saving}>
          {saving ? "She is reading it…" : "Save and brief her"}
        </button>
        {brief.text && (
          <button className={quiet} onClick={() => void save(true)} disabled={saving}>
            Rewrite her brief
          </button>
        )}
        {changed && !saving && <span className="text-xs text-amber-700">Not saved yet</span>}
      </div>

      {brief.text && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-emerald-800">What she will walk in with</h4>
            <span className="text-xs text-slate-400">{brief.at ? `Written ${ago(brief.at)}` : ""}</span>
          </div>
          <Markdown>{brief.text}</Markdown>
        </div>
      )}

      {/* What happened to it so far: the host's changes, each saved preparation, documents. */}
      <details className="group rounded-xl border border-slate-200 bg-white">
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-700">
          History of this meeting
          <span className="text-xs text-slate-400 transition group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <MeetingRecord meetingId={meeting.id} q={q} views={["history"]} />
      </details>
    </div>
  );
}

/**
 * A meeting that is over — or was called off: open it for its notes (the email as it
 * went out), the preparation she had, and its whole history.
 */
function PastMeeting({ meeting, q }: { meeting: Meeting; q: string }) {
  const [open, setOpen] = useState(false);
  const notes = meeting.notes;
  const cancelled = meeting.status === "cancelled";
  return (
    <li className={`overflow-hidden rounded-xl border transition ${open ? "border-slate-300 bg-slate-50/40 shadow-sm" : "border-slate-200/70 bg-slate-50/70 hover:border-slate-300 hover:bg-white"}`}>
      <button className="flex w-full flex-wrap items-center gap-3 p-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`min-w-0 flex-1 truncate text-sm font-medium ${cancelled ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700"}`}>{meeting.title}</span>
        <span className="text-xs text-slate-400">{when(meeting.starts_at)}</span>
        {cancelled ? (
          <Chip tone="bad">Called off</Chip>
        ) : notes?.sentAt ? (
          <Chip tone="good">Notes emailed</Chip>
        ) : notes ? (
          <Chip tone="info">Notes</Chip>
        ) : (
          <Chip>No notes</Chip>
        )}
        <span className={`text-xs text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && <MeetingRecord meetingId={meeting.id} q={q} views={cancelled ? ["history", "prep"] : ["notes", "prep", "history"]} />}
    </li>
  );
}

/* ---------------------------------------------------------- instructions */

function Instructions({ initial, name, q, onError }: { initial: string; name: string; q: string; onError: (message: string) => void }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { instructions } = await api<{ instructions: string }>(`/api/portal/profile${q}`, {
        method: "PATCH",
        body: JSON.stringify({ instructions: text }),
      });
      setSaved(instructions);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="How she works for you"
      icon={<SparkIcon />}
      tone="amber"
      description={`In your own words: who ${name} is, the tone she should take, what she may and may not say. She reads this before every meeting.`}
    >
      <textarea
        rows={6}
        className={field}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. We are a law firm in Berlin. Be formal; in German use Sie. Never quote fees — refer them to Anna Weber. Our clients are mid-sized manufacturers."
      />
      <div className="mt-3 flex items-center gap-3">
        <button className={primary} onClick={() => void save()} disabled={saving || text === saved}>
          {saving ? "Saving…" : "Save"}
        </button>
        {text !== saved && !saving && (
          <button className={danger} onClick={() => setText(saved)}>
            Undo
          </button>
        )}
        {text === saved && saved && !saving && <span className="text-xs font-medium text-emerald-600">Saved — she has it</span>}
      </div>
    </Section>
  );
}
