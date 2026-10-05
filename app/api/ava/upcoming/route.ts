import { NextResponse, after } from "next/server";
import { avaEmail, avaGoogle, isRunner } from "@/lib/ava";
import { db, hasDb, rows, type Client, type MeetingRow } from "@/lib/db";
import { briefIsStale, briefingFor, hasPreparation, writeBrief } from "@/lib/prepare";
import { syncCalendar } from "@/lib/schedule";
import { avaInvites, type Invite } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Briefs are written for meetings starting within this long. */
const BRIEF_AHEAD_MS = 45 * 60_000;

/**
 * Her upcoming invites, for the runner deciding which meeting to walk into next.
 *
 * Runner-only: this is her calendar — titles, descriptions, guest lists. Anybody who
 * found the URL could otherwise read it.
 *
 * With clients set up (Supabase), only her clients' meetings come back, each with
 * the client and the briefing she is to walk in with; invites from anybody else are left
 * for admins to see. Without, every invite, as before.
 */
export async function GET(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  const google = await avaGoogle();
  if (!google) {
    return NextResponse.json(
      { error: "No Google account is connected. Open the control room and Connect Google as Ava." },
      { status: 409 },
    );
  }
  const hours = Number(new URL(request.url).searchParams.get("hours") || 12);
  try {
    if (!hasDb()) return NextResponse.json({ account: await avaEmail(), invites: await avaInvites(google, hours) });

    const { meetings, clients } = await syncCalendar(google);
    const byId = new Map(clients.map((c) => [c.id, c]));
    const horizon = Date.now() + hours * 60 * 60_000;
    const due = meetings.filter(
      (m) => m.client_id && m.status === "upcoming" && byId.get(m.client_id)?.status === "active" && m.starts_at.getTime() <= horizon,
    );

    const counts = await documentCounts(due);
    const invites = due.map((m) => {
      const client = byId.get(m.client_id!)!;
      return {
        ...inviteOf(m),
        client: { id: client.id, name: client.name, meetingId: m.id },
        briefing: briefingFor(m, client, counts.get(m.id) ?? 0),
      };
    });

    // Her brief for a meeting about to start, if its preparation changed since — written
    // after answering, so the runner is never kept waiting; the next poll carries it.
    const soon = due.filter((m) => m.starts_at.getTime() - Date.now() < BRIEF_AHEAD_MS);
    if (soon.length) after(() => refreshBriefs(soon, byId));

    return NextResponse.json({ account: await avaEmail(), invites });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Calendar failed." }, { status: 502 });
  }
}

function inviteOf(m: MeetingRow): Invite {
  return {
    id: m.event_id,
    title: m.title,
    start: m.starts_at.getTime(),
    end: (m.ends_at ?? m.starts_at).getTime(),
    meetingUrl: m.meeting_url ?? "",
    description: m.description,
    organizer: m.organizer_name || m.organizer || "",
    organizerEmail: m.organizer ?? "",
    guests: m.guests ?? [],
  };
}

/** Documents she can search in each meeting: the client's, and the meeting's own. */
async function documentCounts(meetings: MeetingRow[]): Promise<Map<string, number>> {
  if (!meetings.length) return new Map();
  const docs = await rows<{ client_id: string; meeting_id: string | null }[]>(
    db()
      .from("knowledge")
      .select("client_id, meeting_id")
      .eq("status", "ready")
      .in("client_id", [...new Set(meetings.map((m) => m.client_id!))]),
  );
  return new Map(
    meetings.map((m) => [m.id, docs.filter((d) => d.client_id === m.client_id && (d.meeting_id === null || d.meeting_id === m.id)).length]),
  );
}

async function refreshBriefs(meetings: MeetingRow[], clients: Map<string, Client>) {
  for (const m of meetings.slice(0, 2)) {
    try {
      const client = clients.get(m.client_id!)!;
      if ((await hasPreparation(m)) && (await briefIsStale(m, client))) {
        await writeBrief(m.id);
        console.log(`[upcoming] brief written for ${m.title}`);
      }
    } catch (e) {
      console.warn(`[upcoming] brief for ${m.title} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
