import Link from "next/link";
import Logo from "./Logo";
import NdiLogo from "./NdiLogo";
import type { PortalUser } from "@/lib/session";

/**
 * The bar across every signed-in page: Ava, by NDI (NDI's own red logo), where you are,
 * who you are, and signing out. Admins get the control room and their clients; a client
 * sees whose Ava this is.
 */
export default function TopBar({ user, active, clientName }: { user: PortalUser; active?: "room" | "clients"; clientName?: string }) {
  const link = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
        on ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/10" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {label}
    </Link>
  );
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link href={user.role === "admin" ? "/" : "/client"} className="flex shrink-0 items-center gap-2.5 transition hover:opacity-90">
            <Logo className="size-8 drop-shadow-sm" />
            <span className="text-base font-semibold tracking-tight text-slate-900">Ava</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 shadow-sm ring-1 ring-inset ring-slate-200">
              <span className="text-[11px] font-medium text-slate-400">by</span>
              <NdiLogo tagline={false} className="h-3 w-auto" />
            </span>
          </Link>
          {user.role === "admin" ? (
            <nav className="flex items-center gap-1 overflow-x-auto">
              {link("/", "Control room", active === "room")}
              {link("/admin", "Clients", active === "clients")}
              {link("/docs", "Docs", false)}
            </nav>
          ) : (
            clientName && <span className="hidden truncate text-sm text-slate-500 sm:inline">for {clientName}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-[14rem] truncate text-xs text-slate-500 md:inline" title={user.email}>
            {user.email}
          </span>
          <span className="flex size-9 items-center justify-center rounded-full bg-linear-to-br from-sky-400 to-blue-600 text-sm font-semibold text-white shadow-sm ring-2 ring-white">
            {initial}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
