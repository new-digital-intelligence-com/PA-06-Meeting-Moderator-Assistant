import { NextResponse } from "next/server";
import { isRunner, runnerAt } from "@/lib/ava";
import { hasDb } from "@/lib/db";
import { AHEAD_MIN_SCORE, passagesText, searchKnowledge } from "@/lib/knowledge";
import { getMeeting } from "@/lib/meeting";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Her search through the client's documents, mid-meeting (the search_knowledge tool her
 * backend calls). Whose documents is decided here, from the meeting she is in — in the
 * seat that asked, so a client never searches another's — never by what the model asks for.
 */
export async function POST(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const { query = "", ahead = false } = (await request.json().catch(() => ({}))) as { query?: string; ahead?: boolean };
  const at = runnerAt(request);
  const meeting = await getMeeting(at);
  if (at.id && meeting.id !== at.id) return NextResponse.json({ error: "That meeting is over.", gone: true }, { status: 409 });
  if (!meeting.client || !hasDb()) {
    return NextResponse.json({ results: "There are no documents for this meeting.", found: 0 });
  }
  if (!query.trim()) return NextResponse.json({ results: "Say what to look for.", found: 0 });
  try {
    if (ahead) {
      // Looked up before she was asked to (her runner, the moment somebody stops talking):
      // only what is close to it, or nothing — a near miss in her notes would mislead her.
      const passages = await searchKnowledge(meeting.client.id, meeting.client.meetingId, query, 4);
      const close = passages.filter((p) => Number(p.score) >= AHEAD_MIN_SCORE);
      return NextResponse.json({ results: close.length ? passagesText(close) : "", found: close.length, best: Number(passages[0]?.score ?? 0) });
    }
    const passages = await searchKnowledge(meeting.client.id, meeting.client.meetingId, query);
    return NextResponse.json({ results: passagesText(passages), found: passages.length });
  } catch (e) {
    console.warn("[knowledge] search failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Search failed." }, { status: 502 });
  }
}
