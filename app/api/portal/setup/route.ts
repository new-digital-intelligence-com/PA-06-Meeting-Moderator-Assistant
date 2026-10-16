import { NextResponse } from "next/server";
import { runnerFace } from "@/lib/ava";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { domainsFor, getClient, peopleOf, updateClient } from "@/lib/clients";

export const runtime = "nodejs";

/** The line db/schema.sql has for her face per client, for a database made before it. */
const AVATAR_LINE = `alter table "pa-06".clients add column if not exists avatar boolean not null default false;`;

/**
 * A client's setup — for its own people (their Setup tab) and for NDI (the client's page in
 * /admin): name and logo, their company domains, and who can use her, the super admin marked.
 * For NDI also her face in their meetings (`avatar`), and whether her runner allows it at all.
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
        // Her face in their meetings: NDI's to set (Anam's minutes are NDI's).
        ...(admin ? { avatar: client.avatar === true, avatarReady: client.avatar !== undefined } : {}),
      },
      // Her runner's AVA_AVATAR: "off" turns her face off for everyone, whatever is set here.
      ...(admin ? { runnerAvatar: await runnerFace() } : {}),
      people: await peopleOf(clientId),
      me: user.email,
      admin,
    });
  });
}

/**
 * Their name, for anyone who can use her. Their company domains, active or paused, and her
 * face in their meetings: NDI only — anybody at a domain signs in to the client's page, so a
 * client asks for a change (/api/portal/domain-request). Each domain is checked to be real
 * and nobody else's.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const body = (await request.json().catch(() => ({}))) as { name?: string; status?: string; domains?: string | string[]; avatar?: unknown };
    const admin = user.role === "admin";
    if (!admin && body.status !== undefined) throw new HttpError(403, "Pausing her is set by NDI.");
    if (!admin && body.domains !== undefined) throw new HttpError(403, "Your company domains are set by NDI — ask for a change on your Setup tab.");
    if (!admin && body.avatar !== undefined) throw new HttpError(403, "Her face in your meetings is set by NDI.");
    if (body.avatar !== undefined && typeof body.avatar !== "boolean") throw new HttpError(400, "Her face is on or off.");
    if (body.name !== undefined && !body.name.trim()) throw new HttpError(400, "Give the company a name.");
    if (typeof body.avatar === "boolean" && (await getClient(clientId))?.avatar === undefined) {
      throw new HttpError(409, `Her face per client needs one line in Supabase first (SQL editor): ${AVATAR_LINE}`);
    }
    try {
      const domains = body.domains !== undefined ? await domainsFor(clientId, body.domains, { admin }) : undefined;
      const client = await updateClient(clientId, {
        name: body.name?.trim().slice(0, 120),
        ...(domains ? { domains } : {}),
        ...(admin ? { status: body.status } : {}),
        ...(admin && typeof body.avatar === "boolean" ? { avatar: body.avatar } : {}),
      });
      return NextResponse.json({ client: { id: client.id, name: client.name, domains: client.domains, avatar: client.avatar === true } });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not save.");
    }
  });
}
