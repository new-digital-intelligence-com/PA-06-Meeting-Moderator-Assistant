import { NextResponse } from "next/server";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { getClient, listMembers, updateClient } from "@/lib/clients";

export const runtime = "nodejs";

/**
 * A client's setup — for its own people (their Setup tab) and for NDI (the client's page in
 * /admin): name and logo, which invites are theirs, who can use her.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const client = await getClient(clientId);
    if (!client) throw new HttpError(404, "No such client.");
    const admin = user.role === "admin";
    return NextResponse.json({
      client: {
        id: client.id,
        name: client.name,
        domains: client.domains,
        addresses: client.addresses,
        status: client.status,
        logo_url: client.logo_url ?? null,
        created_at: client.created_at,
        // Which NDI address set them up is NDI's business.
        created_by: admin ? client.created_by : null,
      },
      people: (await listMembers(clientId)).map((m) => ({ id: m.id, email: m.email, name: m.name, last_login_at: m.last_login_at })),
      me: user.email,
      admin,
    });
  });
}

/**
 * Their name, for anyone who can use her. Which invites are theirs, and active or paused,
 * only NDI changes: a client could otherwise claim another company's domain and see its
 * meetings.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const body = (await request.json().catch(() => ({}))) as { name?: string; domains?: string; addresses?: string; status?: string };
    const admin = user.role === "admin";
    if (!admin && (body.domains !== undefined || body.addresses !== undefined || body.status !== undefined)) {
      throw new HttpError(403, "Which meetings are yours, and pausing her, are set by NDI.");
    }
    if (body.name !== undefined && !body.name.trim()) throw new HttpError(400, "Give the company a name.");
    try {
      const client = await updateClient(clientId, {
        name: body.name?.trim().slice(0, 120),
        ...(admin ? { domains: body.domains, addresses: body.addresses, status: body.status } : {}),
      });
      return NextResponse.json({ client: { id: client.id, name: client.name } });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not save.");
    }
  });
}
