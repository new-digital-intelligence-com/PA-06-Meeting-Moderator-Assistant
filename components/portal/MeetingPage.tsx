"use client";

/**
 * One meeting on its own page, opened from a client's Meetings list (/client/meetings/[id],
 * or under /admin/clients/[id] for NDI).
 *
 *   coming up   her preparation — who is coming (their Who's who lines), what it is for,
 *               the agenda, what to avoid, documents for it only — and the brief she will
 *               walk in with; beside it, what Fireflies has from before (Last time), the
 *               client's earlier meetings, and its history. Locked from a minute before.
 *   over        her notes and Fireflies', what she had, and its history.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { prepLocksAt } from "@/lib/prepLock";
import type { PickerConfig } from "./drivePicker";
import { BookIcon, ClockIcon, HistoryIcon, LockIcon, SparkIcon } from "./icons";
import Markdown from "./Markdown";
import MeetingRecord from "./MeetingRecord";
import { Notice, Section, api } from "./ui";
import { EarlierMeetings, PickerContext, PrepPanel, briefState, peopleOf, type Meeting } from "./Workspace";

type Loaded = { meeting: Omit<Meeting, "documents">; documents: { id: string }[] };

/** One earlier meeting as Fireflies has it (/api/portal/meetings/[id]/fireflies). */
type Earlier = { id: string; title: string; date: string; minutes: number | null; url: string | null; overview: string; actions: string; people: string[] };
type FromFireflies = { configured: boolean; series: Earlier[]; withPeople: Earlier[]; error?: string };

const PLATFORMS: [RegExp, string][] = [
  [/meet\.google\.com/i, "Google Meet"],
  [/teams\.(microsoft|live)\.com|teams\.cloud\.microsoft/i, "Microsoft Teams"],
  [/zoom\.us/i, "Zoom"],
];
const platformName = (url: string | null) => (url ? PLATFORMS.find(([re]) => re.test(url))?.[1] ?? "Online meeting" : null);

const day = (d: Date) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const initials = (s: string) =>
  s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

export default function MeetingPage({ meetingId, clientId, picker = null }: { meetingId: string; clientId?: string; picker?: PickerConfig | null }) {
  const q = clientId ? `?client=${clientId}` : "";
  const back = clientId ? `/admin/clients/${clientId}` : "/client";
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // A document handed to this meeting from Earlier meetings: the preparation's list re-reads.
  const [docsVersion, setDocsVersion] = useState(0);
  // Whether it is about to start, or over: read with the data, and every half minute.
  const [now, setNow] = useState(() => Date.now());
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    api<Loaded>(`/api/portal/meetings/${meetingId}${q}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setNow(Date.now());
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load the meeting."));
    return () => {
      alive = false;
    };
  }, [meetingId, q, version]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
        <Link href={back} className="text-sm font-medium text-slate-500 hover:text-slate-900">
          ← All meetings
        </Link>
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <div className="space-y-5" aria-label="Loading">
            <div className="h-48 animate-pulse rounded-3xl bg-linear-to-br from-blue-200/70 to-indigo-200/60" />
            <div className="h-96 animate-pulse rounded-2xl bg-slate-200/50" />
          </div>
        )}
      </div>
    );
  }

  const meeting: Meeting = { ...data.meeting, documents: data.documents.length };
  const start = new Date(meeting.starts_at);
  const end = meeting.ends_at ? new Date(meeting.ends_at) : null;
  const cancelled = meeting.status === "cancelled";
  const declined = meeting.status === "declined";
  const over = meeting.status === "ended" || Boolean(meeting.ended_at) || (end ?? start).getTime() <= now;
  const past = over || cancelled || declined;
  const locked = now >= prepLocksAt(meeting.starts_at);
  const started = now >= start.getTime();
  const state = briefState(meeting);
  const people = peopleOf(meeting);
  const platform = platformName(meeting.meeting_url);
  const status = cancelled
    ? "Called off"
    : declined
      ? "Declined — she was booked then"
      : over
        ? "Over"
        : started
          ? "Happening now"
          : locked
            ? "Starting now"
            : state.label;

  return (
    <PickerContext.Provider value={picker}>
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 pb-24 sm:p-6">
        <Link
          href={past ? `${back}?when=past` : back}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          <span aria-hidden="true">←</span> All meetings
        </Link>

        <header className="relative overflow-hidden rounded-3xl bg-linear-to-br from-blue-600 via-blue-600 to-indigo-700 p-6 text-white shadow-xl shadow-blue-900/15 sm:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-sky-300/25 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 left-1/4 size-80 rounded-full bg-indigo-400/30 blur-3xl" />
          <div className="relative flex flex-wrap items-start gap-5">
            {/* The day, as on a calendar page. */}
            <div className="flex w-16 shrink-0 flex-col items-center overflow-hidden rounded-2xl bg-white text-center shadow-lg shadow-blue-950/20">
              <span className="w-full bg-linear-to-b from-blue-500 to-blue-600 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
                {start.toLocaleDateString([], { month: "short" })}
              </span>
              <span className="py-1.5 text-2xl font-semibold leading-none text-slate-900">{start.getDate()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                  cancelled || declined ? "bg-rose-500/20 text-rose-50 ring-rose-200/30" : "bg-white/15 text-white ring-white/20"
                }`}
              >
                {(started || locked) && !over && <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" />}
                {status}
              </span>
              <h1 className={`mt-2 text-2xl font-semibold tracking-tight sm:text-3xl ${cancelled ? "line-through decoration-white/40" : ""}`}>{meeting.title}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-blue-100">
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon className="size-4" />
                  {day(start)}, {time(start)}
                  {end ? `–${time(end)}` : ""}
                </span>
                {platform && <span>{platform}</span>}
                {meeting.organizer && <span>Organised by {meeting.organizer_name || meeting.organizer}</span>}
              </p>
            </div>
            {meeting.meeting_url && !past && (
              <a
                href={meeting.meeting_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 shadow-lg shadow-blue-950/20 transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                Open the meeting <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
          {people.length > 0 && (
            <ul className="relative mt-6 flex flex-wrap gap-2" aria-label="Invited">
              {people.map((p) => (
                <li key={p.email} title={p.email} className="inline-flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 text-xs ring-1 ring-inset ring-white/15">
                  <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-white/90 text-[10px] font-semibold text-blue-700">
                    {initials(p.name || p.email)}
                  </span>
                  {p.name || p.email}
                </li>
              ))}
            </ul>
          )}
        </header>

        {error && (
          <Notice tone="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}

        {past ? (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              <Section
                title={cancelled || declined ? "What happened" : "Notes"}
                icon={<BookIcon />}
                tone="violet"
                description={
                  cancelled || declined
                    ? "Why she did not go, and what had been prepared."
                    : "What she wrote up, Fireflies' notes when it was there, and what she was given beforehand."
                }
              >
                <MeetingRecord bare meetingId={meeting.id} q={q} views={cancelled || declined ? ["history", "prep"] : ["notes", "prep"]} />
              </Section>
            </div>
            {!cancelled && !declined && (
              <aside className="min-w-0">
                <Section title="History" icon={<HistoryIcon />} tone="sky" description="What happened to it, and who did it.">
                  <MeetingRecord bare meetingId={meeting.id} q={q} views={["history"]} />
                </Section>
              </aside>
            )}
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0">
              {locked ? (
                <Section
                  title="What she walks in with"
                  icon={<LockIcon />}
                  tone="amber"
                  description="Locked from a minute before the meeting: this is what she walks in with. It stays with the meeting once it is over."
                >
                  <MeetingRecord bare meetingId={meeting.id} q={q} views={["prep"]} />
                </Section>
              ) : (
                <Section
                  title="Prepare her"
                  icon={<SparkIcon />}
                  description="Who is coming and what to know about each, what it is for, the agenda, what to avoid, documents for this meeting only. Saving writes her brief — what she will walk in with."
                >
                  <PrepPanel key={version} meeting={meeting} now={now} q={q} onSaved={reload} onError={setError} docsVersion={docsVersion} />
                </Section>
              )}
            </div>
            <aside className="min-w-0 space-y-5">
              <LastTime meetingId={meeting.id} q={q} />
              {!locked && <EarlierMeetings meeting={meeting} q={q} onAdded={() => setDocsVersion((v) => v + 1)} onError={setError} />}
              <Section title="History" icon={<HistoryIcon />} tone="sky" description="What happened to it so far, and who did it.">
                <MeetingRecord bare meetingId={meeting.id} q={q} views={["history"]} />
              </Section>
            </aside>
          </div>
        )}
      </div>
    </PickerContext.Provider>
  );
}

/**
 * Last time, from Fireflies: the same meeting before and recent meetings with the same
 * people — what her brief's "Last time" is written from, as Fireflies wrote it up.
 */
function LastTime({ meetingId, q }: { meetingId: string; q: string }) {
  const [data, setData] = useState<FromFireflies | null>(null);

  useEffect(() => {
    let alive = true;
    api<FromFireflies>(`/api/portal/meetings/${meetingId}/fireflies${q}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setData({ configured: true, series: [], withPeople: [], error: e instanceof Error ? e.message : "Fireflies did not answer." }));
    return () => {
      alive = false;
    };
  }, [meetingId, q]);

  if (data && !data.configured) return null;
  return (
    <Section
      title="Last time"
      icon={<HistoryIcon />}
      tone="amber"
      description="From Fireflies: the same meeting before, and recent meetings with the same people. Her brief is written from it, prepared or not."
    >
      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : data.error ? (
        <p className="text-sm text-rose-700">Fireflies did not answer: {data.error}</p>
      ) : !data.series.length && !data.withPeople.length ? (
        <p className="text-sm text-slate-500">Fireflies has nothing from before: no earlier meeting of this one, and none with these people this past month.</p>
      ) : (
        <div className="space-y-4">
          {data.series.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">The same meeting before</h4>
              <ul className="space-y-2">
                {data.series.map((e, i) => (
                  <EarlierItem key={e.id} item={e} open={i === 0} />
                ))}
              </ul>
            </div>
          )}
          {data.withPeople.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">With the same people</h4>
              <ul className="space-y-2">
                {data.withPeople.map((e) => (
                  <EarlierItem key={e.id} item={e} open={false} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function EarlierItem({ item, open }: { item: Earlier; open: boolean }) {
  const date = new Date(item.date);
  return (
    <li>
      <details open={open} className="group rounded-xl border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-slate-800">{item.title}</span>
            <span className="text-xs text-slate-500">
              {date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, {time(date)}
              {item.minutes ? ` · ${item.minutes} min` : ""}
            </span>
          </span>
          <span className="text-xs text-slate-400 transition group-open:rotate-180" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          {item.overview && (
            <div className="text-sm">
              <Markdown>{item.overview}</Markdown>
            </div>
          )}
          {item.actions && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Action items</p>
              <div className="text-sm">
                <Markdown>{item.actions}</Markdown>
              </div>
            </div>
          )}
          {item.people.length > 0 && <p className="text-xs text-slate-500">{item.people.join(", ")}</p>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-orange-700 underline-offset-2 hover:underline">
              Full transcript in Fireflies ↗
            </a>
          )}
        </div>
      </details>
    </li>
  );
}
