import { NextResponse, after } from "next/server";
import { appOrigin, handle, HttpError, portalClient } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { count, db } from "@/lib/db";
import { record } from "@/lib/history";
import { detectLang } from "@/lib/languages";
import { elapsed, getMeeting, inMeeting, newId, startMeeting, updateMeeting, type Meeting } from "@/lib/meeting";
import { platformOf } from "@/lib/platform";
import { briefingNow } from "@/lib/prepare";
import { dropNowMeeting, startNowMeeting } from "@/lib/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ava's meeting as a client's page sees it — only when it is theirs — and what they can do
 * about it: send her to a meeting right now, tell her something while she is in it, end it.
 *
 * One meeting at a time, kept in the store (lib/meeting.ts). Another client's meeting is
 * never shown; a page only learns that she is busy.
 */

/** An ended meeting stays on the client's page this long. */
const ENDED_SHOWN_MS = 2 * 60 * 60_000;

function theirs(m: Meeting, clientId: string, now: number): boolean {
  if (m.client?.id !== clientId) return false;
  if (m.status === "ended") return Boolean(m.endedAt && now - m.endedAt < ENDED_SHOWN_MS);
  return inMeeting(m, now);
}

function view(m: Meeting, now: number) {
  return {
    title: m.title,
    meetingUrl: m.meetingUrl,
    platform: platformOf(m.meetingUrl),
    // sent: waiting for her server · joining: on her way in · live: in it · ended
    phase: m.status === "ended" ? "ended" : m.status === "joining" ? (m.dispatch?.takenAt ? "joining" : "sent") : "live",
    from: m.attendedFrom ?? (m.dispatch ? "dispatch" : "calendar"),
    elapsed: elapsed(m, now),
    people: m.stage?.people ?? null,
    transcript: m.transcript.slice(-80).map((l) => ({ id: l.id, speaker: l.speaker, text: l.text, at: l.at })),
    actions: m.actions.map((a) => ({ id: a.id, text: a.text, owner: a.owner ?? null, due: a.due ?? null })),
    notes: m.followUp ? { subject: m.followUp.subject, to: m.followUp.to, sentAt: m.followUp.sentAt ?? null } : null,
    summary: m.summary ?? null,
    endedBy: m.status === "ended" ? (m.endedBy ?? null) : null,
    endedAt: m.endedAt ?? null,
    // Whether there is anything to write up: nothing heard, no notes coming.
    heard: m.transcript.length,
  };
}

export async function GET(request: Request) {
  return handle(async () => {
    const { clientId } = await portalClient(request);
    const m = await getMeeting();
    const now = Date.now();
    return NextResponse.json({ live: theirs(m, clientId, now) ? view(m, now) : null, busy: inMeeting(m, now) });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    const body = (await request.json().catch(() => ({}))) as { action?: string; url?: string; note?: string; text?: string };
    const now = Date.now();

    /**
     * Her, now, in the meeting at this link — for this client, with what she knows about
     * them. No time to pick and no organiser to match: only the client's own people (and
     * NDI) can press it.
     */
    if (body.action === "send") {
      const url = (body.url ?? "").trim();
      if (!platformOf(url)) throw new HttpError(400, "Paste a Google Meet or Microsoft Teams link.");
      if (!process.env.AVA_RUNNER_KEY) throw new HttpError(503, "Ava's server is not set up on this site (AVA_RUNNER_KEY).");
      const client = await getClient(clientId);
      if (!client) throw new HttpError(404, "No such client.");
      if (client.status !== "active") throw new HttpError(409, `Ava is paused for ${client.name}: ask NDI to switch her back on.`);
      const busy = await getMeeting();
      if (inMeeting(busy, now)) {
        throw new HttpError(409, busy.client?.id === clientId ? "She is already in one of your meetings." : "Ava is in another meeting right now. Try again when it ends.");
      }

      const note = (body.note ?? "").trim().slice(0, 4000);
      const title = note.split("\n", 1)[0].trim().slice(0, 80) || `Meeting for ${client.name}`;
      const documents = await count(
        db().from("knowledge").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("meeting_id", null).eq("status", "ready"),
      );
      const row = await startNowMeeting(clientId, { title, meetingUrl: url, by: user.email, note });
      const started = await startMeeting({
        id: newId(),
        title,
        meetingUrl: url,
        context: briefingNow(client, note, documents),
        // Not emailed: the notes are filed with the meeting, on the client's page.
        recipients: [],
        status: "joining",
        dispatch: { at: now },
        attendedFrom: "dispatch",
        client: { id: client.id, name: client.name, meetingId: row.id },
        language: detectLang(`${title}\n${note}`),
      });
      if (!started) {
        // Somebody else's meeting started in the same instant.
        await dropNowMeeting(clientId, row.id).catch(() => undefined);
        throw new HttpError(409, "Ava is in another meeting right now. Try again when it ends.");
      }
      await record({ meeting_id: row.id, kind: "sent_now", by: user.email, detail: { url, note } });
      return NextResponse.json({ live: view(started, now) });
    }

    /** Something she should know, mid-meeting: added to her briefing, so her next answer has it. */
    if (body.action === "tell") {
      const text = (body.text ?? "").trim().slice(0, 2000);
      if (!text) throw new HttpError(400, "Write what she should know.");
      let told = false as boolean;
      await updateMeeting((m) => {
        if (!theirs(m, clientId, now) || m.status === "ended") return;
        m.context = `${m.context}\n\nAdded during the meeting by ${user.email}:\n${text}`;
        told = true;
      });
      if (!told) throw new HttpError(409, "She is not in one of your meetings now.");
      return NextResponse.json({ ok: true });
    }

    /**
     * Ends it: she leaves at once. Not yet picked up by her server, it is called off instead.
     * The notes are written as if she had left by herself — emailed to the invite's guests
     * for a calendar meeting, filed with the meeting either way.
     */
    if (body.action === "end") {
      // Set inside the update; typed wide, or the compiler takes them for null forever.
      let outcome = null as "ended" | "cancelled" | null;
      let nowMeetingId = null as string | null;
      let endedMeetingId = null as string | null;
      await updateMeeting((m) => {
        if (!theirs(m, clientId, now) || m.status === "ended") return;
        if (m.status === "joining" && !m.dispatch?.takenAt) {
          outcome = "cancelled";
          nowMeetingId = m.client?.meetingId ?? null;
          m.status = "draft";
          m.dispatch = undefined;
          m.client = undefined;
          return;
        }
        outcome = "ended";
        endedMeetingId = m.client?.meetingId ?? null;
        m.status = "ended";
        m.endedAt = now;
        m.endedBy = user.email;
        m.dispatch = undefined;
      });
      if (!outcome) throw new HttpError(409, "She is not in one of your meetings now.");
      if (outcome === "cancelled") {
        if (nowMeetingId) await dropNowMeeting(clientId, nowMeetingId).catch(() => undefined);
        return NextResponse.json({ cancelled: true });
      }
      if (endedMeetingId) await record({ meeting_id: endedMeetingId, kind: "ended", by: user.email, detail: { from: "page" } });
      // Her server sees the meeting ended and leaves without writing the notes: the site does,
      // through the same route her server uses — after answering, so the page is not kept waiting.
      const origin = appOrigin(request);
      after(async () => {
        try {
          const res = await fetch(`${origin}/api/meeting/followup`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-ava-key": process.env.AVA_RUNNER_KEY ?? "" },
            body: JSON.stringify({ mode: "send" }),
          });
          if (!res.ok) console.warn("[live] notes:", res.status, (await res.text()).slice(0, 200));
        } catch (e) {
          console.warn("[live] notes not written:", e instanceof Error ? e.message : e);
        }
      });
      return NextResponse.json({ ended: true });
    }

    throw new HttpError(400, "Send her, tell her something, or end it?");
  });
}
