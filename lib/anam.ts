/**
 * Anam — her face and her voice, in one stream.
 *
 * Replaces the Simli + ElevenLabs pair. That arrangement had us synthesising audio in
 * one service, shipping raw PCM to another to be lip-synced, and hoping the two stayed
 * in step across two WebRTC hops. Anam does the speech and the face together, so there
 * is one connection, one clock, and nothing to keep in sync by hand.
 *
 * The important setting here is `llmId: CUSTOMER_CLIENT_V1`. An Anam persona normally
 * ships with its own brain and will happily hold a conversation of its own. We do not
 * want that: the moderator's words come from `lib/agenda.ts` and `lib/moderator.ts`,
 * and nothing else should be able to put words in her mouth in a live meeting.
 * CUSTOMER_CLIENT_V1 turns her brain off and leaves only the voice and face, driven by
 * `talk()` from our side.
 */

const BASE = "https://api.anam.ai/v1";

export class AnamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function apiKey() {
  const key = process.env.ANAM_API_KEY;
  if (!key) throw new AnamError("ANAM_API_KEY is not set. Add it to .env.local and restart.", 501);
  return key;
}

type PersonaDetail = {
  id: string;
  name?: string;
  avatar?: { id: string; displayName?: string };
  voice?: { id: string };
};

/** Personas rarely change; resolving one per session would add a round trip to every join. */
let resolved: { avatarId: string; voiceId: string; name: string } | null = null;

/**
 * Works out which face and voice to use.
 *
 * ANAM_PERSONA_ID is the convenient way in — it is what Anam Lab gives you after you
 * build a persona there, and we read the avatar and voice off it. Setting the avatar
 * and voice ids directly also works and skips the lookup.
 */
async function persona(): Promise<{ avatarId: string; voiceId: string; name: string }> {
  if (resolved) return resolved;

  const avatarId = process.env.ANAM_AVATAR_ID;
  const voiceId = process.env.ANAM_VOICE_ID;
  if (avatarId && voiceId) {
    resolved = { avatarId, voiceId, name: process.env.BOT_NAME?.split("—")[0].trim() || "Ava" };
    return resolved;
  }

  const personaId = process.env.ANAM_PERSONA_ID;
  if (!personaId) {
    throw new AnamError(
      "Set ANAM_PERSONA_ID (from Anam Lab), or ANAM_AVATAR_ID and ANAM_VOICE_ID together.",
      501,
    );
  }

  const res = await fetch(`${BASE}/personas/${encodeURIComponent(personaId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new AnamError(`Anam could not load persona ${personaId}: ${text.slice(0, 200)}`, res.status);

  const detail = JSON.parse(text) as PersonaDetail;
  if (!detail.avatar?.id || !detail.voice?.id) {
    throw new AnamError(
      `Persona "${detail.name ?? personaId}" has no avatar or no voice. Give it both in Anam Lab — an avatar on its own cannot speak on the default transport.`,
      400,
    );
  }

  resolved = {
    avatarId: detail.avatar.id,
    voiceId: detail.voice.id,
    name: process.env.BOT_NAME?.split("—")[0].trim() || detail.name || "Ava",
  };
  return resolved;
}

export type AnamSession = {
  sessionToken: string;
  /** For the stage's status line, so a misconfigured face is obvious on screen. */
  personaName: string;
};

/**
 * A short-lived token for one browser to open one stream. The API key never leaves
 * the server — the token is all the page ever sees.
 */
export async function createSession(): Promise<AnamSession> {
  const { avatarId, voiceId, name } = await persona();

  const res = await fetch(`${BASE}/auth/session-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personaConfig: {
        name,
        avatarId,
        voiceId,
        // Her brain is this application. See the note at the top of the file.
        llmId: "CUSTOMER_CLIENT_V1",
      },
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) throw new AnamError(`Anam refused the session: ${text.slice(0, 300)}`, res.status);

  const { sessionToken } = JSON.parse(text) as { sessionToken?: string };
  if (!sessionToken) throw new AnamError(`Anam returned no session token: ${text.slice(0, 200)}`, 502);

  return { sessionToken, personaName: name };
}

export function isConfigured() {
  return Boolean(
    process.env.ANAM_API_KEY &&
      (process.env.ANAM_PERSONA_ID || (process.env.ANAM_AVATAR_ID && process.env.ANAM_VOICE_ID)),
  );
}
