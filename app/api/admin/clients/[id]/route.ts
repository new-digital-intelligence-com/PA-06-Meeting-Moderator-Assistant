import { NextResponse } from "next/server";
import { handle, HttpError, requireAdmin } from "@/lib/auth";
import { deleteClient, getClient, listMembers, updateClient } from "@/lib/clients";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const client = await getClient(id);
    if (!client) throw new HttpError(404, "No such client.");
    return NextResponse.json({ client, members: await listMembers(id) });
  });
}

/** Name, domains, exact addresses, instructions, or active/paused. */
export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const patch = (await request.json().catch(() => ({}))) as Parameters<typeof updateClient>[1];
    try {
      return NextResponse.json({ client: await updateClient(id, patch) });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not save.");
    }
  });
}

/** Removes the client with its members, documents and meetings. Their files in Drive stay. */
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    await deleteClient(id);
    return NextResponse.json({ ok: true });
  });
}
