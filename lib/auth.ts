/**
 * Who may use the portal, and as whom.
 *
 * Admins are NDI: any verified address on ADMIN_DOMAIN (new-digital-intelligence.com by
 * default). They see every client and the live control room. Clients are the addresses an
 * admin invited (the `members` table): they see only their own company's Ava. Nobody
 * signs up on their own — an address that is neither is turned away at sign-in.
 *
 * The proxy (proxy.ts) only redirects early; every page and route checks again here,
 * because a session decided at sign-in can outlive the membership it was decided from.
 */
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { db, hasDb, isoNow, rows } from "./db";
import { readSession, type PortalUser } from "./session";

export const adminDomain = () => (process.env.ADMIN_DOMAIN || "new-digital-intelligence.com").trim().toLowerCase();

/**
 * Where to go after signing in: a path on this site only, so a sign-in link cannot be made
 * to send people elsewhere. "/\evil.com" counts as elsewhere — browsers read it as "//".
 */
export const safeNext = (next: string | null | undefined) => (next && /^\/(?![\/\\])/.test(next) ? next : "/");

const LOCAL = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

/**
 * This site's address for links in emails: APP_URL, not the request's own Host — which a
 * caller could forge to have a sign-in link point at their server. The request's only
 * when APP_URL is a local address and the request is not (a deployment set up from a
 * copy of .env.local).
 */
export function appOrigin(request: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  const origin = new URL(request.url).origin;
  return configured && !(LOCAL.test(configured) && !LOCAL.test(origin)) ? configured : origin;
}

/** Emailed sign-in links are stored by this hash only, so the table cannot sign anybody in. */
export const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${adminDomain()}`);
}

/** What this address may sign in as — an admin, a client's member, or nobody — without signing it in. */
export async function accessFor(email: string): Promise<PortalUser | null> {
  const e = email.trim().toLowerCase();
  if (isAdminEmail(e)) return { email: e, role: "admin" };
  if (!hasDb()) return null;
  const m = await membership(e);
  return m ? { email: e, name: m.name ?? undefined, role: "client", clientId: m.client_id } : null;
}

/** The client an address signs in for, if that client is active. */
async function membership(email: string): Promise<{ client_id: string; name: string | null } | null> {
  return rows(
    db().from("members").select("client_id, name, clients!inner(status)").eq("email", email).eq("clients.status", "active").maybeSingle(),
  );
}

/** Signs an address in: who it is, and when a client's member was last seen. */
export async function roleFor(email: string, name?: string): Promise<PortalUser | null> {
  const user = await accessFor(email);
  if (!user) return null;
  if (user.role === "client") {
    // Their Google name, the first time there is one.
    await rows(
      db()
        .from("members")
        .update({ last_login_at: isoNow(), ...(name && !user.name ? { name } : {}) })
        .eq("email", user.email),
    );
  }
  return { ...user, name: name ?? user.name };
}

export async function currentUser(): Promise<PortalUser | null> {
  return (await readSession()).user ?? null;
}

/* ---------------------------------------------------------------- pages */

export async function requireUserPage(): Promise<PortalUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdminPage(): Promise<PortalUser> {
  const user = await requireUserPage();
  if (user.role !== "admin") redirect("/client");
  return user;
}

/* --------------------------------------------------------------- routes */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Runs a route body, turning HttpErrors (and anything else) into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}

export async function requireAdmin(): Promise<PortalUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in first.");
  if (user.role !== "admin") throw new HttpError(403, "Admins only.");
  if (!hasDb()) throw new HttpError(503, "Clients are not set up yet (SUPABASE_URL).");
  return user;
}

/**
 * The client a portal request acts on. A member acts on their own company — checked
 * against the members table now, not trusted from the session. An admin names the client
 * with ?client=<id> and may act on any of them.
 */
export async function portalClient(request: Request): Promise<{ user: PortalUser; clientId: string }> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in first.");
  if (!hasDb()) throw new HttpError(503, "Clients are not set up yet (SUPABASE_URL).");
  if (user.role === "admin") {
    const id = new URL(request.url).searchParams.get("client");
    if (!id || !isUuid(id)) throw new HttpError(400, "Which client? Add ?client=<id>.");
    return { user, clientId: id };
  }
  const m = await membership(user.email);
  if (!m) throw new HttpError(403, "This address no longer has access.");
  return { user, clientId: m.client_id };
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** True when the request carries the runner's key (her Chrome on the server). */
export function isRunnerRequest(request: Request): boolean {
  const expected = process.env.AVA_RUNNER_KEY;
  return Boolean(expected) && request.headers.get("x-ava-key") === expected;
}
