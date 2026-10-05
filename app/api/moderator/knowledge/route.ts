import { NextResponse } from "next/server";
import { isRunner } from "@/lib/ava";
import { hasDb } from "@/lib/db";
import { passagesText, searchKnowledge } from "@/lib/knowledge";
import { getMeeting } from "@/lib/meeting";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Her search through the client's documents, mid-meeting (the search_knowledge tool her
 * backend calls). Whose documents is decided here, from the meeting she is in — never
 * by what the model asks for.
 */
export async function POST(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const { query = "" } = (await request.json().catch(() => ({}))) as { query?: string };
  const meeting = await getMeeting();
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
