"use client";

/**
 * A client's Ava: what she knows about them, how they want her to work, and their
 * meetings — each of which they can prepare her for. The client sees their own; an NDI
 * admin sees any client's (`clientId`), the same page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { pickFromDrive, pickerConfigured } from "./drivePicker";
import { Chip, Notice, Section, ago, api, danger, field, primary, quiet, when } from "./ui";

type Doc = {
  id: string;
  meeting_id: string | null;
  kind: "upload" | "drive" | "link";
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
  };
  documents: Doc[];
  meetings: Meeting[];
  ava: string | null;
};

const ACCEPT =
  ".pdf,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.odp,.txt,.md,.json,.html,.htm,.png,.jpg,.jpeg,.webp,.gif";

/* ----------------------------------------------------------------- page */

export default function Workspace({ clientId }: { clientId?: string }) {
  const q = clientId ? `?client=${clientId}` : "";
  const [data, setData] = useState<Data | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [digesting, setDigesting] = useState(false);
  // Which meetings are past and which are about to start: read with the data, and each minute.
  const [now, setNow] = useState(() => Date.now());

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
      <div className="mx-auto w-full max-w-5xl p-6">
        {error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-slate-500">Loading…</p>}
      </div>
    );
  }

  const { client } = data;
  const upcoming = data.meetings.filter((m) => new Date(m.ends_at ?? m.starts_at).getTime() > now);
  const past = data.meetings.filter((m) => new Date(m.ends_at ?? m.starts_at).getTime() <= now).reverse();
  const ava = data.ava ?? "Ava";
  const routes = [...client.domains.map((d) => `anyone @${d}`), ...client.addresses];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
      <header className="space-y-2 pt-2">
        <h1 className="text-2xl font-semibold">
          Ava for {client.name}
          {client.status !== "active" && (
            <span className="ml-3 align-middle">
              <Chip tone="warn">Paused</Chip>
            </span>
          )}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-500">
          Invite <span className="text-slate-700">{ava}</span> to a Google Meet from your calendar, like a colleague, and she joins it.
          Here you give her what she should know about {client.name}, and prepare her for each meeting.
          {routes.length > 0 && <> Meetings organised by {routes.join(", ")} are yours.</>}
        </p>
      </header>

      {error && (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      <Section title="Meetings" aside={<span className="text-xs text-slate-400">{upcoming.length} coming up</span>}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">
            None coming up. Invite {ava} to a meeting from your calendar — it shows here within a minute.
          </p>
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
                <PastMeeting key={m.id} meeting={m} />
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section
        title="What she knows"
        aside={<span className="text-xs text-slate-400">{data.documents.filter((d) => d.status === "ready").length} documents</span>}
      >
        <p className="mb-4 max-w-3xl text-sm text-slate-500">
          Your documents, pages and files: she reads them now, and in a meeting she looks up what she needs. Kept in NDI&apos;s Google Drive; never shared.
        </p>
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
          onError={setError}
        />
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-slate-700">What Ava knows about {client.name}</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{digesting ? "Reading your documents…" : client.digest_at ? `Updated ${ago(client.digest_at)}` : ""}</span>
              <button className={quiet} onClick={() => void rebuildDigest()} disabled={digesting}>
                {digesting ? "Updating…" : "Update"}
              </button>
            </div>
          </div>
          {client.digest ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{client.digest}</p>
          ) : (
            <p className="text-sm text-slate-500">Nothing yet. Add documents and she writes down what she takes from them.</p>
          )}
        </div>
      </Section>

      <Instructions key={client.id} initial={client.instructions} name={client.name} q={q} onError={setError} />
    </div>
  );
}

/* ------------------------------------------------------------ documents */

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
  const input = useRef<HTMLInputElement>(null);

  /** One at a time, each in its own request: every file gets the server's whole time limit. */
  async function run(jobs: { label: string; send: () => Promise<{ document: Doc }> }[]) {
    if (!jobs.length) return;
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
    try {
      const picked = await pickFromDrive();
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
        <button className={quiet} onClick={() => input.current?.click()}>
          Upload files
        </button>
        {pickerConfigured && (
          <button className={quiet} onClick={() => void fromDrive()}>
            From Google Drive
          </button>
        )}
        <button className={quiet} onClick={() => setLinking((v) => !v)}>
          Add a link
        </button>
      </div>
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
      <p className="text-xs text-slate-400">
        PDF, Word, Excel, PowerPoint, Google Docs, Sheets and Slides, images and text — up to 4 MB here
        {pickerConfigured ? "; bigger files through Google Drive (its Upload tab takes them from your computer)." : "."}
      </p>
      {pending.length > 0 && (
        <ul className="space-y-1">
          {pending.map((label, i) => (
            <li key={`${label}-${i}`} className="flex items-center gap-2 text-sm text-blue-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              Reading {label}…
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND = { upload: "File", drive: "Drive", link: "Link" } as const;

function DocumentList({
  documents,
  q,
  onRemoved,
  onError,
}: {
  documents: Doc[];
  q: string;
  onRemoved: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!documents.length) return null;

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
    <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
      {documents.map((doc) => (
        <li key={doc.id} className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="min-w-0 flex-1 truncate text-left text-sm text-slate-800 hover:text-slate-900"
              onClick={() => setOpen(open === doc.id ? null : doc.id)}
              title={doc.title}
            >
              {doc.title}
            </button>
            <Chip>{KIND[doc.kind]}</Chip>
            {doc.status === "ready" ? (
              <span className="text-xs text-slate-400">{doc.chars.toLocaleString()} characters · {ago(doc.created_at)}</span>
            ) : doc.status === "failed" ? (
              <Chip tone="bad">Could not read</Chip>
            ) : (
              <Chip tone="info">Reading…</Chip>
            )}
            <button className="text-xs text-slate-400 hover:text-rose-700" onClick={() => void remove(doc)} disabled={removing === doc.id}>
              {removing === doc.id ? "Removing…" : "Remove"}
            </button>
          </div>
          {open === doc.id && (
            <div className="mt-2 space-y-2 text-sm text-slate-600">
              {doc.status === "failed" && <p className="text-rose-700">{doc.error}</p>}
              {doc.summary && <p className="whitespace-pre-wrap leading-relaxed">{doc.summary}</p>}
              {doc.source && /^https?:/.test(doc.source) && (
                <a href={doc.source} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-700">
                  Open the original ↗
                </a>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
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
    <li className={`rounded-xl border bg-slate-50 transition ${open ? "border-blue-200 ring-4 ring-blue-500/5" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-4 p-4">
        {/* The day, as on a calendar page. */}
        <div className="flex w-12 shrink-0 flex-col items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-center shadow-sm">
          <span className="w-full bg-blue-600 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
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
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{brief.text}</p>
        </div>
      )}
    </div>
  );
}

function PastMeeting({ meeting }: { meeting: Meeting }) {
  const [open, setOpen] = useState(false);
  const notes = meeting.notes;
  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50">
      <button className="flex w-full flex-wrap items-center gap-3 p-3 text-left" onClick={() => setOpen((v) => !v)} disabled={!notes}>
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{meeting.title}</span>
        <span className="text-xs text-slate-400">{when(meeting.starts_at)}</span>
        {notes ? <Chip tone="good">Notes</Chip> : <Chip>No notes</Chip>}
      </button>
      {open && notes && (
        <div className="space-y-3 border-t border-slate-100 p-4 text-sm text-slate-600">
          {notes.summary && <p className="whitespace-pre-wrap leading-relaxed">{notes.summary}</p>}
          {notes.body && (
            <details>
              <summary className="cursor-pointer text-slate-500 hover:text-slate-600">The email she sent{notes.to ? ` to ${notes.to}` : ""}</summary>
              <p className="mt-2 whitespace-pre-wrap">{notes.body}</p>
            </details>
          )}
        </div>
      )}
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
    <Section title="How she works for you">
      <p className="mb-3 max-w-3xl text-sm text-slate-500">
        In your own words: who {name} is, the tone she should take, what she may and may not say. She reads this before every meeting.
      </p>
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
      </div>
    </Section>
  );
}
