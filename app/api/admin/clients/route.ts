import { NextResponse } from "next/server";
import { avaGoogle } from "@/lib/ava";
import { appOrigin, handle, HttpError, requireAdmin } from "@/lib/auth";
import { createClient, listClients, listMembers, sendInvite } from "@/lib/clients";
import { skippedInvites, syncIfStale } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Every client, and the invites she got from nobody's company. Admins only. */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const google = await avaGoogle();
    if (google) await syncIfStale(google).catch((e) => console.warn("[admin] calendar:", e instanceof Error ? e.message : e));
    const [clients, skipped] = await Promise.all([listClients(), skippedInvites()]);
    return NextResponse.json({ clients, skipped });
  });
}

/** A new client: who they are, their company domains, their super admin, and anyone else who can use her for them. */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = (await request.json().catch(() => ({}))) as { name?: string; owner?: string; contacts?: string; domains?: string; invite?: boolean };
    let client;
    try {
      client = await createClient({ name: body.name ?? "", owner: body.owner, contacts: body.contacts, domains: body.domains, by: admin.email });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not create the client.");
    }
    const invited: string[] = [];
    const failed: { email: string; error: string }[] = [];
    if (body.invite) {
      const origin = appOrigin(request);
      for (const m of await listMembers(client.id)) {
        try {
          await sendInvite(client, m.email, origin);
          invited.push(m.email);
        } catch (e) {
          failed.push({ email: m.email, error: e instanceof Error ? e.message : "not sent" });
        }
      }
    }
    return NextResponse.json({ client, invited, failed });
  });
}
