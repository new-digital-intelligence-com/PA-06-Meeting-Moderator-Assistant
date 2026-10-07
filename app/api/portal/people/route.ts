import { NextResponse } from "next/server";
import { appOrigin, handle, HttpError, isAdminEmail, isUuid, portalClient } from "@/lib/auth";
import { addMember, allClients, cleanAddresses, clientPeople, getClient, listMembers, makeOwner, ownerOf, peopleOf, removeMember, sendInvite } from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Someone who can use her — they open the client's page, and her invites from them are the
 * client's — added by anyone on the client's list or by NDI; with `invite`, Ava emails them.
 * Again, to somebody already on the list: only their super admin, or NDI. Somebody on
 * another client's list is refused: their meetings would move here. Clients are not told whose.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const admin = user.role === "admin";
    const client = await getClient(clientId);
    if (!client) throw new HttpError(404, "No such client.");
    const body = (await request.json().catch(() => ({}))) as { email?: string; invite?: boolean };
    const [email] = cleanAddresses([body.email ?? ""]);
    if (!email) throw new HttpError(400, "That is not an email address.");
    // NDI already sees every client; on a list, all their meetings would become this client's.
    if (isAdminEmail(email)) throw new HttpError(400, "NDI's own addresses are not added to a client: NDI already sees every client.");
    // Sending somebody on the list their invitation again is the super admin's — and NDI's.
    if (body.invite && !admin) {
      const members = await listMembers(clientId);
      const owner = ownerOf(members);
      if (members.some((m) => m.email === email) && user.email !== owner?.email) {
        throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} sends an invitation again.`);
      }
    }

    const using = await clientPeople();
    const usesElsewhere = using.get(email);
    if (usesElsewhere && usesElsewhere !== clientId) {
      const other = admin ? (await allClients()).find((c) => c.id === usesElsewhere)?.name : null;
      throw new HttpError(400, admin ? `${email} already uses her for ${other ?? "another client"}.` : `${email} already uses Ava for another company.`);
    }

    let member;
    try {
      member = await addMember(clientId, email);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not add that address.");
    }
    let inviteError: string | null = null;
    if (body.invite) {
      try {
        await sendInvite(client, member.email, appOrigin(request));
      } catch (e) {
        inviteError = e instanceof Error ? e.message : "The invitation was not sent.";
      }
    }
    return NextResponse.json({ people: await peopleOf(clientId), invited: Boolean(body.invite) && !inviteError, inviteError });
  });
}

/**
 * Takes someone's use of her away, at once. Only the client's super admin removes people —
 * and NDI. Nobody removes the super admin (NDI makes someone else it first), and nobody
 * removes themselves.
 */
export async function DELETE(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const id = new URL(request.url).searchParams.get("person");
    if (!id || !isUuid(id)) throw new HttpError(400, "Who?");
    const members = await listMembers(clientId);
    const them = members.find((m) => m.id === id);
    if (!them) throw new HttpError(404, "They are not on the list.");
    const owner = ownerOf(members);
    const admin = user.role === "admin";
    if (them.id === owner?.id) {
      throw new HttpError(
        400,
        admin
          ? `${them.email} is their super admin: make someone else super admin first.`
          : them.email === user.email
            ? "You are the super admin, and can't be removed."
            : `${them.email} is your super admin, and can't be removed.`,
      );
    }
    if (!admin) {
      if (them.email === user.email) throw new HttpError(400, "You can't remove yourself — ask your super admin, or NDI.");
      if (user.email !== owner?.email) throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} removes people.`);
    }
    await removeMember(clientId, id);
    return NextResponse.json({ people: await peopleOf(clientId) });
  });
}

/** NDI only: makes someone on the list the client's super admin. The one before stays on it. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    if (user.role !== "admin") throw new HttpError(403, "Only NDI changes who the super admin is.");
    const id = new URL(request.url).searchParams.get("person");
    if (!id || !isUuid(id)) throw new HttpError(400, "Who?");
    try {
      await makeOwner(clientId, id);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not change the super admin.");
    }
    return NextResponse.json({ people: await peopleOf(clientId) });
  });
}
