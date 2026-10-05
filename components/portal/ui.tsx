/** Small pieces shared by the client and admin pages, in the control room's style. */

export const field =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-sky-400/60 focus:outline-none";
export const button =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
export const primary = `${button} bg-sky-500 text-white hover:bg-sky-400`;
export const quiet = `${button} bg-white/5 text-white/75 hover:bg-white/10`;
export const danger = `${button} bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`;

export function Section({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: "good" | "warn" | "bad" | "neutral" | "info"; children: React.ReactNode }) {
  const tones = {
    good: "bg-emerald-500/10 text-emerald-300",
    warn: "bg-amber-500/10 text-amber-300",
    bad: "bg-rose-500/10 text-rose-300",
    info: "bg-sky-500/10 text-sky-300",
    neutral: "bg-white/5 text-white/50",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Notice({ tone, children, onClose }: { tone: "error" | "info"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${
        tone === "error" ? "border-rose-400/30 bg-rose-400/5 text-rose-200" : "border-sky-400/30 bg-sky-400/5 text-sky-200"
      }`}
    >
      <div className="min-w-0 break-words">{children}</div>
      {onClose && (
        <button className="shrink-0 text-white/40 hover:text-white" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

/** "Tue 7 Oct, 14:30" in the viewer's own time zone. */
export function when(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

/** fetch, as JSON, throwing the server's own error message. */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: res.status === 413 ? "That file is too large to upload here. Add it from Google Drive." : text.slice(0, 200) };
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
