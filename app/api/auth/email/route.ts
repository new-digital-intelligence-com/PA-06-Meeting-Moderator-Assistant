import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { accessFor, appOrigin, safeNext, tokenHash } from "@/lib/auth";
import { avaGoogle } from "@/lib/ava";
import { cleanAddresses, escapeHtml } from "@/lib/clients";
import { count, db, hasDb, isoNow, rows } from "@/lib/db";
import { sendEmail } from "@/lib/workspace";

export const runtime = "nodejs";

const MINUTES = 15;
/** Links one address may have waiting at once: enough for a lost mail, too few to flood an inbox. */
const MAX_WAITING = 3;

/**
 * A sign-in link by email, for clients without Google. Sent from Ava's own account, valid
 * for fifteen minutes, once. Only its hash is stored, so the table cannot sign anybody in.
 *
 * The answer is the same whether or not the address has access — it must not become a
 * way to find out who NDI's clients are.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; next?: string };
  const [email] = cleanAddresses([body.email ?? ""]);
  if (!email) return NextResponse.json({ error: "That is not an email address." }, { status: 400 });

  const google = hasDb() ? await avaGoogle() : null;
  if (!google) {
    return NextResponse.json({ error: "Sign-in by email is not available right now. Use Google." }, { status: 503 });
  }
  const sent = NextResponse.json({ ok: true });

  const user = await accessFor(email);
  if (!user) return sent;

  const tokens = () => db().from("login_tokens");
  await rows(tokens().delete().lt("expires_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString()));
  const waiting = await count(
    tokens().select("hash", { count: "exact", head: true }).eq("email", email).is("used_at", null).gt("expires_at", isoNow()),
  );
  if (waiting >= MAX_WAITING) return sent;

  const token = crypto.randomBytes(32).toString("base64url");
  await rows(
    tokens().insert({ hash: tokenHash(token), email, expires_at: new Date(Date.now() + MINUTES * 60_000).toISOString() }),
  );

  const link = new URL("/login/verify", appOrigin(request));
  link.searchParams.set("token", token);
  if (safeNext(body.next) !== "/") link.searchParams.set("next", safeNext(body.next));

  const text = [
    "Hello,",
    "",
    "Here is your link to sign in to Ava:",
    link.toString(),
    "",
    `It works once, for the next ${MINUTES} minutes. If you did not ask for it, ignore this email.`,
    "",
    "— Ava, New Digital Intelligence",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111827;max-width:560px">
<p>Hello,</p>
<p>Here is your link to sign in to Ava:</p>
<p><a href="${escapeHtml(link.toString())}" style="display:inline-block;background:#002A6C;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Sign in</a></p>
<p style="color:#6B7280">It works once, for the next ${MINUTES} minutes. If you did not ask for it, ignore this email.</p>
<p style="color:#6B7280">— Ava, New Digital Intelligence</p></div>`;

  try {
    await sendEmail(google, email, "Your sign-in link for Ava", text, html);
  } catch (e) {
    console.error("[auth] sign-in email failed", e);
  }
  return sent;
}
