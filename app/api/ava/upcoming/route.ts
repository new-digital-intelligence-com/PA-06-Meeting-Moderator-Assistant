import { NextResponse, after } from "next/server";
import { avaEmail, avaGoogle, isRunner, noteScreen, noteSeats } from "@/lib/ava";
import { db, hasDb, rows, type Client, type MeetingRow } from "@/lib/db";
import { answerInbox } from "@/lib/inbox";
import { contactsFor, meetingPeople, rememberPeople, type Contact } from "@/lib/contacts";
import { earlierFromFireflies, hasFireflies, importFinished, keepEarlier, type Earlier } from "@/lib/fireflies";
import { briefIsStale, briefingFor, hasPreparation, writeBrief } from "@/lib/prepare";
import { syncCalendar } from "@/lib/schedule";
import { avaInvites, type Invite } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Briefs are written for meetings starting within this long. */
const BRIEF_AHEAD_MS = 45 * 60_000;
/** Briefs are written ahead for meetings starting within this long. */
const BRIEF_DAY_MS = 24 * 3_600_000;

/**
 * Her upcoming invites, for the runner deciding which meeting to walk into next.
 *
 * Runner-only: this is her calendar — titles, descriptions, guest lists. Anybody who
 * found the URL could otherwise read it.
 *
 * With clients set up (Supabase), only her clients' meetings come back, each with
 * the client and the briefing she is to walk in with; invites from anybody else are left
 * for admins to see. Without, every invite, as before. Either way not the ones she
 * declined — and this read is the one that sends her answers to invites (lib/rsvp.ts).
 */
export async function GET(request: Request) {
  if (!isRunner(request)) {
    return NextResponse.json({ error: "Runner key required." }, { status: 403 });
  }
  // Where her logs are, for the admin pages' links — remembered after answering.
  after(() => noteScreen(request).catch(() => undefined));
  // How many meetings her server can be in at once: her answers to invites below count on it.
  await noteSeats(request).catch(() => undefined);
  const google = await avaGoogle();
  if (!google) {
    return NextResponse.json(
      { error: "No Google account is connected. Open the control room and Connect Google as Ava." },
      { status: 409 },
    );
  }
  // Her inbox, once a minute with this read: she answers the people she works for (lib/inbox.ts).
  if (hasDb()) after(() => answerInbox(google).catch(() => undefined));
  const hours = Number(new URL(request.url).searchParams.get("hours") || 12);
  try {
    if (!hasDb()) {
      const invites = (await avaInvites(google, hours)).filter((i) => i.response !== "declined");
      return NextResponse.json({ account: await avaEmail(), invites });
    }

    const { meetings, clients } = await syncCalendar(google, { answer: true });
    const byId = new Map(clients.map((c) => [c.id, c]));
    const horizon = Date.now() + hours * 60 * 60_000;
    const due = meetings.filter(
      (m) => m.client_id && m.status === "upcoming" && byId.get(m.client_id)?.status === "active" && m.starts_at.getTime() <= horizon,
    );

    const counts = await documentCounts(due);
    const who = await whoIsWho(due);
    const lastTimes = await lastTimesOf(due);
    const invites = due.map((m) => {
      const client = byId.get(m.client_id!)!;
      return {
        ...inviteOf(m),
        client: { id: client.id, name: client.name, meetingId: m.id },
        briefing: briefingFor(m, client, counts.get(m.id) ?? 0, who.get(m.id) ?? [], lastTimes.get(m.id) ?? null),
      };
    });
    // The invites' people, by name, on each client's Who's who — there to be written about.
    after(() => rememberInvited(due));

    // Her briefs — written after answering, so the runner is never kept waiting; the next
    // poll carries them. Every meeting of the next day gets one as soon as it has something
    // to brief from; in its last 45 minutes it is brought up to date (refreshBriefs).
    const briefable = meetings.filter(
      (m) => m.client_id && m.status === "upcoming" && byId.get(m.client_id)?.status === "active" && m.starts_at.getTime() <= Date.now() + BRIEF_DAY_MS,
    );
    if (briefable.length) after(() => refreshBriefs(briefable, byId));
    // What Fireflies made of the meetings that have just finished, as it writes them up.
    after(() => importFinished().catch((e) => console.warn("[fireflies] import:", e instanceof Error ? e.message : e)));

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

/**
 * The same meeting's last times from Fireflies, for the briefing of each meeting starting
 * within two hours — what she walks in with. Mostly from the quarter-hour cache her briefs
 * fill; never more than eight seconds' wait, so her runner is not held up.
 */
async function lastTimesOf(meetings: MeetingRow[]): Promise<Map<string, Earlier | null>> {
  const out = new Map<string, Earlier | null>();
  if (!hasFireflies()) return out;
  const soon = meetings.filter((m) => m.starts_at.getTime() - Date.now() < 2 * 3_600_000);
  await Promise.all(
    soon.map(async (m) => {
      const earlier = await Promise.race([
        earlierFromFireflies(m).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]);
      out.set(m.id, earlier);
    }),
  );
  return out;
}

/** Each meeting's people as the client wrote about them (Who's who), one read per client. */
async function whoIsWho(meetings: MeetingRow[]): Promise<Map<string, Contact[]>> {
  const out = new Map<string, Contact[]>();
  const byClient = new Map<string, MeetingRow[]>();
  for (const m of meetings) byClient.set(m.client_id!, [...(byClient.get(m.client_id!) ?? []), m]);
  for (const [clientId, ms] of byClient) {
    const contacts = await contactsFor(clientId, ms.flatMap((m) => meetingPeople(m).map((p) => p.email))).catch(() => []);
    for (const m of ms) {
      const here = new Set(meetingPeople(m).map((p) => p.email.trim().toLowerCase()));
      out.set(m.id, contacts.filter((c) => here.has(c.email)));
    }
  }
  return out;
}

/** Meetings whose people were already added this run: once is enough. */
const remembered = new Set<string>();
async function rememberInvited(meetings: MeetingRow[]) {
  for (const m of meetings) {
    if (remembered.has(m.id)) continue;
    remembered.add(m.id);
    await rememberPeople(m.client_id!, meetingPeople(m)).catch((e) => console.warn("[contacts]", e instanceof Error ? e.message : e));
  }
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

/**
 * Her brief for each meeting of the next day, two at most a minute, soonest first:
 *   - one with no brief gets it as soon as it has something to brief from — its preparation,
 *     or Fireflies' earlier meetings (the same one before, recent ones with its people) —
 *     so the page shows what she will walk in with long before it starts;
 *   - one whose brief has no "Last time" while Fireflies has something — written before
 *     Fireflies, or before it had anything — is rewritten at once;
 *   - in its last 45 minutes it is rewritten if its preparation, documents or digest changed,
 *     if Fireflies has a meeting newer than the brief, or if the brief is over three hours
 *     old and Fireflies has anything: tomorrow's stand-up knows today's.
 */
/** Meetings whose earlier transcripts were already kept searchable this run. */
const keptFor = new Set<string>();

async function refreshBriefs(meetings: MeetingRow[], clients: Map<string, Client>) {
  let written = 0;
  for (const m of [...meetings].sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())) {
    if (written >= 2) break;
    try {
      const client = clients.get(m.client_id!)!;
      const soon = m.starts_at.getTime() - Date.now() < BRIEF_AHEAD_MS;
      const earlier = hasFireflies() ? await earlierFromFireflies(m).catch(() => null) : null;
      const recorded = earlier?.series ?? [];
      // Those last times' transcripts, searchable for her in the meeting — once each.
      if (earlier && recorded.length && !keptFor.has(m.id)) {
        keptFor.add(m.id);
        const added = await keepEarlier(m, earlier).catch((e) => {
          keptFor.delete(m.id);
          console.warn(`[fireflies] transcripts for ${m.title}:`, e instanceof Error ? e.message : e);
          return 0;
        });
        if (added) console.log(`[fireflies] ${added} earlier transcript${added === 1 ? "" : "s"} of ${m.title} made searchable`);
      }
      const briefAt = m.brief_at?.getTime() ?? 0;
      // Not one written in the last half hour: a brief that came out without the heading
      // would otherwise be rewritten every minute.
      const withoutFireflies =
        Boolean(m.brief) && recorded.length > 0 && !/^##\s*Last time/im.test(m.brief ?? "") && Date.now() - briefAt > 30 * 60_000;
      const due =
        !m.brief_at ||
        withoutFireflies ||
        (soon &&
          ((await briefIsStale(m, client)) ||
            recorded.some((f) => Date.parse(f.dateString) > briefAt) ||
            (recorded.length > 0 && Date.now() - briefAt > 3 * 3_600_000)));
      if (!due) continue;
      if (recorded.length || (await hasPreparation(m))) {
        await writeBrief(m.id, earlier);
        written++;
        console.log(`[upcoming] brief written for ${m.title}${recorded.length ? ` (with ${recorded.length} from Fireflies)` : ""}`);
      }
    } catch (e) {
      console.warn(`[upcoming] brief for ${m.title} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
