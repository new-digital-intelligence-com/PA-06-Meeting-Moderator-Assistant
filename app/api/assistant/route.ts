import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { assistantStatus, handleAssistant } from "@/lib/assistant/core";
import { buildSnapshot } from "@/lib/assistant/grounding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The assistant sidebar (components/assistant/AssistantPanel.tsx). Read-only: it answers
 * from what the asker may already see, and changes nothing.
 *
 * Open in the proxy, so the public walkthrough can use it too: who may see what is decided
 * here — the workspace needs a signed-in client or admin, checked again now; /preview gets
 * only its fictional example.
 */
export async function GET() {
  return NextResponse.json(assistantStatus(), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  return handleAssistant(request, { user: currentUser, snapshot: buildSnapshot });
}
