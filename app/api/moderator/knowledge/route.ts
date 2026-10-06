import { NextResponse } from "next/server";
import { isRunner, runnerAt } from "@/lib/ava";
import { hasDb } from "@/lib/db";
import { passagesText, searchKnowledge } from "@/lib/knowledge";
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
  const { query = "" } = (await request.json().catch(() => ({}))) as { query?: string };
  const at = runnerAt(request);
  const meeting = await getMeeting(at);
  if (at.id && meeting.id !== at.id) return NextResponse.json({ error: "That meeting is over.", gone: true }, { status: 409 });
  if (!meeting.client || !hasDb()) {
    return NextResponse.json({ results: "There are no documents for this meeting." });
  }
  if (!query.trim()) return NextResponse.json({ results: "Say what to look for." });
  try {
    const passages = await searchKnowledge(meeting.client.id, meeting.client.meetingId, query);
    return NextResponse.json({ results: passagesText(passages), found: passages.length });
  } catch (e) {
    console.warn("[knowledge] search failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Search failed." }, { status: 502 });
  }
}
