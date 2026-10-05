/**
 * Ava's homework, done ahead so she walks into a meeting already knowing it.
 *
 *   a summary   of each document, when it is added (the fast model);
 *   the digest  "what Ava knows about <client>", rewritten from those summaries whenever
 *               the documents change;
 *   the brief   for one meeting, from its preparation, its own documents and the digest —
 *               written when the client prepares her, or shortly before the meeting.
 *
 * In the meeting she has the digest and the brief in her instructions, and searches the
 * documents themselves for anything more specific (lib/knowledge.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { db, table, type Client, type MeetingRow, type Prep } from "./db";
import { FAST, WRITER } from "./moderator";

const anthropic = () => new Anthropic();

async function write(model: string, system: string, prompt: string, maxTokens: number): Promise<string> {
  const response = await anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const ABOUT_AVA =
  "Ava is an AI meeting assistant made by NDI (New Digital Intelligence). She joins video meetings as a participant for NDI's clients: she listens, answers when asked, notes the actions and emails the summary afterwards.";

/* ----------------------------------------------------------- per document */

const SUMMARY_INPUT = 60_000;

export async function summarise(clientName: string, title: string, text: string): Promise<string> {
  const cut = text.length > SUMMARY_INPUT;
  return write(
    FAST,
    `${ABOUT_AVA} You read documents a client gives her and note what she may need in their meetings.`,
    [
      `Client: ${clientName}`,
      `Document: ${title}`,
      "",
      text.slice(0, SUMMARY_INPUT),
      cut ? "\n[The document continues; this is its beginning.]" : "",
      "",
      "Summarise it for her: first one line on what the document is, then the facts people may ask about in a meeting — names, roles, products, prices, numbers, dates, decisions, terms — as short lines. At most 220 words. No preamble, nothing that is not in the document.",
    ].join("\n"),
    700,
  );
}

/* ----------------------------------------------------------------- digest */

export async function rebuildDigest(clientId: string): Promise<string> {
  const [client] = await db()<Client[]>`select * from ${table("clients")} where id = ${clientId}`;
  if (!client) throw new Error("No such client.");
  const docs = await db()<{ title: string; summary: string | null; created_at: Date }[]>`
    select title, summary, created_at from ${table("knowledge")}
    where client_id = ${clientId} and meeting_id is null and status = 'ready'
    order by created_at desc limit 200`;

  let digest = "";
  if (docs.length) {
    let budget = 70_000;
    const listed: string[] = [];
    for (const d of docs) {
      const entry = `### ${d.title} (added ${d.created_at.toISOString().slice(0, 10)})\n${d.summary ?? "(no summary)"}`;
      if (entry.length > budget) break;
      budget -= entry.length;
      listed.push(entry);
    }
    digest = await write(
      WRITER,
      `${ABOUT_AVA} You prepare her for a client: from the client's documents you write what she carries into every one of their meetings.`,
      [
        `Client: ${client.name}`,
        `How they want her to work, in their words: ${client.instructions.trim() || "(nothing given)"}`,
        "",
        "Their documents, newest first, each with a summary:",
        listed.join("\n\n"),
        "",
        `Write "What Ava knows about ${client.name}":`,
        "- who they are and what they do, in two or three lines;",
        "- what they offer — products, services, prices and terms where given;",
        "- people and roles mentioned;",
        "- the facts and figures people are most likely to ask about;",
        "- names and terms to get right;",
        "- anything the documents say must not be shared.",
        "Plain text, short headings, short lines, at most 600 words. Only what the documents say. Where two documents disagree, keep the newer and mention the difference.",
      ].join("\n"),
      1800,
    );
  }
  await db()`update ${table("clients")} set digest = ${digest}, digest_at = now() where id = ${clientId}`;
  return digest;
}

/* ------------------------------------------------------------------ brief */

export function prepText(prep: Prep | null | undefined): string {
  if (!prep) return "";
  return [
    prep.goal?.trim() && `Goal: ${prep.goal.trim()}`,
    prep.agenda?.trim() && `Agenda:\n${prep.agenda.trim()}`,
    prep.people?.trim() && `People:\n${prep.people.trim()}`,
    prep.avoid?.trim() && `Avoid:\n${prep.avoid.trim()}`,
    prep.notes?.trim() && `Notes:\n${prep.notes.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const when = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function inviteText(m: MeetingRow): string {
  const people = (m.guests ?? []).map((g) => (g.name ? `${g.name} (${g.email})` : g.email)).join(", ");
  return [
    m.description.trim() || "(The invite had no description.)",
    m.organizer ? `Organised by ${m.organizer_name ? `${m.organizer_name} (${m.organizer})` : m.organizer}.` : "",
    people ? `Invited: ${people}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Whether the meeting gives her anything to prepare from beyond the invite. */
export async function hasPreparation(m: MeetingRow): Promise<boolean> {
  if (prepText(m.prep)) return true;
  const [{ n }] = await db()<{ n: number }[]>`
    select count(*)::int as n from ${table("knowledge")} where meeting_id = ${m.id} and status = 'ready'`;
  return n > 0;
}

/** The brief is out of date when the preparation, its documents or the digest changed after it. */
export async function briefIsStale(m: MeetingRow, client: Client): Promise<boolean> {
  if (!m.brief_at) return true;
  if (m.prep_at && m.prep_at > m.brief_at) return true;
  if (client.digest_at && client.digest_at > m.brief_at) return true;
  const [{ newer }] = await db()<{ newer: number }[]>`
    select count(*)::int as newer from ${table("knowledge")} where meeting_id = ${m.id} and created_at > ${m.brief_at}`;
  return newer > 0;
}

export async function writeBrief(meetingId: string): Promise<MeetingRow> {
  const [m] = await db()<MeetingRow[]>`select * from ${table("meetings")} where id = ${meetingId}`;
  if (!m?.client_id) throw new Error("No such meeting.");
  const [client] = await db()<Client[]>`select * from ${table("clients")} where id = ${m.client_id}`;
  const docs = await db()<{ title: string; summary: string | null }[]>`
    select title, summary from ${table("knowledge")} where meeting_id = ${meetingId} and status = 'ready' order by created_at`;

  const brief = await write(
    WRITER,
    `${ABOUT_AVA} You prepare her for one meeting. She reads your brief just before she joins and works from it in the call, together with what she knows about the client and a search over their documents.`,
    [
      `Client: ${client.name}`,
      `How ${client.name} wants her to work: ${client.instructions.trim() || "(nothing given)"}`,
      "",
      `What she knows about ${client.name}:`,
      client.digest.trim() || "(no documents yet)",
      "",
      "The meeting:",
      `Title: ${m.title}`,
      `When: ${when(m.starts_at)}`,
      inviteText(m),
      "",
      "Their preparation for it:",
      prepText(m.prep) || "(none)",
      "",
      docs.length ? `Documents for this meeting:\n${docs.map((d) => `### ${d.title}\n${d.summary ?? ""}`).join("\n\n")}` : "No documents for this meeting.",
      "",
      "Write her brief for this meeting, addressed to her as “you”:",
      "- the purpose, and what a good outcome looks like;",
      "- the agenda, as she should follow or run it;",
      "- who is attending and what to know about each, where known;",
      "- the facts she is most likely to need;",
      "- what to avoid.",
      "Plain text, short headings, at most 450 words, in the language their preparation is written in (English if there is none). Only what you were given; nothing invented.",
    ].join("\n"),
    1500,
  );
  const [updated] = await db()<MeetingRow[]>`
    update ${table("meetings")} set brief = ${brief}, brief_at = now(), updated_at = now() where id = ${meetingId} returning *`;
  return updated;
}

/**
 * What she is told before she walks in — handed to her runner as the meeting's briefing.
 * The brief when there is one, their preparation otherwise, and always the invite and
 * what she knows about the client.
 */
export function briefingFor(m: MeetingRow, client: Client, documents: number): string {
  const sections = [`You are attending this meeting for ${client.name}.`];
  if (client.instructions.trim()) sections.push(`How ${client.name} wants you to work:\n${client.instructions.trim()}`);
  if (m.brief?.trim()) sections.push(`Your brief for this meeting:\n${m.brief.trim()}`);
  else if (prepText(m.prep)) sections.push(`Their preparation for this meeting:\n${prepText(m.prep)}`);
  sections.push(`From the invite:\n${inviteText(m)}`);
  if (client.digest.trim()) sections.push(`What you know about ${client.name}:\n${client.digest.trim()}`);
  if (documents) {
    sections.push(
      `${client.name}'s documents can be searched during the meeting: look up what you are not sure of before saying you don't know.`,
    );
  }
  return sections.join("\n\n").slice(0, 28_000);
}
