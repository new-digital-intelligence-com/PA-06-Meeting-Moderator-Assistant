/**
 * Turning passages into vectors, so she can find a passage by what it means rather than
 * by its exact words. OpenAI's embeddings endpoint: text in, numbers out. Nothing is kept
 * at OpenAI — no files, no vector stores; the vectors live in Postgres with the passages.
 */

/** The width of the `embedding` column in db/schema.sql. */
export const DIMENSIONS = 1536;

const model = () => process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

export function canEmbed(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function embed(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set, so documents cannot be made searchable (see .env.example).");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 96) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // `dimensions` keeps a larger model (text-embedding-3-large) the column's width.
      body: JSON.stringify({ model: model(), input: texts.slice(i, i + 96), dimensions: DIMENSIONS }),
      signal: AbortSignal.timeout(45_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { index: number; embedding: number[] }[];
      error?: { message?: string };
    };
    if (!res.ok || !json.data) throw new Error(`OpenAI embeddings failed: ${json.error?.message ?? res.status}`);
    out.push(...json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

/** pgvector's text form, for a `::vector` cast. */
export const vectorLiteral = (v: number[]) => `[${v.join(",")}]`;
