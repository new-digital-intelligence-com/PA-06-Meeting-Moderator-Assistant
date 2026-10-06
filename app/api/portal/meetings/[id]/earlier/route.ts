import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { db, rows, type MeetingRow } from "@/lib/db";
import { clientMeeting, earlierMeetings } from "@/lib/schedule";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** A recurring meeting's instances share the event id before "_20261006T183500Z". */
const series = (eventId: string) => (eventId.startsWith("now-") ? eventId : eventId.replace(/_\d{8}(T\d{6}Z?)?$/, ""));
const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The client's earlier meetings, for a preparation to look back on: each one's outcome —
 * the notes and actions — and whether it was prepared. Opening one reads the rest from
 * /api/portal/meetings/[id]. The same meeting before (its series, or its title) comes first.
 */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(400, "Which meeting?");
    const meeting = await clientMeeting(clientId, id);
    if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");

    const earlier = await earlierMeetings(clientId, meeting.id);
    const docs = earlier.length
      ? await rows<{ meeting_id: string }[]>(
          db()
            .from("knowledge")
            .select("meeting_id")
            .eq("client_id", clientId)
            .in(
              "meeting_id",
              earlier.map((m) => m.id),
            ),
        )
      : [];
    const same = (m: MeetingRow) => series(m.event_id) === series(meeting.event_id) || sameTitle(m.title, meeting.title);
    const filled = (m: MeetingRow) => Object.values(m.prep ?? {}).some((v) => typeof v === "string" && v.trim());

    return NextResponse.json({
      meetings: earlier
        .map((m) => ({
          id: m.id,
          title: m.title,
          starts_at: m.starts_at,
          status: m.status,
          notes: m.notes
            ? { summary: m.notes.summary ?? null, sentAt: m.notes.sentAt ?? null, to: m.notes.to ?? null, actions: m.notes.actions ?? [] }
            : null,
          prepared: filled(m) || Boolean(m.brief),
          documents: docs.filter((d) => d.meeting_id === m.id).length,
          same: same(m),
        }))
        // Stable: newest first within each group.
        .sort((a, b) => Number(b.same) - Number(a.same)),
    });
  });
}
