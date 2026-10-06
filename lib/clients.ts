/**
 * Ava's clients: who they are, who may sign in for them, and which meetings are theirs.
 *
 * A meeting belongs to the client of whoever organised it — an exact address first (a
 * personal account, which cannot be matched by its domain: gmail.com is everybody), then
 * the company domain. The organiser, never a guest: otherwise a stranger could put one
 * client employee on an invite and have Ava for free.
 */
import { avaGoogle } from "./ava";
import { removeLogo } from "./cloudinary";
import { asClient, asMember, db, rows, type Client, type Member } from "./db";
import { PERSONAL, emailDomain } from "./mail-domains";
import { sendEmail } from "./workspace";

export { emailDomain };

export function cleanDomains(input: string[] | string | undefined): string[] {
  const list = Array.isArray(input) ? input : (input ?? "").split(/[\s,;]+/);
  const out = list
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^@/, "").replace(/\/.*$/, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  const personal = out.find((d) => PERSONAL.has(d));
  if (personal) throw new Error(`${personal} is a shared mail provider — add the person's exact address instead of the domain.`);
  return [...new Set(out)];
}

export function cleanAddresses(input: string[] | string | undefined): string[] {
  const list = Array.isArray(input) ? input : (input ?? "").split(/[\s,;]+/);
  return [...new Set(list.map((a) => a.trim().toLowerCase()).filter((a) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(a)))];
}

/** The active client an organiser's address belongs to (or a paused one too), from a list loaded once. */
export function matchClient(clients: Client[], organizer: string | null | undefined, includePaused = false): Client | null {
  const e = (organizer ?? "").trim().toLowerCase();
  if (!e.includes("@")) return null;
  const active = includePaused ? clients : clients.filter((c) => c.status === "active");
  return active.find((c) => c.addresses.includes(e)) ?? active.find((c) => c.domains.includes(emailDomain(e))) ?? null;
}

export async function allClients(): Promise<Client[]> {
  return (await rows<Record<string, unknown>[]>(db().from("clients").select("*").order("created_at"))).map(asClient);
}

export async function getClient(id: string): Promise<Client | null> {
  const c = await rows<Record<string, unknown> | null>(db().from("clients").select("*").eq("id", id).maybeSingle());
  return c ? asClient(c) : null;
}

export type ClientSummary = Client & {
  members: number;
  documents: number;
  upcoming: number;
  last_meeting: Date | null;
};

/** Every client with its numbers — counted by "pa-06".client_summaries() (db/schema.sql). */
export async function listClients(): Promise<ClientSummary[]> {
  const [clients, numbers] = await Promise.all([
    allClients(),
    rows<{ id: string; members: number; documents: number; upcoming: number; last_meeting: string | null }[]>(db().rpc("client_summaries")),
  ]);
  const byId = new Map(numbers.map((n) => [n.id, n]));
  return clients.map((c) => {
    const n = byId.get(c.id);
    return {
      ...c,
      members: n?.members ?? 0,
      documents: n?.documents ?? 0,
      upcoming: n?.upcoming ?? 0,
      last_meeting: n?.last_meeting ? new Date(n.last_meeting) : null,
    };
  });
}

export async function listMembers(clientId: string): Promise<Member[]> {
  return (await rows<Record<string, unknown>[]>(db().from("members").select("*").eq("client_id", clientId).order("invited_at"))).map(asMember);
}

/** Which of these addresses already sign in for a client other than `clientId` (any client when null). */
async function takenElsewhere(emails: string[], clientId: string | null): Promise<{ email: string; client: string }[]> {
  if (!emails.length) return [];
  let query = db().from("members").select("email, clients!inner(name)").in("email", emails);
  if (clientId) query = query.neq("client_id", clientId);
  const found = await rows<{ email: string; clients: { name: string } }[]>(query);
  return found.map((m) => ({ email: m.email, client: m.clients.name }));
}

export async function createClient(input: {
  name: string;
  domains?: string[] | string;
  addresses?: string[] | string;
  contacts?: string[] | string;
  by: string;
}): Promise<Client> {
  const name = input.name.trim();
  if (!name) throw new Error("Give the client a name.");
  const domains = cleanDomains(input.domains);
  const addresses = cleanAddresses(input.addresses);
  const contacts = cleanAddresses(input.contacts);
  if (!domains.length && !addresses.length) throw new Error("Add the company's domain (or a person's exact address), so Ava knows which invites are theirs.");
  const [taken] = await takenElsewhere(contacts, null);
  if (taken) throw new Error(`${taken.email} already signs in for ${taken.client}.`);

  const client = asClient(
    await rows<Record<string, unknown>>(
      db().from("clients").insert({ name, domains, addresses, created_by: input.by }).select("*").single(),
    ),
  );
  if (contacts.length) {
    const added = await db()
      .from("members")
      .insert(contacts.map((email) => ({ client_id: client.id, email })));
    // Not half a client: without its people it goes again.
    if (added.error) {
      await db().from("clients").delete().eq("id", client.id);
      throw new Error(added.error.message);
    }
  }
  return client;
}

export async function updateClient(
  id: string,
  patch: { name?: string; domains?: string[] | string; addresses?: string[] | string; instructions?: string; status?: string },
): Promise<Client> {
  const current = await getClient(id);
  if (!current) throw new Error("No such client.");
  const name = patch.name !== undefined ? patch.name.trim() || current.name : current.name;
  const domains = patch.domains !== undefined ? cleanDomains(patch.domains) : current.domains;
  const addresses = patch.addresses !== undefined ? cleanAddresses(patch.addresses) : current.addresses;
  const instructions = patch.instructions !== undefined ? patch.instructions.slice(0, 20_000) : current.instructions;
  const status = patch.status === "paused" || patch.status === "active" ? patch.status : current.status;
  return asClient(
    await rows<Record<string, unknown>>(
      db().from("clients").update({ name, domains, addresses, instructions, status }).eq("id", id).select("*").single(),
    ),
  );
}

export async function deleteClient(id: string): Promise<void> {
  const removed = await rows<{ logo_url?: string | null }[]>(db().from("clients").delete().eq("id", id).select("*"));
  // Their logo goes with them; a Cloudinary hiccup must not keep the client.
  if (removed[0]?.logo_url) await removeLogo(id).catch((e) => console.warn("[clients] logo not removed:", e instanceof Error ? e.message : e));
}

/** A client's logo, as Cloudinary gave its address — or none. */
export async function setLogo(id: string, url: string | null): Promise<Client> {
  return asClient(await rows<Record<string, unknown>>(db().from("clients").update({ logo_url: url }).eq("id", id).select("*").single()));
}

/** Lets an address sign in for this client; again, it only updates the name. */
export async function addMember(clientId: string, email: string, name?: string): Promise<Member> {
  const [e] = cleanAddresses([email]);
  if (!e) throw new Error("That is not an email address.");
  const [taken] = await takenElsewhere([e], clientId);
  if (taken) throw new Error(`${e} already signs in for ${taken.client}.`);
  return asMember(
    await rows<Record<string, unknown>>(
      db()
        .from("members")
        .upsert({ client_id: clientId, email: e, ...(name ? { name } : {}) }, { onConflict: "email" })
        .select("*")
        .single(),
    ),
  );
}

export async function removeMember(clientId: string, memberId: string): Promise<void> {
  await rows(db().from("members").delete().eq("id", memberId).eq("client_id", clientId));
}

/**
 * The invitation, sent from Ava's own account like her notes: what she is, how to sign
 * in, and how to have her in a meeting.
 */
export async function sendInvite(client: Client, email: string, appUrl: string): Promise<void> {
  const google = await avaGoogle();
  if (!google) throw new Error("Ava's Google account is not connected, so she cannot send the invitation. Connect it in the control room.");
  const ava = process.env.AVA_EMAIL || "Ava";
  const login = `${appUrl.replace(/\/$/, "")}/login?email=${encodeURIComponent(email)}`;
  const subject = `Ava is ready for ${client.name}`;
  const text = [
    "Hello,",
    "",
    `${client.name} now has Ava, NDI's AI meeting assistant.`,
    "",
    `Sign in to give her your company's knowledge and to prepare her for meetings:`,
    login,
    "",
    "Sign in with your Google account, or ask for a sign-in link by email — no password needed.",
    "",
    `To have her in a meeting, invite ${ava} to it from your calendar, like a colleague. After the meeting she emails everyone the summary and the actions.`,
    "",
    "— Ava, New Digital Intelligence",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111827;max-width:560px">
<p>Hello,</p>
<p><b>${escapeHtml(client.name)}</b> now has Ava, NDI's AI meeting assistant.</p>
<p>Sign in to give her your company's knowledge and to prepare her for meetings:</p>
<p><a href="${login}" style="display:inline-block;background:#002A6C;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Sign in</a></p>
<p style="color:#6B7280">Sign in with your Google account, or ask for a sign-in link by email — no password needed.</p>
<p>To have her in a meeting, invite <b>${escapeHtml(ava)}</b> to it from your calendar, like a colleague. After the meeting she emails everyone the summary and the actions.</p>
<p style="color:#6B7280">— Ava, New Digital Intelligence</p></div>`;
  await sendEmail(google, email, subject, text, html);
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
