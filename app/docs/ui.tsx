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
    chip: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    card: "border-sky-400/20 bg-sky-400/[0.04]",
    dot: "bg-sky-400",
    text: "text-sky-300",
  },
  emerald: {
    chip: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    card: "border-emerald-400/20 bg-emerald-400/[0.04]",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
  amber: {
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    card: "border-amber-400/20 bg-amber-400/[0.04]",
    dot: "bg-amber-400",
    text: "text-amber-300",
  },
  violet: {
    chip: "border-violet-400/30 bg-violet-400/10 text-violet-200",
    card: "border-violet-400/20 bg-violet-400/[0.04]",
    dot: "bg-violet-400",
    text: "text-violet-300",
  },
  rose: {
    chip: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    card: "border-rose-400/20 bg-rose-400/[0.04]",
    dot: "bg-rose-400",
    text: "text-rose-300",
  },
  slate: {
    chip: "border-white/15 bg-white/[0.04] text-white/70",
    card: "border-white/10 bg-white/[0.02]",
    dot: "bg-white/40",
    text: "text-white/70",
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
    <section id={id} className="scroll-mt-24 border-t border-white/5 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">{title}</h2>
      {intro ? <p className="mt-3 max-w-3xl text-[15px] leading-7 text-white/60">{intro}</p> : null}
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
      {title ? <h3 className="mt-1 text-base font-semibold text-white">{title}</h3> : null}
      {children ? <div className="mt-2 text-sm leading-6 text-white/60">{children}</div> : null}
    </div>
  );
}

export function Callout({ tone = "sky", title, children }: { tone?: Tone; title: ReactNode; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 text-sm leading-6 ${TONES[tone].card}`}>
      <p className={`font-semibold ${TONES[tone].text}`}>{title}</p>
      <div className="mt-1 text-white/65">{children}</div>
    </div>
  );
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="box-decoration-clone rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[0.85em] text-white/80">
      {children}
    </code>
  );
}

export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
      {title ? (
        <p className="border-b border-white/10 px-4 py-2 font-mono text-xs text-white/40">{title}</p>
      ) : null}
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6 text-white/80">{children}</pre>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      {/* Two columns fit a phone; wider tables scroll sideways inside their frame. */}
      <table className={`w-full text-left text-sm ${head.length > 2 ? "min-w-[560px]" : ""}`}>
        <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.12em] text-white/40">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-3 leading-6 ${j === 0 ? "text-white/85" : "text-white/60"}`}>
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
    <ol className="relative space-y-6 border-l border-white/10 pl-7">
      {items.map((item, i) => (
        <li key={i} className="relative">
          <span
            className={`absolute -left-[41px] flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${TONES[item.tone ?? "slate"].chip}`}
          >
            {i + 1}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white">{item.title}</h3>
            {item.tag}
          </div>
          <div className="mt-1 max-w-3xl text-sm leading-6 text-white/60">{item.body}</div>
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
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-sm font-medium text-white/85">{ask}</p>
          {note ? <p className="mt-1 text-xs leading-5 text-white/45">{note}</p> : null}
        </div>
        <span className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-white/35 md:block">yes →</span>
        <div className={`rounded-xl border px-4 py-3 text-sm ${TONES[tone].card}`}>
          <span className="mr-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/35 md:hidden">yes:</span>
          <span className={TONES[tone].text}>{yes}</span>
        </div>
      </div>
      {last ? null : (
        <p className="py-1.5 pl-4 font-mono text-xs text-white/30">
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
        <code className="break-all font-mono text-[13px] text-sky-200/90">{path}</code>
        {tag}
      </div>
      <div className="text-sm leading-6 text-white/60">{children}</div>
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-lg font-semibold text-white">{value}</p>
      <p className="text-xs leading-5 text-white/45">{label}</p>
    </div>
  );
}
