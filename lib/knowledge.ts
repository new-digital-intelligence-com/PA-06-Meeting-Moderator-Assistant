/**
 * A client's knowledge: the documents and links they give Ava, cut into passages she can
 * search by meaning during a meeting.
 *
 * Adding one: keep the file in NDI's Drive (lib/drive.ts), read its text (lib/extract.ts),
 * cut it into overlapping passages, turn each into a vector (lib/embed.ts), store them in
 * Supabase, and summarise the whole for her digest (lib/prepare.ts). Documents added to a
 * meeting's preparation are searched only in that meeting; the rest in all of them.
 */
import { avaGoogle } from "./ava";
import { asKnowledge, count, db, rows, type Client, type Knowledge, type MeetingRow } from "./db";
import { OFFICE, clientFolder, googleText, meetingFolder, ocr, remove, upload } from "./drive";
import { embed, vectorLiteral } from "./embed";
import { MAX_CHARS, extension, isImage, isPdf, isText, linkText, pdfText, plainText } from "./extract";
import { summarise } from "./prepare";

/** Documents one client may keep. */
export const MAX_DOCUMENTS = 300;

/** Overlapping passages of about `size` characters, cut at a paragraph or sentence where possible. */
export function chunk(text: string, size = 1200, overlap = 200): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const half = start + Math.floor(size / 2);
      const window = clean.slice(half, end);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("。"));
      const space = window.lastIndexOf(" ");
      const cut = para >= 0 ? para : sentence >= 0 ? sentence + 1 : space;
      if (cut > 0) end = half + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

export type Source =
  | { kind: "upload"; name: string; mime: string; data: Buffer }
  | { kind: "drive"; name: string; mime: string; data: Buffer; convertTo?: string; link?: string }
  | { kind: "link"; url: string };

/**
 * Adds one document and reads it, start to finish. Returns its row — "ready", or "failed"
 * with the reason; a document that cannot be read is kept so the client sees why.
 */
export async function addDocument(input: {
  client: Client;
  meeting?: MeetingRow | null;
  source: Source;
  by: string;
}): Promise<Knowledge> {
  const { client, meeting, source, by } = input;
  const n = await count(db().from("knowledge").select("id", { count: "exact", head: true }).eq("client_id", client.id));
  if (n >= MAX_DOCUMENTS) throw new Error(`${client.name} already has ${MAX_DOCUMENTS} documents. Remove some first.`);

  const title = source.kind === "link" ? source.url : source.name;
  const row = asKnowledge(
    await rows<Record<string, unknown>>(
      db()
        .from("knowledge")
        .insert({
          client_id: client.id,
          meeting_id: meeting?.id ?? null,
          kind: source.kind,
          title: title.slice(0, 300),
          mime: source.kind === "link" ? "text/html" : source.mime,
          source: source.kind === "link" ? source.url : source.kind === "drive" ? (source.link ?? null) : null,
          created_by: by,
        })
        .select("*")
        .single(),
    ),
  );

  try {
    const read = await readSource(client, meeting ?? null, source);
    let text = read.text.replace(/\u0000/g, "").trim();
    if (text.length < 20) throw new Error("No text could be read from it.");
    const cut = text.length > MAX_CHARS;
    if (cut) text = text.slice(0, MAX_CHARS);

    const passages = chunk(text);
    const vectors = await embed(passages.map((p) => `${read.title}\n\n${p}`));
    // Fifty at a time: each passage carries 1,536 numbers, and a request has to stay small.
    for (let i = 0; i < passages.length; i += 50) {
      const batch = passages.slice(i, i + 50).map((content, j) => ({
        knowledge_id: row.id,
        client_id: client.id,
        meeting_id: meeting?.id ?? null,
        position: i + j,
        content,
        embedding: vectorLiteral(vectors[i + j]),
      }));
      await rows(db().from("chunks").insert(batch));
    }

    let summary: string;
    try {
      summary = await summarise(client.name, read.title, text);
    } catch (e) {
      console.warn("[knowledge] summary failed", e instanceof Error ? e.message : e);
      summary = text.slice(0, 800);
    }
    if (cut) summary += `\n(Only the first ${MAX_CHARS.toLocaleString("en")} characters were read.)`;

    return asKnowledge(
      await rows<Record<string, unknown>>(
        db()
          .from("knowledge")
          .update({
            status: "ready",
            error: null,
            title: read.title.slice(0, 300),
            chars: text.length,
            summary,
            drive_file_id: read.driveId ?? null,
            mime: read.mime ?? row.mime,
          })
          .eq("id", row.id)
          .select("*")
          .single(),
      ),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "It could not be read.";
    console.warn("[knowledge] failed", title, message);
    return asKnowledge(
      await rows<Record<string, unknown>>(
        db().from("knowledge").update({ status: "failed", error: message.slice(0, 500) }).eq("id", row.id).select("*").single(),
      ),
    );
  }
}

/** Keeps the file in Drive where there is one, and returns its text. */
async function readSource(
  client: Client,
  meeting: MeetingRow | null,
  source: Source,
): Promise<{ title: string; text: string; driveId?: string; mime?: string }> {
  if (source.kind === "link") {
    const page = await linkText(source.url);
    return { title: page.title || source.url, text: page.text };
  }

  const { name, mime, data } = source;
  const convertTo = source.kind === "drive" && source.convertTo ? source.convertTo : OFFICE[extension(name)];
  // Before anything is kept: a file she cannot read is refused, not stored.
  const kind = convertTo ? "office" : isPdf(name, mime) ? "pdf" : isImage(name, mime) ? "image" : isText(name, mime) ? "text" : null;
  if (!kind) {
    throw new Error(
      `${extension(name) ? `.${extension(name)} files` : "Files of this kind"} cannot be read yet. PDFs, Word, Excel, PowerPoint, Google files, images and text files can.`,
    );
  }
  const google = await avaGoogle();
  if (!google) {
    if (kind === "office" || kind === "image") {
      throw new Error("Ava's Google account is not connected, and this kind of file is read through her Drive.");
    }
    return { title: name, text: kind === "pdf" ? await pdfText(data) : plainText(data, name, mime) };
  }

  const parent = meeting ? await meetingFolder(google, client, meeting) : await clientFolder(google, client);
  // A Google copy's name drops the Office extension, as Drive's own converted files do.
  const stored = await upload(google, {
    name: convertTo ? name.replace(/\.(docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/i, "") : name,
    mime,
    data,
    parent,
    convertTo,
  });
  // No folder set up: nothing is kept, and the copy was only there to be read.
  const keep = Boolean(parent);
  try {
    let text: string;
    if (kind === "office") text = await googleText(google, stored.id, convertTo!);
    else if (kind === "pdf") {
      text = await pdfText(data);
      // A scan has pages but no text layer: let Drive read the pages.
      if (text.replace(/\[page \d+\]/g, "").trim().length < 100) text = await ocr(google, stored.id);
    } else if (kind === "image") text = await ocr(google, stored.id);
    else text = plainText(data, name, mime);
    return { title: name, text, driveId: keep ? stored.id : undefined, mime: convertTo ?? mime };
  } catch (e) {
    // Unreadable after all: not kept either.
    if (keep) await remove(google, stored.id);
    throw e;
  } finally {
    if (!keep) await remove(google, stored.id);
  }
}

/* ----------------------------------------------------------------- search */

export type Passage = { title: string; content: string; score: number; meeting: boolean };

/**
 * The passages closest in meaning to `query`, from the client's documents and, during a
 * meeting, that meeting's own — by "pa-06".match_chunks() (db/schema.sql). Never another
 * client's: the function filters by client.
 */
export async function searchKnowledge(clientId: string, meetingId: string | null, query: string, limit = 6): Promise<Passage[]> {
  const [embedding] = await embed([query.slice(0, 4000)]);
  const found = await rows<Passage[]>(
    db().rpc("match_chunks", {
      query_embedding: vectorLiteral(embedding),
      p_client: clientId,
      p_meeting: meetingId,
      match_count: limit,
    }),
  );
  // The closest two always; the rest only if they are about the question at all.
  return found.filter((p, i) => i < 2 || Number(p.score) >= MIN_SCORE);
}

/** Below this, a passage shares little more than its language with the question. */
const MIN_SCORE = 0.2;

export function passagesText(passages: Passage[]): string {
  if (!passages.length) return "Nothing in their documents matches that.";
  return passages
    .map((p, i) => `[${i + 1}] From “${p.title}”${p.meeting ? " (for this meeting)" : ""}:\n${p.content}`)
    .join("\n\n");
}

/* ------------------------------------------------------------- the list */

export async function listDocuments(clientId: string, meetingId: string | null = null): Promise<Knowledge[]> {
  const query = db().from("knowledge").select("*").eq("client_id", clientId);
  const found = await rows<Record<string, unknown>[]>(
    (meetingId ? query.eq("meeting_id", meetingId) : query.is("meeting_id", null)).order("created_at", { ascending: false }),
  );
  return found.map(asKnowledge);
}

/** Removes a document, its passages, and its copy in Drive. */
export async function removeDocument(clientId: string, id: string): Promise<Knowledge | null> {
  const removed = await rows<Record<string, unknown> | null>(
    db().from("knowledge").delete().eq("id", id).eq("client_id", clientId).select("*").maybeSingle(),
  );
  const row = removed ? asKnowledge(removed) : null;
  if (row?.drive_file_id) {
    const google = await avaGoogle();
    if (google) await remove(google, row.drive_file_id);
  }
  return row ?? null;
}
