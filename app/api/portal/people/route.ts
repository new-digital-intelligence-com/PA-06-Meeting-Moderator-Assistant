import { NextResponse } from "next/server";
import { adminDomain, appOrigin, handle, HttpError, isAdminEmail, isUuid, portalClient } from "@/lib/auth";
import {
  addMember,
  allClients,
  changeAddress,
  cleanAddresses,
  clientPeople,
  getClient,
  listMembers,
  makeOwner,
  ownerOf,
  peopleOf,
  removeMember,
  sendInvite,
} from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Why an address cannot be one of this client's people, or null if it can. NDI's own: NDI
 * sees every client — and for NDI's own client they count already. On another client's
 * list: their meetings would move here. Only NDI is told whose.
 */
async function refusal(email: string, clientId: string, ndisOwn: boolean, admin: boolean): Promise<string | null> {
  if (isAdminEmail(email)) {
    return ndisOwn
      ? `${email} is NDI's already: everybody at @${adminDomain()} signs in as an admin, and the meetings they organise count here. Add personal addresses only.`
      : "NDI's own addresses are not added to a client: NDI already sees every client.";
  }
  const usesElsewhere = (await clientPeople()).get(email);
  if (usesElsewhere && usesElsewhere !== clientId) {
    if (!admin) return `${email} already uses Ava for another company.`;
    const other = (await allClients()).find((c) => c.id === usesElsewhere)?.name;
    return `${email} already uses her for ${other ?? "another client"}.`;
  }
  return null;
}

/**
 * Someone who can use her — they open the client's page, and her invites from them are the
 * client's — added by anyone on the client's list or by NDI; with `invite`, Ava emails them.
 * Again, to somebody already on the list: only their super admin, or NDI.
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
    // Sending somebody on the list their invitation again is the super admin's — and NDI's.
    if (body.invite && !admin) {
      const members = await listMembers(clientId);
      const owner = ownerOf(members);
      if (members.some((m) => m.email === email) && user.email !== owner?.email) {
        throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} sends an invitation again.`);
      }
    }
    const refused = await refusal(email, clientId, client.domains.includes(adminDomain()), admin);
    if (refused) throw new HttpError(400, refused);

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
 * Takes someone's use of her away, at once. The client's super admin removes the people
 * they added; NDI removes anybody, the super admin too — who then has nobody in that place
 * until NDI makes someone it. Nobody of theirs removes the super admin, or themselves.
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
    if (user.role !== "admin") {
      if (them.id === owner?.id) {
        throw new HttpError(400, them.email === user.email ? "You are the super admin, and can't be removed." : `${them.email} is your super admin, and can't be removed.`);
      }
      if (them.email === user.email) throw new HttpError(400, "You can't remove yourself — ask your super admin, or NDI.");
      if (user.email !== owner?.email) throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} removes people.`);
    }
    await removeMember(clientId, id);
    return NextResponse.json({ people: await peopleOf(clientId) });
  });
}

/**
 * Changes someone on the list. `{ email }`: a new address for them — the client's super
 * admin, for anybody on it and themselves, or NDI; never the people added. `{ owner: true }`:
 * NDI makes them the super admin, and the one before stays on the list.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const admin = user.role === "admin";
    const id = new URL(request.url).searchParams.get("person");
    if (!id || !isUuid(id)) throw new HttpError(400, "Who?");
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; owner?: unknown };
    const members = await listMembers(clientId);
    const them = members.find((m) => m.id === id);
    if (!them) throw new HttpError(404, "They are not on the list.");

    if (body.owner === true) {
      if (!admin) throw new HttpError(403, "Only NDI changes who the super admin is.");
      try {
        await makeOwner(clientId, id);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : "Could not change the super admin.");
      }
      return NextResponse.json({ people: await peopleOf(clientId) });
    }

    if (typeof body.email !== "string") throw new HttpError(400, "Nothing to change.");
    const owner = ownerOf(members);
    if (!admin && user.email !== owner?.email) {
      throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} changes addresses.`);
    }
    const [email] = cleanAddresses([body.email]);
    if (!email) throw new HttpError(400, "That is not an email address.");
    if (email === them.email) return NextResponse.json({ people: await peopleOf(clientId), changed: false });
    if (members.some((m) => m.email === email)) throw new HttpError(400, `${email} is already on the list.`);
    const client = await getClient(clientId);
    if (!client) throw new HttpError(404, "No such client.");
    const refused = await refusal(email, clientId, client.domains.includes(adminDomain()), admin);
    if (refused) throw new HttpError(400, refused);
    try {
      await changeAddress(clientId, id, email);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not change the address.");
    }
    // Their own address changed: this session was the old one's, and the new one signs in itself.
    return NextResponse.json({ people: await peopleOf(clientId), changed: true, self: !admin && them.email === user.email });
  });
}
