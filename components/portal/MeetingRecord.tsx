"use client";

/**
 * Everything kept about one meeting, read from /api/portal/meetings/[id] when opened:
 *
 *   Notes        what she wrote up — the summary, the actions, and the email as it went out
 *   Preparation  what she was given — goal, agenda, people, what to avoid, notes — her
 *                brief, and the documents for that meeting
 *   History      what happened to it and who did it: the host's changes on the calendar,
 *                each version of the preparation, documents, her brief, her coming and
 *                going, the notes (lib/history.ts)
 */

import { useEffect, useState } from "react";
import Markdown from "./Markdown";
import { api, ago } from "./ui";

type Prep = { goal?: string; agenda?: string; people?: string; avoid?: string; notes?: string };
type Notes = { to?: string; subject?: string; body?: string; summary?: string; sentAt?: number; actions?: { text: string; owner?: string; due?: string }[] } | null;
type Kept = {
  meeting: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    organizer: string | null;
    organizer_name: string | null;
    meeting_url: string | null;
    status: string;
    prep: Prep;
    prep_at: string | null;
    brief: string | null;
    brief_at: string | null;
    notes: Notes;
    ended_at: string | null;
  };
  documents: { id: string; title: string; kind: string; status: string }[];
  history: HistoryItem[];
};
export type HistoryItem = { id: number; at: string; kind: string; by: string | null; detail: { [k: string]: unknown } };

export type View = "notes" | "prep" | "history";

const VIEW_LABEL: { [v in View]: string } = { notes: "Notes", prep: "Preparation", history: "History" };
const PREP_LABEL: { [k in keyof Prep]-?: string } = {
  goal: "What it is for",
  agenda: "Agenda",
  people: "Who is coming",
  avoid: "What to avoid",
  notes: "Anything else",
};

const stamp = (iso: string | number | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export default function MeetingRecord({ meetingId, q, views, start }: { meetingId: string; q: string; views: View[]; start?: View }) {
  const [data, setData] = useState<Kept | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(start ?? views[0]);

  useEffect(() => {
    let alive = true;
    api<Kept>(`/api/portal/meetings/${meetingId}${q}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load it."));
    return () => {
      alive = false;
    };
  }, [meetingId, q]);

  if (error) return <p className="p-4 text-sm text-rose-700">{error}</p>;
  if (!data) return <div className="m-4 h-24 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4 border-t border-slate-200/70 p-4">
      {views.length > 1 && (
        <div role="tablist" className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          {views.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 transition ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              {VIEW_LABEL[v]}
              {v === "history" && data.history.length > 0 && <span className="ml-1.5 text-slate-400">{data.history.length}</span>}
            </button>
          ))}
        </div>
      )}
      {view === "notes" && <NotesView record={data} />}
      {view === "prep" && <PrepView record={data} />}
      {view === "history" && <History items={data.history} />}
    </div>
  );
}

function NotesView({ record }: { record: Kept }) {
  const notes = record.meeting.notes;
  if (!notes?.summary && !notes?.body) {
    return (
      <p className="text-sm text-slate-500">
        {record.meeting.status === "cancelled"
          ? "It was called off — no notes."
          : record.meeting.status === "declined"
            ? "She declined it — she was already booked for another meeting at that time — so there are no notes."
            : "No notes for this meeting: nothing was written up — usually because nothing was said while she was there."}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {notes.sentAt ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
            Emailed {stamp(notes.sentAt)}
            {notes.to ? ` to ${notes.to}` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">Filed here — not emailed</span>
        )}
      </div>
      {notes.summary && (
        <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-slate-200">
          <Markdown>{notes.summary}</Markdown>
        </div>
      )}
      {notes.actions && notes.actions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Actions</p>
          <ul className="space-y-1.5">
            {notes.actions.map((a, i) => (
              <li key={i} className="rounded-lg bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                {a.text}
                {(a.owner || a.due) && (
                  <span className="text-xs text-slate-500">
                    {" "}
                    — {a.owner}
                    {a.owner && a.due ? ", " : ""}
                    {a.due}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.body && (
        <details className="rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">
            The email{notes.sentAt ? " as it was sent" : ""}
            {notes.subject ? ` — “${notes.subject}”` : ""}
          </summary>
          <pre className="whitespace-pre-wrap break-words border-t border-slate-200 px-4 py-3 font-sans text-sm leading-relaxed text-slate-700">{notes.body}</pre>
        </details>
      )}
    </div>
  );
}

function PrepView({ record }: { record: Kept }) {
  const { meeting, documents } = record;
  const filled = (Object.keys(PREP_LABEL) as (keyof Prep)[]).filter((k) => meeting.prep?.[k]?.trim());
  if (!filled.length && !meeting.brief && !documents.length) {
    return <p className="text-sm text-slate-500">Nobody prepared her for this one: she went in with the invite and what she knows about you.</p>;
  }
  return (
    <div className="space-y-4">
      {filled.length > 0 && (
        <dl className="grid gap-3 sm:grid-cols-2">
          {filled.map((k) => (
            <div key={k} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200">
              <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{PREP_LABEL[k]}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{meeting.prep[k]}</dd>
            </div>
          ))}
        </dl>
      )}
      {meeting.prep_at && <p className="text-xs text-slate-400">Last saved {ago(meeting.prep_at)}.</p>}
      {documents.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Documents for this meeting</p>
          <ul className="flex flex-wrap gap-2">
            {documents.map((d) => (
              <li key={d.id} className="rounded-lg bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                {d.title}
                {d.status !== "ready" && <span className="text-rose-600"> · not read</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {meeting.brief && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="mb-2 text-sm font-semibold text-emerald-800">
            What she walked in with <span className="font-normal text-slate-400">{meeting.brief_at ? `· written ${ago(meeting.brief_at)}` : ""}</span>
          </p>
          <Markdown>{meeting.brief}</Markdown>
        </div>
      )}
    </div>
  );
}

/** Who did it, said for people: Ava, the host, or an address. */
function who(by: string | null): string {
  if (!by) return "";
  if (by === "Ava" || by === "her runner") return "Ava";
  return by;
}

const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(", ") : "");

/** One line of the history, in words. */
function describe(item: HistoryItem): { text: string; more?: React.ReactNode; tone: string } {
  const d = item.detail;
  const by = who(item.by);
  const from = d.from as { starts_at?: string } | string | null | undefined;
  const to = d.to as { starts_at?: string } | string | null | undefined;
  switch (item.kind) {
    case "invited":
      return { text: `On her calendar — invited${by ? ` by ${by}` : ""}${d.starts_at ? `, for ${stamp(d.starts_at as string)}` : ""}`, tone: "bg-blue-500" };
    case "moved":
      return {
        text: `Moved from ${stamp((from as { starts_at?: string })?.starts_at)} to ${stamp((to as { starts_at?: string })?.starts_at)}${by ? ` by ${by}` : ""}`,
        tone: "bg-amber-500",
      };
    case "renamed":
      return { text: `Renamed from “${String(from ?? "")}” to “${String(to ?? "")}”${by ? ` by ${by}` : ""}`, tone: "bg-amber-500" };
    case "described":
      return {
        text: `Description changed${by ? ` by ${by}` : ""}`,
        tone: "bg-amber-500",
        more: (
          <div className="grid gap-2 sm:grid-cols-2">
            <pre className="whitespace-pre-wrap rounded-lg bg-rose-50 p-2 font-sans text-xs text-rose-900">{String(from || "(empty)")}</pre>
            <pre className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-2 font-sans text-xs text-emerald-900">{String(to || "(empty)")}</pre>
          </div>
        ),
      };
    case "guests": {
      const added = list(d.added);
      const removed = list(d.removed);
      return { text: `Guests changed${by ? ` by ${by}` : ""}: ${[added && `added ${added}`, removed && `removed ${removed}`].filter(Boolean).join("; ")}`, tone: "bg-amber-500" };
    }
    case "link":
      return { text: `Meeting link changed${by ? ` by ${by}` : ""}`, tone: "bg-amber-500" };
    case "cancelled":
      return { text: `Called off — gone from her calendar (deleted by the host${by ? `, ${by}` : ""}, or she was taken off the invite)`, tone: "bg-rose-500" };
    case "restored":
      return { text: `Back on her calendar${by ? ` — ${by}` : ""}`, tone: "bg-blue-500" };
    case "prepared": {
      const changed = Array.isArray(d.changed) ? (d.changed as (keyof Prep)[]).map((k) => PREP_LABEL[k]?.toLowerCase() ?? k).join(", ") : "";
      const prep = (d.prep ?? {}) as Prep;
      const shown = (Object.keys(PREP_LABEL) as (keyof Prep)[]).filter((k) => prep[k]?.trim());
      return {
        text: `Preparation saved${by ? ` by ${by}` : ""}${changed ? ` — ${changed}` : ""}`,
        tone: "bg-violet-500",
        more: shown.length ? (
          <dl className="space-y-1.5">
            {shown.map((k) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{PREP_LABEL[k]}</dt>
                <dd className="whitespace-pre-wrap text-xs text-slate-700">{prep[k]}</dd>
              </div>
            ))}
          </dl>
        ) : undefined,
      };
    }
    case "brief":
      return { text: "Her brief written", tone: "bg-emerald-500" };
    case "document_added":
      return { text: `${by || "Someone"} added “${String(d.title ?? "")}”${d.read === false ? " — it could not be read" : ""}`, tone: "bg-violet-500" };
    case "document_removed":
      return { text: `${by || "Someone"} removed “${String(d.title ?? "")}”`, tone: "bg-violet-500" };
    case "sent_now":
      return { text: `Sent now by ${by || "someone"} — “Need Ava now?”`, tone: "bg-blue-500" };
    case "joined":
      return { text: d.from === "dispatch" ? "Ava joined — sent from your page" : "Ava joined — from her calendar", tone: "bg-emerald-500" };
    case "ended":
      return {
        text: by === "Ava" || !by ? `Ava left${d.reason ? ` — ${String(d.reason)}` : ""}` : `Ended from the site by ${by}`,
        tone: "bg-slate-500",
      };
    case "notes":
      return {
        text: d.sent ? `Notes emailed${d.to ? ` to ${String(d.to)}` : ""}` : "Notes written",
        tone: "bg-emerald-500",
      };
    case "accepted":
      return { text: d.series ? "Ava accepted the invite — the whole series" : "Ava accepted the invite", tone: "bg-emerald-500" };
    case "declined":
      return {
        text: `Ava declined${d.series ? " the series" : " the invite"} — already booked for another meeting at that time`,
        tone: "bg-rose-500",
        more: d.note ? <p className="text-xs leading-relaxed text-slate-600">What the host read: “{String(d.note)}”</p> : undefined,
      };
    default:
      return { text: item.kind, tone: "bg-slate-400" };
  }
}

export function History({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <p className="text-sm text-slate-500">Nothing yet.</p>;
  const recalled = items.some((i) => i.detail.recalled);
  return (
    <div className="space-y-3">
      <ol className="relative space-y-3 border-l-2 border-slate-200 pl-5">
        {items.map((item) => {
          const line = describe(item);
          return (
            <li key={item.id} className="relative">
              <span className={`absolute -left-[27px] top-1.5 size-3 rounded-full ring-4 ring-white ${line.tone}`} />
              <p className="text-sm text-slate-700">{line.text}</p>
              <p className="text-xs text-slate-400">{stamp(item.at)}</p>
              {line.more && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-700">Show</summary>
                  <div className="mt-2">{line.more}</div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {recalled && <p className="text-xs text-slate-400">From before every change was kept: only what the meeting itself still says.</p>}
    </div>
  );
}
