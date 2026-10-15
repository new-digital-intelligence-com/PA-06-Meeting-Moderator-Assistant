/**
 * Who's who: the people in a client's meetings, by address, and what Ava should know about
 * each — written on the client's page (the Who's who tab, or a meeting's preparation, where
 * each guest's line is the same one) and kept for every meeting they are in. Names come by
 * themselves, from the invites and from Fireflies; what to know about somebody only from
 * people. In her brief and her briefing for every meeting they are invited to.
 *
 * Kept in "pa-06".contacts (db/schema.sql). Until that table is there nothing is kept, the
 * briefing goes without, and the page says the table is missing.
 */
import { db, isoNow, rows } from "./db";

export type Contact = {
  email: string;
  name: string | null;
  info: string;
  updated_at: string | null;
  updated_by: string | null;
};

/** The table not created yet (PostgREST: not in its schema cache). */
const missing = (e: unknown) => /contacts|PGRST205|42P01|schema cache|does not exist/i.test(e instanceof Error ? e.message : String(e));

export const cleanEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Not worth a line: her, and meeting rooms. */
export const isPerson = (e: string) => isEmail(e) && !e.startsWith("ava@") && !e.includes("resource.calendar.google.com");

const COLUMNS = "email, name, info, updated_at, updated_by";

/** Whether the table is there yet. */
export async function contactsReady(): Promise<boolean> {
  try {
    await rows(db().from("contacts").select("id").limit(1));
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}

/** Everybody the client has a line for, by name. */
export async function listContacts(clientId: string): Promise<Contact[]> {
  try {
    return await rows<Contact[]>(db().from("contacts").select(COLUMNS).eq("client_id", clientId).order("name", { ascending: true, nullsFirst: false }).order("email"));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

/** The lines for these addresses — the people of one meeting. */
export async function contactsFor(clientId: string, emails: string[]): Promise<Contact[]> {
  const wanted = [...new Set(emails.map(cleanEmail).filter(isPerson))];
  if (!wanted.length) return [];
  try {
    return await rows<Contact[]>(db().from("contacts").select(COLUMNS).eq("client_id", clientId).in("email", wanted.slice(0, 200)));
  } catch (e) {
    if (missing(e)) return [];
    throw e;
  }
}

/** Writes one person's line — their name and what to know about them. */
export async function saveContact(clientId: string, input: { email?: unknown; name?: unknown; info?: unknown }, by: string): Promise<Contact> {
  const email = cleanEmail(input.email);
  if (!isEmail(email)) throw new Error("That is not an email address.");
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) || null : undefined;
  const info = typeof input.info === "string" ? input.info.trim().slice(0, 4000) : undefined;
  try {
    return await rows<Contact>(
      db()
        .from("contacts")
        .upsert(
          { client_id: clientId, email, ...(name !== undefined ? { name } : {}), ...(info !== undefined ? { info } : {}), updated_at: isoNow(), updated_by: by },
          { onConflict: "client_id,email" },
        )
        .select(COLUMNS)
        .single(),
    );
  } catch (e) {
    if (missing(e)) throw new Error("Who's who is not set up yet: NDI has to add its table (db/schema.sql) first.");
    throw e;
  }
}

export async function removeContact(clientId: string, email: unknown): Promise<void> {
  const address = cleanEmail(email);
  try {
    await rows(db().from("contacts").delete().eq("client_id", clientId).eq("email", address));
  } catch (e) {
    if (!missing(e)) throw e;
  }
}

/**
 * Adds the people seen in a meeting — from its invite, or Fireflies — with their names, so
 * they are there to write about. Never changes a line somebody wrote.
 */
export async function rememberPeople(clientId: string, people: { email?: string | null; name?: string | null }[]): Promise<void> {
  const seen = new Map<string, string | null>();
  for (const p of people) {
    const email = cleanEmail(p.email);
    if (!isPerson(email)) continue;
    const name = p.name?.trim() && !p.name.includes("@") ? p.name.trim().slice(0, 120) : null;
    if (!seen.has(email) || (!seen.get(email) && name)) seen.set(email, name);
  }
  if (!seen.size) return;
  try {
    await rows(
      db()
        .from("contacts")
        .upsert(
          [...seen].map(([email, name]) => ({ client_id: clientId, email, name, info: "", updated_by: "Ava" })),
          { onConflict: "client_id,email", ignoreDuplicates: true },
        ),
    );
    // A name learnt later fills one that was missing — never replaces one.
    for (const [email, name] of seen) {
      if (name) await rows(db().from("contacts").update({ name }).eq("client_id", clientId).eq("email", email).is("name", null));
    }
  } catch (e) {
    if (!missing(e)) throw e;
  }
}

/** For her briefing: one line per person somebody wrote about. */
export function contactsText(contacts: Contact[]): string {
  return contacts
    .filter((c) => c.info.trim())
    .map((c) => `- ${c.name ? `${c.name} (${c.email})` : c.email}: ${c.info.trim().replace(/\s*\n\s*/g, " ")}`)
    .join("\n");
}

/** The people of a meeting, by address: the organiser and the guests — not her, not rooms. */
export const meetingPeople = (m: { organizer: string | null; organizer_name?: string | null; guests: { email: string; name?: string }[] | null }) =>
  [{ email: m.organizer ?? "", name: m.organizer_name ?? undefined }, ...(m.guests ?? [])].filter((p) => isPerson(cleanEmail(p.email)));
