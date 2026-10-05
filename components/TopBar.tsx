import Link from "next/link";
import type { PortalUser } from "@/lib/session";

/**
 * The bar across every signed-in page: where you are, and signing out. Admins get the
 * control room and their clients; a client sees whose Ava this is.
 */
export default function TopBar({ user, active, clientName }: { user: PortalUser; active?: "room" | "clients"; clientName?: string }) {
  const link = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm transition ${on ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="border-b border-white/10 bg-black/20">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-semibold tracking-wide">
            Ava <span className="font-normal text-white/35">by NDI</span>
          </span>
          {user.role === "admin" ? (
            <nav className="flex flex-wrap items-center gap-1">
              {link("/", "Control room", active === "room")}
              {link("/admin", "Clients", active === "clients")}
              {link("/docs", "Docs", false)}
            </nav>
          ) : (
            clientName && <span className="truncate text-sm text-white/50">for {clientName}</span>
          )}
        </div>
        <form action="/api/auth/logout" method="post" className="flex items-center gap-3">
          <span className="hidden max-w-[16rem] truncate text-xs text-white/40 sm:inline">{user.email}</span>
          <button className="rounded-lg px-3 py-1.5 text-sm text-white/50 hover:bg-white/5 hover:text-white">Sign out</button>
        </form>
      </div>
    </div>
  );
}
