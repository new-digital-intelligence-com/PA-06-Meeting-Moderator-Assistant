/**
 * The building blocks of the docs page. Plain server components — the page ships no
 * JavaScript except the section nav.
 *
 * Tailwind only generates classes it can see written out in full, so every colour is
 * spelled out in `TONES` rather than assembled from pieces.
 */

import type { ReactNode } from "react";

export type Tone = "sky" | "emerald" | "amber" | "violet" | "rose" | "slate";

const TONES: Record<Tone, { chip: string; card: string; dot: string; text: string }> = {
  sky: {
    chip: "border-blue-200 bg-blue-50 text-blue-700",
    card: "border-blue-100 bg-blue-50/60",
    dot: "bg-blue-500",
    text: "text-blue-700",
  },
  emerald: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    card: "border-emerald-100 bg-emerald-50/60",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
  },
  amber: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    card: "border-amber-100 bg-amber-50/60",
    dot: "bg-amber-500",
    text: "text-amber-800",
  },
  violet: {
    chip: "border-violet-200 bg-violet-50 text-violet-700",
    card: "border-violet-100 bg-violet-50/60",
    dot: "bg-violet-500",
    text: "text-violet-700",
  },
  rose: {
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    card: "border-rose-100 bg-rose-50/60",
    dot: "bg-rose-500",
    text: "text-rose-700",
  },
  slate: {
    chip: "border-slate-200 bg-white text-slate-600",
    card: "border-slate-200 bg-white shadow-sm",
    dot: "bg-slate-400",
    text: "text-slate-600",
  },
};

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-slate-200 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
      {intro ? <p className="mt-3 max-w-3xl text-[15px] leading-7 text-slate-600">{intro}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Chip({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone].chip}`}>
      {children}
    </span>
  );
}

export function Dot({ tone = "slate" }: { tone?: Tone }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${TONES[tone].dot}`} />;
}

export function Card({
  tone = "slate",
  title,
  kicker,
  children,
  className = "",
}: {
  tone?: Tone;
  title?: ReactNode;
  kicker?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border p-5 ${TONES[tone].card} ${className}`}>
      {kicker ? <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${TONES[tone].text}`}>{kicker}</p> : null}
      {title ? <h3 className="mt-1 text-base font-semibold text-slate-900">{title}</h3> : null}
      {children ? <div className="mt-2 text-sm leading-6 text-slate-600">{children}</div> : null}
    </div>
  );
}

export function Callout({ tone = "sky", title, children }: { tone?: Tone; title: ReactNode; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 text-sm leading-6 ${TONES[tone].card}`}>
      <p className={`font-semibold ${TONES[tone].text}`}>{title}</p>
      <div className="mt-1 text-slate-700">{children}</div>
    </div>
  );
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="box-decoration-clone rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800">
      {children}
    </code>
  );
}

/** A block of commands — dark, as a terminal is. */
export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
      {title ? (
        <p className="border-b border-slate-800 px-4 py-2 font-mono text-xs text-slate-400">{title}</p>
      ) : null}
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6 text-slate-100">{children}</pre>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Two columns fit a phone; wider tables scroll sideways inside their frame. */}
      <table className={`w-full text-left text-sm ${head.length > 2 ? "min-w-[560px]" : ""}`}>
        <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-3 leading-6 ${j === 0 ? "font-medium text-slate-800" : "text-slate-600"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A numbered timeline. */
export function Steps({ items }: { items: { title: ReactNode; body: ReactNode; tag?: ReactNode; tone?: Tone }[] }) {
  return (
    <ol className="relative space-y-6 border-l border-slate-200 pl-7">
      {items.map((item, i) => (
        <li key={i} className="relative">
          <span
            className={`absolute -left-[41px] flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${TONES[item.tone ?? "slate"].chip}`}
          >
            {i + 1}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{item.title}</h3>
            {item.tag}
          </div>
          <div className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{item.body}</div>
        </li>
      ))}
    </ol>
  );
}

/** One question in a decision flow: if yes, the outcome on the right; if no, carry on down. */
export function Decision({
  ask,
  yes,
  tone = "sky",
  note,
  last = false,
}: {
  ask: ReactNode;
  yes: ReactNode;
  tone?: Tone;
  note?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_minmax(0,0.9fr)] md:items-center">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-sm font-medium text-slate-800">{ask}</p>
          {note ? <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p> : null}
        </div>
        <span className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 md:block">yes →</span>
        <div className={`rounded-xl border px-4 py-3 text-sm ${TONES[tone].card}`}>
          <span className="mr-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 md:hidden">yes:</span>
          <span className={TONES[tone].text}>{yes}</span>
        </div>
      </div>
      {last ? null : (
        <p className="py-1.5 pl-4 font-mono text-xs text-slate-400">
          │ no<br />↓
        </p>
      )}
    </div>
  );
}

/** A file and what it is for. */
export function FileRow({ path, tag, children }: { path: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 md:grid-cols-[minmax(0,240px)_1fr] md:gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all font-mono text-[13px] text-blue-700">{path}</code>
        {tag}
      </div>
      <div className="text-sm leading-6 text-slate-600">{children}</div>
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-lg font-semibold text-slate-900">{value}</p>
      <p className="text-xs leading-5 text-slate-500">{label}</p>
    </div>
  );
}
