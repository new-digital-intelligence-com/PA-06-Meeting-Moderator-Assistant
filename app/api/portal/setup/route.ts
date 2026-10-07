import { NextResponse } from "next/server";
import { adminDomain, handle, HttpError, portalClient } from "@/lib/auth";
import { getClient, peopleOf, updateClient } from "@/lib/clients";

export const runtime = "nodejs";

/**
 * A client's setup — for its own people (their Setup tab) and for NDI (the client's page in
 * /admin): name and logo, and who can use her, the super admin marked. NDI's own client
 * also says which domain counts for it.
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
        status: client.status,
        logo_url: client.logo_url ?? null,
        created_at: client.created_at,
        // Which NDI address set them up is NDI's business.
        created_by: admin ? client.created_by : null,
        // NDI's own client: everybody at NDI organises its meetings too.
        ndi_domain: client.domains.includes(adminDomain()) ? adminDomain() : null,
      },
      people: await peopleOf(clientId),
      me: user.email,
      admin,
    });
  });
}

/** Their name, for anyone who can use her. Active or paused, only NDI changes. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const body = (await request.json().catch(() => ({}))) as { name?: string; status?: string };
    const admin = user.role === "admin";
    if (!admin && body.status !== undefined) throw new HttpError(403, "Pausing her is set by NDI.");
    if (body.name !== undefined && !body.name.trim()) throw new HttpError(400, "Give the company a name.");
    try {
      const client = await updateClient(clientId, {
        name: body.name?.trim().slice(0, 120),
        ...(admin ? { status: body.status } : {}),
      });
      return NextResponse.json({ client: { id: client.id, name: client.name } });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not save.");
    }
  });
}
