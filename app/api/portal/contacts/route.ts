import { NextResponse } from "next/server";
import { handle, HttpError, portalClient } from "@/lib/auth";
import { cleanEmail, contactsReady, listContacts, removeContact, saveContact } from "@/lib/contacts";

export const runtime = "nodejs";

/**
 * Who's who (lib/contacts.ts): the client's people by address, and what she should know
 * about each — the same line in the Who's who tab and in every meeting's preparation they are in.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const [ready, contacts] = await Promise.all([contactsReady(), listContacts(clientId)]);
    return NextResponse.json({ ready, contacts });
  });
}

/** Writes one person's line: { email, name?, info? }. */
export async function PUT(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const body = (await request.json().catch(() => null)) as { email?: unknown; name?: unknown; info?: unknown } | null;
    if (!body) throw new HttpError(400, "Invalid JSON body.");
    try {
      return NextResponse.json({ contact: await saveContact(clientId, body, user.email) });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not save it.");
    }
  });
}

/** Takes one person off: ?email=… */
export async function DELETE(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const email = cleanEmail(new URL(request.url).searchParams.get("email"));
    if (!email) throw new HttpError(400, "Whose line?");
    await removeContact(clientId, email);
    return NextResponse.json({ ok: true });
  });
}
