"use client";

/**
 * A Fireflies recording's transcript, read through the API when it is opened — who said
 * what, and when — on the page itself (/api/portal/meetings/[id]/fireflies?transcript=…,
 * which serves only that meeting's own recording and its last times).
 */

import { useEffect, useState } from "react";
import { api, field } from "./ui";

type Line = { speaker: string; at: number; text: string };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function Transcript({ meetingId, transcriptId, q }: { meetingId: string; transcriptId: string; q: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [find, setFind] = useState("");

  useEffect(() => {
    if (!open || lines || error) return;
    let alive = true;
    api<{ transcript: { lines: Line[] } }>(`/api/portal/meetings/${meetingId}/fireflies${q}${q ? "&" : "?"}transcript=${encodeURIComponent(transcriptId)}`)
      .then((d) => alive && setLines(d.transcript.lines))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not read it."));
    return () => {
      alive = false;
    };
  }, [open, lines, error, meetingId, transcriptId, q]);

  const needle = find.trim().toLowerCase();
  const shown = (lines ?? []).filter((l) => !needle || `${l.speaker} ${l.text}`.toLowerCase().includes(needle));

  return (
    <details className="group rounded-lg border border-slate-200 bg-slate-50/60" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
        <span>Transcript — who said what</span>
        <span className="text-slate-400 transition group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="space-y-2 border-t border-slate-200 p-3">
        {error ? (
          <p className="text-xs text-rose-700">{error}</p>
        ) : !lines ? (
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        ) : !lines.length ? (
          <p className="text-xs text-slate-500">Fireflies has no words for this one.</p>
        ) : (
          <>
            {lines.length > 12 && (
              <input className={`${field} py-1.5 text-xs`} placeholder="Find a word or a name" value={find} onChange={(e) => setFind(e.target.value)} />
            )}
            <ol className="max-h-[32rem] space-y-2.5 overflow-y-auto pr-1">
              {shown.map((l, i) => (
                <li key={i} className="text-sm leading-relaxed">
                  <span className="mr-2 text-[11px] tabular-nums text-slate-400">{mmss(l.at)}</span>
                  <span className="font-semibold text-slate-800">{l.speaker}</span>
                  <span className="text-slate-400"> · </span>
                  <span className="text-slate-700">{l.text}</span>
                </li>
              ))}
              {!shown.length && <li className="text-xs text-slate-500">Nothing matches.</li>}
            </ol>
          </>
        )}
      </div>
    </details>
  );
}
