import { NextResponse } from "next/server";
import { appOrigin, handle, HttpError, isAdminEmail, isUuid, portalClient } from "@/lib/auth";
import { addMember, allClients, cleanAddresses, clientPeople, getClient, listMembers, matchClient, removeMember, sendInvite } from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 30;

const people = async (clientId: string) =>
  (await listMembers(clientId)).map((m) => ({ id: m.id, email: m.email, name: m.name, last_login_at: m.last_login_at }));

/**
 * Someone who can use her — they open the client's page, and her invites from them are the
 * client's — added by the client's own people or by NDI; with `invite`, Ava emails them
 * (again). An address that is another client's — by who uses her there, its domain or one
 * of its addresses — is refused: its meetings would move here. Clients are not told whose.
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
    // NDI already sees every client; as someone who uses her here, all their meetings would become this client's.
    if (isAdminEmail(email)) throw new HttpError(400, "NDI's own addresses are not added to a client: NDI already sees every client.");

    const [clients, using] = await Promise.all([allClients(), clientPeople()]);
    const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? "another client";
    const usesElsewhere = using.get(email);
    if (usesElsewhere && usesElsewhere !== clientId) {
      throw new HttpError(400, admin ? `${email} already uses her for ${nameOf(usesElsewhere)}.` : `${email} already uses Ava for another company.`);
    }
    const claimed = matchClient(clients.filter((c) => c.id !== clientId), new Map(), email, true);
    if (claimed) {
      throw new HttpError(
        400,
        admin
          ? `${email} is ${claimed.name}'s (their domain or one of their addresses): their meetings would move to ${client.name}.`
          : `${email} belongs to another company that uses Ava.`,
      );
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
    return NextResponse.json({ people: await people(clientId), invited: Boolean(body.invite) && !inviteError, inviteError });
  });
}

/** Takes someone's use of her away, at once. A client's own people cannot remove themselves. */
export async function DELETE(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const id = new URL(request.url).searchParams.get("person");
    if (!id || !isUuid(id)) throw new HttpError(400, "Who?");
    if (user.role !== "admin") {
      const them = (await listMembers(clientId)).find((m) => m.id === id);
      if (them?.email === user.email) throw new HttpError(400, "You can't remove yourself — ask someone else on your team, or NDI.");
    }
    await removeMember(clientId, id);
    return NextResponse.json({ people: await people(clientId) });
  });
}
