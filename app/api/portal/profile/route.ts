import { NextResponse } from "next/server";
import { handle, portalClient } from "@/lib/auth";
import { db, table } from "@/lib/db";

export const runtime = "nodejs";

/** How the client wants her to work for them, in their own words — part of every briefing. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { instructions = "" } = (await request.json().catch(() => ({}))) as { instructions?: string };
    const [client] = await db()<{ instructions: string }[]>`
      update ${table("clients")} set instructions = ${String(instructions).slice(0, 20_000)} where id = ${clientId} returning instructions`;
    return NextResponse.json({ instructions: client?.instructions ?? "" });
  });
}
