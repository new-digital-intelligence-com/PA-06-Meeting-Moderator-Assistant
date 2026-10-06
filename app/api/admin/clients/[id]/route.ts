import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, requireAdmin } from "@/lib/auth";
import { deleteClient } from "@/lib/clients";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * Removes the client with its people, documents and meetings — NDI only. Their files in
 * Drive stay. Everything else about a client is set from its Setup (/api/portal/setup,
 * /people and /logo), where NDI can do more than the client's own people.
 */
export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which client?");
    await deleteClient(id);
    return NextResponse.json({ ok: true });
  });
}
