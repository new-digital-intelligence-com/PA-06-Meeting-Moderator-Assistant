import { NextResponse } from "next/server";
import { handle, portalClient } from "@/lib/auth";
import { rebuildDigest } from "@/lib/prepare";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Rewrites "what Ava knows" from the client's documents — after they add or remove some. */
export async function POST(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const digest = await rebuildDigest(clientId);
    return NextResponse.json({ digest, digest_at: new Date() });
  });
}
