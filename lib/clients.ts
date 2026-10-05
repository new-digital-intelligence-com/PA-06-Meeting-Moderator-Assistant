/**
 * Ava's clients: who they are, who may sign in for them, and which meetings are theirs.
 *
 * A meeting belongs to the client of whoever organised it — an exact address first (a
 * personal account, which cannot be matched by its domain: gmail.com is everybody), then
 * the company domain. The organiser, never a guest: otherwise a stranger could put one
 * client employee on an invite and have Ava for free.
 */
import type postgres from "postgres";
import { avaGoogle } from "./ava";
import { db, table, type Client, type Member } from "./db";
import { sendEmail } from "./workspace";

import { PERSONAL, emailDomain } from "./mail-domains";

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

export async function activeClients(): Promise<Client[]> {
  return db()<Client[]>`select * from ${table("clients")} where status = 'active'`;
}

export async function getClient(id: string): Promise<Client | null> {
  const [c] = await db()<Client[]>`select * from ${table("clients")} where id = ${id}`;
  return c ?? null;
}

export type ClientSummary = Client & {
  members: number;
  documents: number;
  upcoming: number;
  last_meeting: Date | null;
};

export async function listClients(): Promise<ClientSummary[]> {
  return db()<ClientSummary[]>`
    select c.*,
      (select count(*)::int from ${table("members")} m where m.client_id = c.id) as members,
      (select count(*)::int from ${table("knowledge")} k where k.client_id = c.id and k.meeting_id is null) as documents,
      (select count(*)::int from ${table("meetings")} x where x.client_id = c.id and x.starts_at > now() and x.status <> 'cancelled') as upcoming,
      (select max(x.starts_at) from ${table("meetings")} x where x.client_id = c.id and x.starts_at <= now() and x.status <> 'cancelled') as last_meeting
    from ${table("clients")} c order by c.created_at`;
}

export async function listMembers(clientId: string): Promise<Member[]> {
  return db()<Member[]>`select * from ${table("members")} where client_id = ${clientId} order by invited_at`;
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
  return db().begin(async (sql) => {
    const [client] = await sql<Client[]>`
      insert into ${table("clients")} (name, domains, addresses, created_by)
      values (${name}, ${sql.array(domains)}::text[], ${sql.array(addresses)}::text[], ${input.by}) returning *`;
    for (const email of contacts) await addMemberWith(sql, client.id, email);
    return client;
  });
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
  const [c] = await db()<Client[]>`
    update ${table("clients")} set name = ${name}, domains = ${db().array(domains)}::text[], addresses = ${db().array(addresses)}::text[],
      instructions = ${instructions}, status = ${status}
    where id = ${id} returning *`;
  return c;
}

export async function deleteClient(id: string): Promise<void> {
  await db()`delete from ${table("clients")} where id = ${id}`;
}

async function addMemberWith(sql: postgres.ISql, clientId: string, email: string, name?: string): Promise<Member> {
  const e = email.trim().toLowerCase();
  const [taken] = await sql<{ name: string }[]>`
    select c.name from ${table("members")} m join ${table("clients")} c on c.id = m.client_id
    where m.email = ${e} and m.client_id <> ${clientId}`;
  if (taken) throw new Error(`${e} already signs in for ${taken.name}.`);
  const [m] = await sql<Member[]>`
    insert into ${table("members")} as m (client_id, email, name) values (${clientId}, ${e}, ${name ?? null})
    on conflict (email) do update set name = coalesce(excluded.name, m.name) returning *`;
  return m;
}

export async function addMember(clientId: string, email: string, name?: string): Promise<Member> {
  if (!cleanAddresses([email]).length) throw new Error("That is not an email address.");
  return addMemberWith(db(), clientId, email, name);
}

export async function removeMember(clientId: string, memberId: string): Promise<void> {
  await db()`delete from ${table("members")} where id = ${memberId} and client_id = ${clientId}`;
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
