import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildLoginUrl } from "@/lib/google";
import { safeNext } from "@/lib/auth";

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
 * Sign in to the portal with Google: who you are, nothing more. The callback is the same
 * one Ava's own account uses (already registered with Google); `pa_oauth_as=login` tells
 * it which of the two this is.
 */
export async function GET(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  const state = crypto.randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildLoginUrl(state));
  response.cookies.set(cookie("pa_oauth_state", state));
  response.cookies.set(cookie("pa_oauth_as", "login"));
  response.cookies.set(cookie("pa_login_next", next));
  return response;
}
