import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AVA_EXTRA_SCOPES, buildAuthUrl } from "@/lib/google";

export const runtime = "nodejs";

const cookie = (name: string, value: string) => ({
  name,
  value,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 600,
});

/**
 * Starts a Google sign-in.
 *
 * `?as=ava` connects HER account — the one she reads invites from and sends notes as —
 * rather than yours for the control room. The two must never be confused: saving your
 * account as hers would have her read your calendar and mail people as you.
 */
export async function GET(request: Request) {
  const asAva = new URL(request.url).searchParams.get("as") === "ava";
  const state = crypto.randomBytes(16).toString("hex");
  const hint = asAva ? process.env.AVA_EMAIL || undefined : undefined;

  const response = NextResponse.redirect(buildAuthUrl(state, asAva ? hint ?? "" : undefined, asAva ? AVA_EXTRA_SCOPES : []));
  response.cookies.set(cookie("pa_oauth_state", state));
  response.cookies.set(cookie("pa_oauth_as", asAva ? "ava" : "me"));
  return response;
}
