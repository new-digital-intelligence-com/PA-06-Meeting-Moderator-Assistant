import { NextResponse } from "next/server";
import { isConfigured as recallConfigured } from "@/lib/recall";
import { readSession } from "@/lib/session";
import { isConfigured as simliConfigured } from "@/lib/simli";
import { storeKind } from "@/lib/store";

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
    simli: simliConfigured(),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    publicUrl,
    // The single most common reason the bot joins and shows a blank tile.
    publicUrlReachable: Boolean(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl),
    botName: process.env.BOT_NAME || "Ava — Moderator",
    store: storeKind(),
  });
}
