import { NextResponse } from "next/server";
import { avaGoogle } from "@/lib/ava";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { db, table } from "@/lib/db";
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
    const [documents, meetings, perMeeting] = await Promise.all([
      listDocuments(clientId),
      clientMeetings(clientId),
      db()<{ meeting_id: string; n: number }[]>`
        select meeting_id, count(*)::int as n from ${table("knowledge")} where client_id = ${clientId} and meeting_id is not null group by meeting_id`,
    ]);
    const counts = new Map(perMeeting.map((r) => [r.meeting_id, r.n]));
    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        instructions: client.instructions,
        digest: client.digest,
        digest_at: client.digest_at,
        domains: client.domains,
        addresses: client.addresses,
        status: client.status,
      },
      documents,
      meetings: meetings.map((m) => ({ ...m, documents: counts.get(m.id) ?? 0 })),
      ava: process.env.AVA_EMAIL || null,
    });
  });
}
