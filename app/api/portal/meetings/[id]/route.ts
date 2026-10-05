import { NextResponse } from "next/server";
import { handle, HttpError, isUuid, portalClient } from "@/lib/auth";
import { listDocuments } from "@/lib/knowledge";
import { hasPreparation, writeBrief } from "@/lib/prepare";
import { cleanPrep, clientMeeting, savePrep } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

async function mine(request: Request, params: Params["params"]) {
  const { clientId } = await portalClient(request);
  const { id } = await params;
  if (!isUuid(id)) throw new HttpError(400, "Which meeting?");
  const meeting = await clientMeeting(clientId, id);
  if (!meeting) throw new HttpError(404, "That meeting is not one of yours.");
  return { clientId, meeting };
}

/** One meeting, with the documents added to its preparation. */
export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId, meeting } = await mine(request, params);
    return NextResponse.json({ meeting, documents: await listDocuments(clientId, meeting.id) });
  });
}

/**
 * Prepares her: the goal, agenda, people, what to avoid, notes. Saving writes her brief
 * there and then, so the client reads back what she will walk in with.
 */
export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { clientId, meeting } = await mine(request, params);
    const { prep } = (await request.json().catch(() => ({}))) as { prep?: unknown };
    const saved = await savePrep(clientId, meeting.id, cleanPrep(prep));
    if (!saved) throw new HttpError(404, "That meeting is not one of yours.");
    const briefed = (await hasPreparation(saved)) ? await writeBrief(saved.id) : saved;
    return NextResponse.json({ meeting: briefed });
  });
}

/** Writes her brief again — after documents were added or removed. */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { meeting } = await mine(request, params);
    if (!(await hasPreparation(meeting))) throw new HttpError(400, "Prepare her first: a goal, an agenda, notes or a document.");
    return NextResponse.json({ meeting: await writeBrief(meeting.id) });
  });
}
