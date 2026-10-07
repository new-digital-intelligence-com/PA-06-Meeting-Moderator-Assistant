/**
 * The door. Everything needs a signed-in user or the runner's key, except signing in and
 * the docs. Clients only reach their own portal (/client and /api/portal); the control
 * room, admin and every other route are NDI's.
 *
 * This only redirects early. Pages and routes check again (lib/auth.ts), since a session
 * decided at sign-in can outlive the access it was decided from.
 */
import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/origin";
import { decrypt } from "@/lib/seal";

// Signing in and out. Not /api/auth/google itself: connecting Ava's account is for admins.
const OPEN = [/^\/login(\/|$)/, /^\/docs(\/|$)/, /^\/privacy(\/|$)/, /^\/api\/auth\/(login|email|logout|google\/callback)(\/|$)/];

type User = { role?: "admin" | "client" };

function userFrom(raw: string | undefined): User | null {
  if (!raw) return null;
  const plain = decrypt(raw);
  if (!plain) return null;
  try {
    return (JSON.parse(plain) as { user?: User }).user ?? null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN.some((r) => r.test(pathname))) return NextResponse.next();

  // Her runner: the routes it calls check its key themselves, page by page.
  const key = process.env.AVA_RUNNER_KEY;
  if (key && request.headers.get("x-ava-key") === key) return NextResponse.next();

  const user = userFrom(request.cookies.get("pa_session")?.value);
  const api = pathname.startsWith("/api/");

  if (!user) {
    if (api) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const login = new URL("/login", appOrigin(request));
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  if (user.role !== "admin") {
    if (api && !pathname.startsWith("/api/portal/")) return NextResponse.json({ error: "Not for clients." }, { status: 403 });
    if (!api && !pathname.startsWith("/client")) return NextResponse.redirect(new URL("/client", appOrigin(request)));
  }
  return NextResponse.next();
}

export const config = {
  // Not the framework's own files, nor static images and icons.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif)$).*)"],
};
