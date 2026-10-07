import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/origin";
import { clearedSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/** Signs out — the portal and the control room's Google alike — and goes back to sign-in. */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", appOrigin(request)), 303);
  response.cookies.set(clearedSessionCookie());
  return response;
}
