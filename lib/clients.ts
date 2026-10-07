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
 * And a client can have company domains: anybody at one is theirs without being added —
 * they sign in to the client's page, and the meetings they organise are the client's.
 * NDI's own client is the one with NDI's domain (ADMIN_DOMAIN). A domain is real (it
 * receives email), never a shared mail provider, and one client's only.
 *
 * A meeting is a client's when its organiser is on the client's list or at its domain —
 * never by a guest, or anybody could put one client employee on an invite and have Ava for
 * free. The list comes first: somebody on one client's list stays that client's.
 */
import { Resolver } from "node:dns/promises";
import { adminDomain, isAdminEmail } from "./auth";
import { avaGoogle } from "./ava";
import { removeLogo } from "./cloudinary";
import { asClient, asMember, db, rows, type Client, type Member } from "./db";
import { PERSONAL, emailDomain } from "./mail-domains";
import { sendEmail } from "./workspace";

export { emailDomain };

/** Domains as typed — "https://www.acme.com/about", "@acme.com" — down to "acme.com". */
export function cleanDomains(input: string[] | string | undefined): string[] {
  const list = Array.isArray(input) ? input : (input ?? "").split(/[\s,;]+/);
  const out = list
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/^@/, "").replace(/[/?#].*$/, ""))
    .filter(Boolean);
  const bad = out.find((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d));
  if (bad) throw new Error(`${bad} is not a domain. It looks like acme.com.`);
  const personal = out.find((d) => PERSONAL.has(d));
  if (personal) throw new Error(`${personal} is a shared mail provider — everybody has an address there. Add the person's exact address instead.`);
  return [...new Set(out)];
}

/**
 * Why a domain is not a real company's — or null when it receives email. Everybody at it
 * signs in and invites her with an address there, so its mail servers are what count, not
 * a website: some companies' sites live elsewhere.
 */
async function notReal(domain: string): Promise<string | null> {
  const dns = new Resolver({ timeout: 4000, tries: 2 });
  try {
    const mx = await dns.resolveMx(domain);
    // "." or nothing: a domain that says it takes no email (RFC 7505).
    return mx.some((r) => r.exchange && r.exchange !== ".") ? null : `${domain} receives no email, so nobody can have an address there.`;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND") return `${domain} does not exist — check the spelling.`;
    if (code === "ENODATA") return `${domain} receives no email, so nobody can have an address there.`;
    return `${domain} could not be checked just now (${code ?? "no answer"}) — try again in a moment.`;
  }
}

/**
 * A client's company domains, checked: typed as domains, not a shared mail provider, not
 * NDI's (but for NDI's own client), not another client's, and — those not already theirs —
 * real. Another client is named to NDI only.
 */
export async function domainsFor(clientId: string | null, input: string[] | string | undefined, { admin }: { admin: boolean }): Promise<string[]> {
  const domains = cleanDomains(input);
  const clients = await allClients();
  const current = clients.find((c) => c.id === clientId);
  for (const d of domains) {
    if (current?.domains.includes(d)) continue;
    if (d === adminDomain()) throw new Error(`${d} is NDI's own domain.`);
    const other = clients.find((c) => c.id !== clientId && c.domains.includes(d));
    if (other) throw new Error(admin ? `${d} is ${other.name}'s domain already.` : `${d} is another company's domain on Ava.`);
    const why = await notReal(d);
    if (why) throw new Error(why);
  }
  return domains;
}

/** The client whose company domain an address is at, of these. */
export function clientAtDomain(clients: Client[], email: string): Client | null {
  const d = emailDomain(email);
  return d ? (clients.find((c) => c.domains.includes(d)) ?? null) : null;
}

export function cleanAddresses(input: string[] | string | undefined): string[] {
  const list = Array.isArray(input) ? input : (input ?? "").split(/[\s,;]+/);
  return [...new Set(list.map((a) => a.trim().toLowerCase()).filter((a) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(a)))];
}

/**
 * The active client an organiser's address belongs to (or a paused one too), from lists
 * loaded once: the clients, and who can use her for each (`people`, address → client id).
 * Somebody on a client's list first, from any address; then anybody at a client's domain.
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
  return clientAtDomain(active, e);
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
 * her ("member"); and its company domains, if any. Nobody already on another client's list
 * or at another client's domain, and nobody at NDI.
 */
export async function createClient(input: {
  name: string;
  owner?: string;
  contacts?: string[] | string;
  domains?: string[] | string;
  by: string;
}): Promise<Client> {
  const name = input.name.trim();
  if (!name) throw new Error("Give the client a name.");
  const [owner] = cleanAddresses([input.owner ?? ""]);
  if (!owner) throw new Error("Add their super admin's email address: the person who runs Ava for them.");
  const people = [owner, ...cleanAddresses(input.contacts).filter((e) => e !== owner)];
  const ndi = people.find((e) => isAdminEmail(e));
  if (ndi) throw new Error(`${ndi} is NDI's: NDI already sees every client, so it is on no client's list.`);
  const domains = await domainsFor(null, input.domains, { admin: true });
  // The super admin can be at it; anybody else there needs no place on the list.
  const atOwn = people.slice(1).find((e) => domains.includes(emailDomain(e)));
  if (atOwn) throw new Error(`${atOwn} is at @${emailDomain(atOwn)}, their company domain: they have access already — leave them out.`);
  const clients = await allClients();
  for (const e of people) {
    const theirs = clientAtDomain(clients, e);
    if (theirs) throw new Error(`${e} is at @${emailDomain(e)}, ${theirs.name}'s domain.`);
  }
  const [taken] = await takenElsewhere(people, null);
  if (taken) throw new Error(`${taken.email} already signs in for ${taken.client}.`);

  const client = asClient(
    await rows<Record<string, unknown>>(db().from("clients").insert({ name, domains, created_by: input.by }).select("*").single()),
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

/** `domains`: already checked (domainsFor). */
export async function updateClient(
  id: string,
  patch: { name?: string; instructions?: string; status?: string; domains?: string[] },
): Promise<Client> {
  const current = await getClient(id);
  if (!current) throw new Error("No such client.");
  const name = patch.name !== undefined ? patch.name.trim() || current.name : current.name;
  const instructions = patch.instructions !== undefined ? patch.instructions.slice(0, 20_000) : current.instructions;
  const status = patch.status === "paused" || patch.status === "active" ? patch.status : current.status;
  const domains = patch.domains ?? current.domains;
  return asClient(
    await rows<Record<string, unknown>>(db().from("clients").update({ name, instructions, status, domains }).eq("id", id).select("*").single()),
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
