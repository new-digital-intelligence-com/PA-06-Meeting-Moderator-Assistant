import { NextResponse } from "next/server";
import { avaGoogle } from "@/lib/ava";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db, rows } from "@/lib/db";
import { listDocuments } from "@/lib/knowledge";
import { clientMeetings, syncIfStale } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Everything a client's page shows: their Ava's instructions and digest, documents, meetings. */
export async function GET(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const google = await avaGoogle();
    if (google) await syncIfStale(google).catch((e) => console.warn("[portal] calendar:", e instanceof Error ? e.message : e));

    const client = await getClient(clientId);
    if (!client) throw new HttpError(404, "No such client.");
    const [documents, meetings, meetingDocs] = await Promise.all([
      listDocuments(clientId),
      clientMeetings(clientId),
      rows<{ meeting_id: string }[]>(db().from("knowledge").select("meeting_id").eq("client_id", clientId).not("meeting_id", "is", null)),
    ]);
    // Documents added to each meeting's preparation.
    const counts = new Map<string, number>();
    for (const d of meetingDocs) counts.set(d.meeting_id, (counts.get(d.meeting_id) ?? 0) + 1);
    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        instructions: client.instructions,
        digest: client.digest,
        digest_at: client.digest_at,
        status: client.status,
        logo_url: client.logo_url ?? null,
      },
      documents,
      meetings: meetings.map((m) => ({ ...m, documents: counts.get(m.id) ?? 0 })),
      ava: process.env.AVA_EMAIL || null,
    });
  });
}
