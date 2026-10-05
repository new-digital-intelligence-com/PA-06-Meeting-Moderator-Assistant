import { NextResponse } from "next/server";
import { clearedSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/** Signs out — the portal and the control room's Google alike — and goes back to sign-in. */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(clearedSessionCookie());
  return response;
}
