import { NextResponse } from "next/server";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { domainsFor, getClient, listMembers, ownerOf, peopleOf, updateClient } from "@/lib/clients";

export const runtime = "nodejs";

/**
 * A client's setup — for its own people (their Setup tab) and for NDI (the client's page in
 * /admin): name and logo, their company domains, and who can use her, the super admin marked.
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
        // Anybody at these signs in here, and the meetings they organise are theirs.
        domains: client.domains,
      },
      people: await peopleOf(clientId),
      me: user.email,
      admin,
    });
  });
}

/**
 * Their name, for anyone who can use her. Their company domains: their super admin, or NDI —
 * each checked to be real, and nobody else's (domainsFor). Active or paused: NDI only.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const body = (await request.json().catch(() => ({}))) as { name?: string; status?: string; domains?: string | string[] };
    const admin = user.role === "admin";
    if (!admin && body.status !== undefined) throw new HttpError(403, "Pausing her is set by NDI.");
    if (!admin && body.domains !== undefined) {
      const owner = ownerOf(await listMembers(clientId));
      if (user.email !== owner?.email) throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} sets your company domain.`);
    }
    if (body.name !== undefined && !body.name.trim()) throw new HttpError(400, "Give the company a name.");
    try {
      const domains = body.domains !== undefined ? await domainsFor(clientId, body.domains, { admin }) : undefined;
      const client = await updateClient(clientId, {
        name: body.name?.trim().slice(0, 120),
        ...(domains ? { domains } : {}),
        ...(admin ? { status: body.status } : {}),
      });
      return NextResponse.json({ client: { id: client.id, name: client.name, domains: client.domains } });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not save.");
    }
  });
}
