import { NextResponse } from "next/server";
import { AnamError, createSession, isConfigured } from "@/lib/anam";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Is her face wired up at all? The stage asks before trying to connect. */
export async function GET() {
  return NextResponse.json({
    configured: isConfigured(),
    hasKey: Boolean(process.env.ANAM_API_KEY),
    hasPersona: Boolean(
      process.env.ANAM_PERSONA_ID || (process.env.ANAM_AVATAR_ID && process.env.ANAM_VOICE_ID),
    ),
  });
}

/** Mints a short-lived session token. The API key never leaves this process. */
export async function POST() {
  try {
    return NextResponse.json(await createSession());
  } catch (e) {
    if (e instanceof AnamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start an Anam session" },
      { status: 500 },
    );
  }
}
