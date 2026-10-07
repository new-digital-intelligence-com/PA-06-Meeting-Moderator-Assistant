/**
 * Ava's clients: who they are, who can use her for them, and which meetings are theirs.
 *
 * Who can use her is one list per client (the members table): its super admin — the
 * address NDI set the client up with (role "owner") — and the people added since
 * ("member"). They all have the same page and can add people. Only the super admin
 * changes addresses (theirs too), sends an invitation again and removes people; nobody of
 * theirs removes the super admin. NDI does all of it, the super admin included, and makes
 * someone the super admin.
 *
 * A meeting is a client's when its organiser is on that list: not by company domain, and
 * never by a guest — otherwise anybody could put one client employee on an invite and
 * have Ava for free. NDI's own client also has NDI's addresses (ADMIN_DOMAIN), which are
 * never on a list: NDI sees every client anyway.
 */
import { adminDomain, isAdminEmail } from "./auth";
import { avaGoogle } from "./ava";
import { removeLogo } from "./cloudinary";
import { asClient, asMember, db, rows, type Client, type Member } from "./db";
import { emailDomain } from "./mail-domains";
import { sendEmail } from "./workspace";

export { emailDomain };

export function cleanAddresses(input: string[] | string | undefined): string[] {
  const list = Array.isArray(input) ? input : (input ?? "").split(/[\s,;]+/);
  return [...new Set(list.map((a) => a.trim().toLowerCase()).filter((a) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(a)))];
}

/**
 * The active client an organiser's address belongs to (or a paused one too), from lists
 * loaded once: the clients, and who can use her for each (`people`, address → client id).
 * Only somebody on a client's list — and, for NDI's own client, anybody at NDI.
 */
export function matchClient(
  clients: Client[],
  people: Map<string, string>,
  organizer: string | null | undefined,
  includePaused = false,
): Client | null {
  const e = (organizer ?? "").trim().toLowerCase();
  if (!e.includes("@")) return null;
  const active = includePaused ? clients : clients.filter((c) => c.status === "active");
  const theirs = people.get(e);
  if (theirs) return active.find((c) => c.id === theirs) ?? null;
  return isAdminEmail(e) ? (active.find((c) => c.domains.includes(adminDomain())) ?? null) : null;
}

/** A client's super admin: the first "owner" on its list, as listMembers gives it. */
export function ownerOf(members: Member[]): Member | null {
  return members.find((m) => m.role === "owner") ?? null;
}

/** Who can use her for a client, as its Setup shows them: the super admin marked, and first. */
export async function peopleOf(clientId: string) {
  const members = await listMembers(clientId);
  const owner = ownerOf(members);
  return members
    .map((m) => ({ id: m.id, email: m.email, name: m.name, last_login_at: m.last_login_at, owner: m.id === owner?.id }))
    .sort((a, b) => Number(b.owner) - Number(a.owner));
}

export async function allClients(): Promise<Client[]> {
  return (await rows<Record<string, unknown>[]>(db().from("clients").select("*").order("created_at"))).map(asClient);
}

/** Everyone who can use her, with whose Ava — an address belongs to one client only. */
export async function clientPeople(): Promise<Map<string, string>> {
  const found = await rows<{ email: string; client_id: string }[]>(db().from("members").select("email, client_id"));
  return new Map(found.map((m) => [m.email.toLowerCase(), m.client_id]));
}

export async function getClient(id: string): Promise<Client | null> {
  const c = await rows<Record<string, unknown> | null>(db().from("clients").select("*").eq("id", id).maybeSingle());
  return c ? asClient(c) : null;
}

export type ClientSummary = Client & {
  /** Their super admin's address. */
  owner: string | null;
  members: number;
  documents: number;
  upcoming: number;
  last_meeting: Date | null;
};

/** Every client with its numbers — counted by "pa-06".client_summaries() (db/schema.sql). */
export async function listClients(): Promise<ClientSummary[]> {
  const [clients, numbers, owners] = await Promise.all([
    allClients(),
    rows<{ id: string; members: number; documents: number; upcoming: number; last_meeting: string | null }[]>(db().rpc("client_summaries")),
    rows<{ client_id: string; email: string }[]>(db().from("members").select("client_id, email").eq("role", "owner").order("invited_at")),
  ]);
  const byId = new Map(numbers.map((n) => [n.id, n]));
  // Each client's first owner, as ownerOf() reads its list.
  const ownerFor = new Map<string, string>();
  for (const o of owners) if (!ownerFor.has(o.client_id)) ownerFor.set(o.client_id, o.email);
  return clients.map((c) => {
    const n = byId.get(c.id);
    return {
      ...c,
      owner: ownerFor.get(c.id) ?? null,
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

/**
 * A new client and its list: the super admin first ("owner"), then anyone else who can use
 * her ("member"). Nobody already on another client's list, and nobody at NDI.
 */
export async function createClient(input: { name: string; owner?: string; contacts?: string[] | string; by: string }): Promise<Client> {
  const name = input.name.trim();
  if (!name) throw new Error("Give the client a name.");
  const [owner] = cleanAddresses([input.owner ?? ""]);
  if (!owner) throw new Error("Add their super admin's email address: the person who runs Ava for them.");
  const people = [owner, ...cleanAddresses(input.contacts).filter((e) => e !== owner)];
  const ndi = people.find((e) => isAdminEmail(e));
  if (ndi) throw new Error(`${ndi} is NDI's: NDI already sees every client, so it is on no client's list.`);
  const [taken] = await takenElsewhere(people, null);
  if (taken) throw new Error(`${taken.email} already signs in for ${taken.client}.`);

  const client = asClient(
    await rows<Record<string, unknown>>(db().from("clients").insert({ name, created_by: input.by }).select("*").single()),
  );
  const added = await db()
    .from("members")
    .insert(people.map((email, i) => ({ client_id: client.id, email, role: i === 0 ? "owner" : "member" })));
  // Not half a client: without its people it goes again.
  if (added.error) {
    await db().from("clients").delete().eq("id", client.id);
    throw new Error(added.error.message);
  }
  return client;
}

export async function updateClient(id: string, patch: { name?: string; instructions?: string; status?: string }): Promise<Client> {
  const current = await getClient(id);
  if (!current) throw new Error("No such client.");
  const name = patch.name !== undefined ? patch.name.trim() || current.name : current.name;
  const instructions = patch.instructions !== undefined ? patch.instructions.slice(0, 20_000) : current.instructions;
  const status = patch.status === "paused" || patch.status === "active" ? patch.status : current.status;
  return asClient(
    await rows<Record<string, unknown>>(db().from("clients").update({ name, instructions, status }).eq("id", id).select("*").single()),
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

/**
 * Puts an address on a client's list, as one of the people added ("member"). Already on
 * it: only its name is updated — added again, the super admin stays the super admin.
 */
export async function addMember(clientId: string, email: string, name?: string): Promise<Member> {
  const [e] = cleanAddresses([email]);
  if (!e) throw new Error("That is not an email address.");
  const [taken] = await takenElsewhere([e], clientId);
  if (taken) throw new Error(`${e} already signs in for ${taken.client}.`);
  const members = () => db().from("members");
  const there = await rows<Record<string, unknown> | null>(members().select("*").eq("client_id", clientId).eq("email", e).maybeSingle());
  if (there) {
    if (!name) return asMember(there);
    return asMember(await rows<Record<string, unknown>>(members().update({ name }).eq("id", String(there.id)).select("*").single()));
  }
  return asMember(
    await rows<Record<string, unknown>>(
      members().insert({ client_id: clientId, email: e, role: "member", ...(name ? { name } : {}) }).select("*").single(),
    ),
  );
}

export async function removeMember(clientId: string, memberId: string): Promise<void> {
  await rows(db().from("members").delete().eq("id", memberId).eq("client_id", clientId));
}

/**
 * Gives someone on a client's list a new address: the same place on it, the same role. The
 * name and last sign-in go with the old address.
 */
export async function changeAddress(clientId: string, memberId: string, email: string): Promise<void> {
  const [e] = cleanAddresses([email]);
  if (!e) throw new Error("That is not an email address.");
  const [taken] = await takenElsewhere([e], clientId);
  if (taken) throw new Error(`${e} already signs in for ${taken.client}.`);
  const changed = await rows<{ id: string }[]>(
    db().from("members").update({ email: e, name: null, last_login_at: null }).eq("id", memberId).eq("client_id", clientId).select("id"),
  );
  if (!changed.length) throw new Error("They are not on this client's list.");
}

/** NDI makes someone on a client's list its super admin; the one before stays on the list. */
export async function makeOwner(clientId: string, memberId: string): Promise<void> {
  const members = () => db().from("members");
  const made = await rows<{ id: string }[]>(members().update({ role: "owner" }).eq("id", memberId).eq("client_id", clientId).select("id"));
  if (!made.length) throw new Error("They are not on this client's list.");
  await rows(members().update({ role: "member" }).eq("client_id", clientId).eq("role", "owner").neq("id", memberId));
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
