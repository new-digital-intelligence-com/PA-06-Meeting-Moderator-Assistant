import { NextResponse } from "next/server";
import { roleFor, safeNext, tokenHash } from "@/lib/auth";
import { db, hasDb, isoNow, rows } from "@/lib/db";
import { readSession, sessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Uses an emailed sign-in link. A POST from the button on /login/verify, never the link
 * itself: mail scanners open every link in a message, and a GET would spend the token
 * before its owner ever clicked.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const fail = (reason: string) => {
    const login = new URL("/login", origin);
    login.searchParams.set("error", reason);
    return NextResponse.redirect(login, 303);
  };
  if (!token || !hasDb()) return fail("That sign-in link is not valid.");
  // Only from our own button: another site must not sign a visitor in as somebody else.
  const from = request.headers.get("origin");
  if (from && from !== origin) return fail("That sign-in link is not valid.");

  // Spent in the same statement that checks it, so two clicks cannot both get in.
  const now = isoNow();
  const row = await rows<{ email: string } | null>(
    db()
      .from("login_tokens")
      .update({ used_at: now })
      .eq("hash", tokenHash(token))
      .is("used_at", null)
      .gt("expires_at", now)
      .select("email")
      .maybeSingle(),
  );
  if (!row) return fail("That sign-in link has expired or was already used. Ask for a new one.");

  const user = await roleFor(row.email);
  if (!user) return fail(`${row.email} has no access to Ava any more.`);

  const response = NextResponse.redirect(new URL(next, origin), 303);
  response.cookies.set(sessionCookie({ ...(await readSession()), user }));
  return response;
}
