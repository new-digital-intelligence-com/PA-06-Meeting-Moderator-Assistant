import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import type { MeetingRow } from "@/lib/db";
import { meetingHistory, record, type HistoryRow } from "@/lib/history";
import { listDocuments } from "@/lib/knowledge";
import { hasPreparation, writeBrief } from "@/lib/prepare";
import { cleanPrep, clientMeeting, prepLocked, savePrep } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

async function mine(request: Request, params: Params["params"]) {
  const { user, clientId } = await portalClient(request);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(400, "Which meeting?");
  const meeting = await clientMeeting(clientId, id);
  if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");
  return { user, clientId, meeting };
}

/**
 * For a meeting from before its history was kept: what its own row still says — when it
 * reached her calendar, was prepared, briefed, ended, and the notes emailed.
 */
function remembered(m: MeetingRow): HistoryRow[] {
  const out: HistoryRow[] = [];
  const at = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
  const push = (when: string | null, kind: HistoryRow["kind"], by: string | null, detail: Record<string, unknown> = {}) => {
    if (when) out.push({ id: -out.length - 1, at: when, kind, by, detail: { ...detail, recalled: true } });
  };
  push(at(m.created_at), "invited", m.organizer, { title: m.title, starts_at: at(m.starts_at) });
  push(at(m.prep_at), "prepared", null, { prep: m.prep });
  push(at(m.brief_at), "brief", "Ava");
  push(at(m.ended_at), "ended", null);
  const sentAt = m.notes?.sentAt;
  if (sentAt) push(new Date(sentAt).toISOString(), "notes", "Ava", { subject: m.notes?.subject, to: m.notes?.to, sent: true });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** One meeting: its preparation and brief, notes, documents, and everything that happened to it. */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId, meeting } = await mine(request, params);
    const [documents, kept] = await Promise.all([listDocuments(clientId, meeting.id), meetingHistory(meeting.id)]);
    return NextResponse.json({ meeting, documents, history: kept.length ? kept : remembered(meeting) });
  });
}

/**
 * Prepares her: the goal, agenda, people, what to avoid, notes. Saving writes her brief
 * there and then, so the client reads back what she will walk in with. Each version is
 * kept in the meeting's history, with who saved it and what changed. Not from a minute
 * before it starts: then it is what she walks in with.
 */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { user, clientId, meeting } = await mine(request, params);
    const locked = prepLocked(meeting);
    if (locked) throw new HttpError(409, locked);
    const { prep } = (await request.json().catch(() => ({}))) as { prep?: unknown };
    const next = cleanPrep(prep);
    const before = meeting.prep ?? {};
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (next[k] ?? "").trim() !== (before[k] ?? "").trim());
    const saved = await savePrep(clientId, meeting.id, next);
    if (!saved) throw new HttpError(404, "That meeting is not one of yours.");
    if (changed.length) await record({ meeting_id: meeting.id, kind: "prepared", by: user.email, detail: { changed, prep: next } });
    const briefed = (await hasPreparation(saved)) ? await writeBrief(saved.id) : saved;
    return NextResponse.json({ meeting: briefed });
  });
}

/** Writes her brief again — after documents were added or removed. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { meeting } = await mine(request, params);
    const locked = prepLocked(meeting);
    if (locked) throw new HttpError(409, locked);
    if (!(await hasPreparation(meeting))) throw new HttpError(400, "Prepare her first: a goal, an agenda, notes or a document.");
    return NextResponse.json({ meeting: await writeBrief(meeting.id) });
  });
}
