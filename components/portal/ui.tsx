/** Small pieces shared by the client and admin pages. */

export const field =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10";
export const button =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
export const primary = `${button} bg-linear-to-b from-blue-500 to-blue-600 text-white shadow-md shadow-blue-600/20 hover:to-blue-700 hover:shadow-lg hover:shadow-blue-600/25`;
export const quiet = `${button} border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900`;
export const danger = `${button} border border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50`;

const ICON_TONES = {
  blue: "bg-blue-50 text-blue-600 ring-blue-600/15",
  violet: "bg-violet-50 text-violet-600 ring-violet-600/15",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-600 ring-amber-600/20",
  sky: "bg-sky-50 text-sky-600 ring-sky-600/15",
  rose: "bg-rose-50 text-rose-600 ring-rose-600/15",
};
export type IconTone = keyof typeof ICON_TONES;

/** A coloured square for an icon, as section headers and lists use them. */
export function IconTile({ tone = "blue", children, className = "size-9" }: { tone?: IconTone; children: React.ReactNode; className?: string }) {
  return <span className={`flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${ICON_TONES[tone]} ${className}`}>{children}</span>;
}

export function Section({
  title,
  aside,
  children,
  id,
  icon,
  tone = "blue",
  description,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  /** An icon (components/portal/icons.tsx) beside the title, on a square of `tone`. */
  icon?: React.ReactNode;
  tone?: IconTone;
  description?: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.14)] sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <IconTile tone={tone}>{icon}</IconTile>}
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm leading-snug text-slate-500">{description}</p>}
          </div>
        </div>
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

/**
 * Only Cloudinary's own addresses, asked for at the size they are shown — twice over, for
 * sharp screens — in the best format the browser takes.
 */
export function cloudinarySized(url: string | null | undefined, px: number): string | null {
  if (!url || !/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)) return null;
  return url.replace("/image/upload/", `/image/upload/c_limit,w_${px},h_${px},f_auto,q_auto/`);
}

const INITIALS_TONES = [
  "bg-blue-50 text-blue-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-800",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
  "bg-sky-50 text-sky-700",
];

/**
 * A client's logo (lib/cloudinary.ts) — or, until they have one, their initials.
 * `decorative` where their name is written right beside it, so it is not read out twice.
 */
export function CompanyLogo({ name, url, size = 40, decorative = false }: { name: string; url?: string | null; size?: number; decorative?: boolean }) {
  const src = cloudinarySized(url, size * 2);
  const box = "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200";
  if (src) {
    return (
      // Cloudinary has already resized it and picked the format: nothing for next/image to add.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={decorative ? "" : `${name} logo`}
        width={size}
        height={size}
        className={`${box} bg-white object-contain p-1`}
        style={{ width: size, height: size }}
      />
    );;
  }
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const tone = INITIALS_TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % INITIALS_TONES.length];
  return (
    <span aria-hidden="true" className={`${box} ${tone} font-semibold`} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials}
    </span>
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
