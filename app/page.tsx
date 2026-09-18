import ControlRoom from "@/components/ControlRoom";
import { timerView } from "@/lib/agenda";
import { getMeeting } from "@/lib/meeting";
import { isConfigured as recallConfigured } from "@/lib/recall";
import { readSession } from "@/lib/session";
import { storeKind } from "@/lib/store";
import { isConfigured as anamConfigured } from "@/lib/anam";

// The meeting lives in this process, so the first paint reads it directly instead of
// bouncing through /api/meeting. The client polls from there.
export const dynamic = "force-dynamic";

/**
 * The OAuth callback reports back through `?google=`, and until now nothing read it —
 * a failed sign-in just left the pill red with no explanation. Reading it here rather
 * than from `window` keeps it out of the client's render path.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [meeting, session, params] = await Promise.all([getMeeting(), readSession(), searchParams]);
  const publicUrl = process.env.PUBLIC_URL || process.env.APP_URL || "";

  const google = typeof params.google === "string" ? params.google : null;
  const oauthError = google?.startsWith("error:") ? google.slice("error:".length) : null;

  return (
    <ControlRoom
      initialMeeting={meeting}
      initialTimer={timerView(meeting)}
      oauthError={oauthError}
      config={{
        googleConnected: Boolean(session.google),
        email: session.google?.email ?? null,
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        recall: recallConfigured(),
        anam: anamConfigured(),
        publicUrl,
        publicUrlReachable: Boolean(publicUrl) && !/localhost|127\.0\.0\.1/.test(publicUrl),
        botName: process.env.BOT_NAME || "Ava — Moderator",
        store: storeKind(),
        // Both are needed to complete a sign-in, and a missing one fails it silently:
        // without SESSION_SECRET the callback cannot encrypt the cookie it just earned.
        sessionSecret: Boolean(process.env.SESSION_SECRET),
        googleClient: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        googleRedirectUri:
          process.env.GOOGLE_REDIRECT_URI ?? `${publicUrl || "http://localhost:3000"}/api/auth/google/callback`,
      }}
    />
  );
}
