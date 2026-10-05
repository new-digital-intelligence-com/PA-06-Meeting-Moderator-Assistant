"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The section list: a sticky sidebar on wide screens, a scrolling strip on phones.
 * Highlights whichever section you are reading.
 */
export default function Nav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  const strip = useRef<HTMLElement>(null);

  // Keep the current section's chip in view on the phone strip — sideways only, so the
  // page itself does not jump.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[href="#${active}"]`);
    if (strip.current && el) {
      strip.current.scrollTo({ left: el.offsetLeft - strip.current.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
    }
  }, [active]);

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      // The band a reader's eye is on: below the sticky strip, above the lower half.
      { rootMargin: "-96px 0px -55% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  const link = (s: { id: string; label: string }, compact: boolean) => {
    const on = s.id === active;
    return (
      <a
        key={s.id}
        href={`#${s.id}`}
        aria-current={on ? "true" : undefined}
        className={
          compact
            ? `shrink-0 rounded-full border px-3 py-1 text-xs ${on ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`
            : `block rounded-lg px-3 py-1.5 text-sm transition-colors ${on ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-700"}`
        }
      >
        {s.label}
      </a>
    );
  };

  return (
    <>
      <nav
        ref={strip}
        aria-label="Sections"
        className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden"
      >
        {sections.map((s) => link(s, true))}
      </nav>
      <nav aria-label="Sections" className="sticky top-8 hidden max-h-[calc(100vh-4rem)] overflow-y-auto lg:block">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">On this page</p>
        {sections.map((s) => link(s, false))}
      </nav>
    </>
  );
}
