/**
 * What the assistant sidebar may answer from: a compact snapshot of the data the asker can
 * already see in the app, read with the app's own functions. A client gets their own
 * company's workspace — the same as /api/portal/* gives them; an NDI admin gets the client
 * they are looking at, or the clients and her seats; the public walkthrough gets its
 * fictional example and nothing else.
 */
import { accessFor, isAdminEmail } from "../auth";
import { seatCount } from "../ava";
import { getClient, listClients, listMembers } from "../clients";
import { listContacts } from "../contacts";
import { hasDb, type Knowledge, type MeetingRow } from "../db";
import { meetingHistory } from "../history";
import { listDocuments } from "../knowledge";
import { inMeeting, minutesIn, seatList, seatMeetings, type Meeting } from "../meeting";
import { PLATFORM_NAME, platformOf } from "../platform";
import { PREVIEW_STEPS } from "../preview";
import { clientMeeting, clientMeetings, prepLocked } from "../schedule";
import { AssistantError, type Asker, type AssistantInput, type Snapshot } from "./core";
import { clip, fit, resolveScope } from "./snapshot";

const iso = (d: Date | string | number | null | undefined) => (d ? new Date(d).toISOString() : null);

/** An ended meeting stays on the client's page this long (as app/api/portal/live). */
const ENDED_SHOWN_MS = 2 * 60 * 60_000;

function person(p: { email?: string | null; name?: string | null }) {
  return p.name && p.email ? `${p.name} <${p.email}>` : (p.email ?? p.name ?? null);
}

type Notes = {
  subject?: string;
  body?: string;
  summary?: string;
  sentAt?: number;
  to?: string;
  actions?: { text?: string; owner?: string; due?: string }[];
  fireflies?: { overview?: string; actions?: string; url?: string | null };
};

/** One meeting as the prompt gets it: more of it when it is the one on screen. */
function meeting(m: MeetingRow, detail: boolean) {
  const n = (m.notes ?? null) as Notes | null;
  const long = detail ? 2.5 : 1;
  const platform = platformOf(m.meeting_url);
  return {
    id: m.id,
    title: m.title,
    starts_at: iso(m.starts_at),
    ends_at: iso(m.ends_at),
    status: m.status,
    where: platform ? PLATFORM_NAME[platform] : null,
    organizer: person({ email: m.organizer, name: m.organizer_name }),
    guests: (m.guests ?? []).slice(0, detail ? 40 : 15).map(person),
    description: clip(m.description, 300 * long),
    preparation: m.prep
      ? {
          goal: clip(m.prep.goal, 400 * long),
          agenda: clip(m.prep.agenda, 600 * long),
          people: clip(m.prep.people, 400 * long),
          avoid: clip(m.prep.avoid, 300 * long),
          notes: clip(m.prep.notes, 400 * long),
        }
      : null,
    prepared_at: iso(m.prep_at),
    preparation_locked: prepLocked(m),
    brief_what_she_walks_in_with: clip(m.brief, 900 * long),
    brief_at: iso(m.brief_at),
    notes: n
      ? {
          subject: clip(n.subject, 200),
          sent_at: iso(n.sentAt),
          summary: clip(n.summary, 700 * long),
          body: detail ? clip(n.body, 2500) : undefined,
          actions: (n.actions ?? []).slice(0, 30).map((a) => ({ text: clip(a.text, 300), owner: a.owner ?? null, due: a.due ?? null })),
          fireflies: n.fireflies ? { overview: clip(n.fireflies.overview, 600 * long), actions: clip(n.fireflies.actions, 600 * long) } : undefined,
        }
      : null,
    ended_at: iso(m.ended_at),
  };
}

function documentOf(d: Knowledge) {
  return { title: d.title, kind: d.kind, status: d.status, added: iso(d.created_at), summary: clip(d.summary, 500), characters: d.chars };
}

/** Her meeting right now, when it is this client's — as their page's live panel shows it. */
async function liveFor(clientId: string) {
  const held = await seatMeetings(seatList(await seatCount()));
  const now = Date.now();
  const theirs = (m: Meeting) =>
    m.client?.id === clientId && (m.status === "ended" ? Boolean(m.endedAt && now - m.endedAt < ENDED_SHOWN_MS) : inMeeting(m, now));
  const found = held.map((h) => h.meeting).filter(theirs);
  const m = found.find((x) => x.status !== "ended") ?? found[0];
  if (!m) return null;
  return {
    title: m.title,
    phase: m.status === "ended" ? "ended" : m.status === "joining" ? (m.dispatch?.takenAt ? "joining" : "sent") : "live",
    minutes_in: minutesIn(m, now),
    actions: m.actions.slice(0, 40).map((a) => ({ text: clip(a.text, 300), owner: a.owner ?? null, due: a.due ?? null })),
    summary: clip(m.summary, 1500),
    recent_transcript: m.transcript.slice(-30).map((l) => `${l.speaker}: ${clip(l.text, 300)}`),
  };
}

async function clientSnapshot(clientId: string, meetingId: string | null, as: "client" | "admin", input: AssistantInput): Promise<Snapshot> {
  const client = await getClient(clientId);
  if (!client) throw new AssistantError(404, "That client could not be found.", "not_found");
  const selected = meetingId ? await clientMeeting(clientId, meetingId) : null;
  const [meetings, documents, members, contacts, live, selectedDocs, history] = await Promise.all([
    clientMeetings(clientId),
    listDocuments(clientId),
    listMembers(clientId),
    listContacts(clientId),
    liveFor(clientId).catch(() => null),
    selected ? listDocuments(clientId, selected.id) : Promise.resolve([]),
    selected ? meetingHistory(selected.id) : Promise.resolve([]),
  ]);
  const now = Date.now();
  const upcoming = meetings.filter((m) => m.starts_at.getTime() >= now && m.id !== selected?.id);
  const past = meetings
    .filter((m) => m.starts_at.getTime() < now && m.id !== selected?.id)
    .sort((a, b) => b.starts_at.getTime() - a.starts_at.getTime());

  const data = fit(
    {
      viewer: as === "admin" ? "NDI admin looking at this client's workspace" : "member of this client",
      client: {
        name: client.name,
        status: client.status,
        company_domains: client.domains,
        how_she_works_for_you_instructions: clip(client.instructions, 3000),
        what_ava_knows_digest: clip(client.digest, 6000),
        digest_updated: iso(client.digest_at),
      },
      meeting_on_screen: selected
        ? {
            ...meeting(selected, true),
            documents_for_this_meeting: selectedDocs.slice(0, 30).map(documentOf),
            history: history.slice(-40).map((h) => ({ at: h.at, what: h.kind, by: h.by })),
          }
        : meetingId
          ? "The meeting on screen is not one of this client's meetings, or it was removed."
          : undefined,
      her_meeting_now: live ?? "Ava is not in one of this client's meetings right now.",
      upcoming_meetings_next_14_days: upcoming.map((m) => meeting(m, false)),
      past_meetings_last_30_days: past.map((m) => meeting(m, false)),
      documents_what_she_knows: documents.map(documentOf),
      whos_who: contacts.map((c) => ({ person: person(c), line: clip(c.info, 400) })),
      people_who_can_use_her: members.map((m) => ({ person: person(m), role: m.role === "owner" ? "super admin" : m.role })),
    },
    input.message,
  );
  return {
    scope: as === "admin" ? "admin" : "client",
    label: `the workspace of the client "${client.name}"${as === "admin" ? ", seen by an NDI admin" : ", seen by one of its members"}. Meetings cover the last 30 days and the next 14 days, as the Meetings tab does.`,
    data,
  };
}

async function clientsOverview() {
  const clients = await listClients();
  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    super_admin: c.owner,
    company_domains: c.domains,
    people: c.members,
    documents: c.documents,
    upcoming_meetings: c.upcoming,
    last_meeting: iso(c.last_meeting),
  }));
}

async function seatsNow() {
  const seats = seatList(await seatCount());
  const held = await seatMeetings(seats);
  const now = Date.now();
  return seats.map((seat) => {
    const m = held.find((h) => h.seat === seat)?.meeting;
    const busy = m ? inMeeting(m, now) : false;
    return busy && m
      ? {
          seat,
          busy,
          phase: m.status === "joining" ? (m.dispatch?.takenAt ? "joining" : "sent") : "live",
          title: m.title,
          client: m.client?.name ?? null,
          minutes_in: minutesIn(m, now),
        }
      : { seat, busy: false };
  });
}

function previewSnapshot(): Snapshot {
  return {
    scope: "preview",
    label:
      "the public walkthrough's fictional example only (the Cedar project review). It is not real data: there are no real clients, meetings or people here. For real meetings the user must sign in with workspace access.",
    data: {
      page: "Public walkthrough (/preview)",
      example: PREVIEW_STEPS,
      note: "The walkthrough does not join a meeting, record audio or send messages. Signing in with Google shows this preview; client and staff permissions decide access to the real workspace.",
    },
  };
}

/** The snapshot for this asker and page — only what they may already see. */
export async function buildSnapshot(asker: Asker, input: AssistantInput): Promise<Snapshot> {
  const scope = await resolveScope(asker, input.context, { access: accessFor, isAdmin: isAdminEmail });
  if (scope.kind === "preview") return previewSnapshot();
  if (!hasDb()) {
    return {
      scope: scope.kind === "client" ? scope.as : "admin",
      label: "nothing: the app's data store is not configured on this server.",
      data: { note: "Clients, meetings and documents are not available on this server (no database is configured). Say so if asked about them." },
    };
  }
  if (scope.kind === "client") return clientSnapshot(scope.clientId, scope.meetingId, scope.as, input);
  if (scope.kind === "clients") {
    return {
      scope: "admin",
      label: "NDI's list of clients (/admin), seen by an NDI admin.",
      data: fit({ page: "Clients (/admin)", clients: await clientsOverview() }, input.message),
    };
  }
  const [seats, clients] = await Promise.all([seatsNow().catch(() => "Her seats could not be read."), clientsOverview()]);
  return {
    scope: "admin",
    label: "NDI's control room (/): her seats right now and the clients, seen by an NDI admin.",
    data: fit({ page: "Control room (/)", her_seats_now: seats, clients }, input.message),
  };
}
