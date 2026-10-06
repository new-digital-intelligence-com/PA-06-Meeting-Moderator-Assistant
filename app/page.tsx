import ControlRoom, { type Now } from "@/components/ControlRoom";
import TopBar from "@/components/TopBar";
import { requireAdminPage } from "@/lib/auth";
import { inMeeting, minutesIn, seatList, seatMeetings } from "@/lib/meeting";
import { avaEmail, seatCount } from "@/lib/ava";
import { storeKind } from "@/lib/store";

// Read on every visit: what she is doing right now is part of the page.
export const dynamic = "force-dynamic";

/**
 * The control room. The OAuth callback reports back through `?google=` — a failed sign-in
 * is said here rather than leaving the card red with no explanation.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // NDI only: clients have their own page.
  const user = await requireAdminPage();
  const [count, params, avaAccount] = await Promise.all([seatCount(), searchParams, avaEmail()]);
  const publicUrl = process.env.PUBLIC_URL || process.env.APP_URL || "";

  const google = typeof params.google === "string" ? params.google : null;
  const oauthError = google?.startsWith("error:") ? google.slice("error:".length) : null;

  // Each of her seats: the meeting she is in there, if any.
  const seats = seatList(count);
  const held = await seatMeetings(seats);
  const now: Now[] = seats.map((seat) => {
    const meeting = held.find((h) => h.seat === seat)?.meeting;
    const busy = meeting ? inMeeting(meeting) : false;
    return {
      seat,
      busy,
      phase: !meeting || !busy ? null : meeting.status === "joining" ? (meeting.dispatch?.takenAt ? "joining" : "sent") : "live",
      title: meeting && busy ? meeting.title : "",
      client: meeting && busy && meeting.client ? { id: meeting.client.id, name: meeting.client.name } : null,
      minutes: meeting && busy ? minutesIn(meeting) : 0,
    };
  });

  return (
    <>
      <TopBar user={user} active="room" />
      <ControlRoom
        oauthError={oauthError}
        now={now}
        config={{
          publicUrl,
          botName: process.env.BOT_NAME || "Ava — Moderator",
          store: storeKind(),
          // Her own Google account — the one she reads invites from and sends notes as.
          avaAccount,
          avaExpected: process.env.AVA_EMAIL || null,
          runnerKey: Boolean(process.env.AVA_RUNNER_KEY),
        }}
      />
    </>
  );
}
