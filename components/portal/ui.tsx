/** Small pieces shared by the client and admin pages. */

export const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10";
export const button =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50";
export const primary = `${button} bg-blue-600 text-white shadow-sm hover:bg-blue-700`;
export const quiet = `${button} border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900`;
export const danger = `${button} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`;

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
    <section id={id} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Chip({ tone = "neutral", children }: { tone?: "good" | "warn" | "bad" | "neutral" | "info"; children: React.ReactNode }) {
  const tones = {
    good: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    warn: "bg-amber-50 text-amber-800 ring-amber-600/20",
    bad: "bg-rose-50 text-rose-700 ring-rose-600/20",
    info: "bg-blue-50 text-blue-700 ring-blue-600/20",
    neutral: "bg-slate-50 text-slate-600 ring-slate-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>
  );
}

export function Notice({ tone, children, onClose }: { tone: "error" | "info"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm ${
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-blue-800"
      }`}
    >
      <div className="min-w-0 break-words">{children}</div>
      {onClose && (
        <button className="shrink-0 text-current opacity-50 hover:opacity-100" onClick={onClose} aria-label="Dismiss">
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
