import ControlRoom from "@/components/ControlRoom";
import { timerView } from "@/lib/agenda";
import { getMeeting } from "@/lib/meeting";
import { isConfigured as recallConfigured } from "@/lib/recall";
import { readSession } from "@/lib/session";
import { storeKind } from "@/lib/store";
import { isConfigured as simliConfigured } from "@/lib/simli";

// The meeting lives in this process, so the first paint reads it directly instead of
// bouncing through /api/meeting. The client polls from there.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [meeting, session] = await Promise.all([getMeeting(), readSession()]);
  const publicUrl = process.env.PUBLIC_URL || process.env.APP_URL || "";

  return (
    <ControlRoom
      initialMeeting={meeting}
      initialTimer={timerView(meeting)}
      config={{
        googleConnected: Boolean(session.google),
        email: session.google?.email ?? null,
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        recall: recallConfigured(),
        simli: simliConfigured(),
        elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
        publicUrl,
        publicUrlReachable: Boolean(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl),
        botName: process.env.BOT_NAME || "Ava — Moderator",
        store: storeKind(),
      }}
    />
  );
}
