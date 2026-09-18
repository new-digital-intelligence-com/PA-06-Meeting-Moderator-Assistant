import { NextResponse } from "next/server";
import { isConfigured as recallConfigured } from "@/lib/recall";
import { readSession } from "@/lib/session";
import { isConfigured as anamConfigured } from "@/lib/anam";
import { storeDiagnostics, storeKind } from "@/lib/store";

export const runtime = "nodejs";

/** What is wired up and what is missing — the control room's pre-flight check. */
export async function GET() {
  const session = await readSession();
  const publicUrl = process.env.PUBLIC_URL || process.env.APP_URL || "";
  return NextResponse.json({
    googleConnected: Boolean(session.google),
    email: session.google?.email ?? null,
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    recall: recallConfigured(),
    anam: anamConfigured(),
    publicUrl,
    // The single most common reason the bot joins and shows a blank tile.
    publicUrlReachable: Boolean(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl),
    botName: process.env.BOT_NAME || "Ava — Moderator",
    store: storeKind(),
    // Names only, never values — enough to tell a missing variable from a prefixed one.
    storage: storeDiagnostics(),
    recallRegion: process.env.RECALL_REGION || "us-west-2 (default — unset)",
    sessionSecret: Boolean(process.env.SESSION_SECRET),
    googleClient: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    googleRedirectUri:
      process.env.GOOGLE_REDIRECT_URI ?? `${publicUrl || "http://localhost:3000"}/api/auth/google/callback`,
  });
}
