import { NextResponse } from "next/server";
import { appOrigin, handle, HttpError, requireAdmin } from "@/lib/auth";
import { addMember, getClient, listMembers, removeMember, sendInvite } from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

/** Lets an address sign in for this client — and, with `invite`, emails it the invitation (again). */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const client = await getClient(id);
    if (!client) throw new HttpError(404, "No such client.");
    const body = (await request.json().catch(() => ({}))) as { email?: string; name?: string; invite?: boolean };
    let member;
    try {
      member = await addMember(id, body.email ?? "", body.name?.trim() || undefined);
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
    return NextResponse.json({ members: await listMembers(id), invited: body.invite && !inviteError, inviteError });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const member = new URL(request.url).searchParams.get("member");
    if (!member) throw new HttpError(400, "Which member?");
    await removeMember(id, member);
    return NextResponse.json({ members: await listMembers(id) });
  });
}
