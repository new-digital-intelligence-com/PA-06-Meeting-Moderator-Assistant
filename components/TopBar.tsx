import Link from "next/link";
import Logo from "./Logo";
import type { PortalUser } from "@/lib/session";

/**
 * The bar across every signed-in page: where you are, who you are, and signing out.
 * Admins get the control room and their clients; a client sees whose Ava this is.
 */
export default function TopBar({ user, active, clientName }: { user: PortalUser; active?: "room" | "clients"; clientName?: string }) {
  const link = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        on ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      {label}
    </Link>
  );
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <Link href={user.role === "admin" ? "/" : "/client"} className="flex shrink-0 items-center gap-2.5">
            <Logo className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">Ava</span>
            <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 sm:inline">by NDI</span>
          </Link>
          {user.role === "admin" ? (
            <nav className="flex items-center gap-1 overflow-x-auto">
              {link("/", "Control room", active === "room")}
              {link("/admin", "Clients", active === "clients")}
              {link("/docs", "Docs", false)}
            </nav>
          ) : (
            clientName && <span className="truncate text-sm text-slate-500">for {clientName}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden max-w-[14rem] truncate text-xs text-slate-500 md:inline" title={user.email}>
            {user.email}
          </span>
          <span className="flex size-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/10">
            {initial}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
