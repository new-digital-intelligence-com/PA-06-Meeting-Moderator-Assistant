/**
 * Recall.ai — the thing that actually gets Ava into the Google Meet.
 *
 * Recall runs a browser in its own infrastructure, joins the meeting with it, and
 * streams a webpage *we* control into the call as the bot's camera. That webpage is
 * `/bot` in this app: her face plus the agenda panel. Whatever it renders and
 * plays is what the room sees and hears.
 *
 * Two consequences worth knowing before debugging anything:
 *
 *  - `/bot` must be reachable from the public internet. On localhost that means a
 *    tunnel (`cloudflared tunnel --url http://localhost:3000`) and PUBLIC_URL set to
 *    the tunnel's address. A bot pointed at http://localhost:3000 joins and shows a
 *    blank tile.
 *  - The bot joins as an anonymous guest and knocks. Somebody in the meeting has to
 *    admit it, and Google now routes suspected bots into a stricter queue, so admit it
 *    promptly or it gives up.
 */

const DEFAULT_REGION = "us-west-2";

export class RecallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function apiKey() {
  const key = process.env.RECALL_API_KEY;
  if (!key) throw new RecallError("RECALL_API_KEY is not set. Add it to .env.local and restart.", 501);
  return key;
}

function base() {
  const region = process.env.RECALL_REGION || DEFAULT_REGION;
  return `https://${region}.recall.ai/api/v1`;
}

/** The public origin Recall's browser will fetch `/bot` from. */
export function publicUrl() {
  const url = process.env.PUBLIC_URL || process.env.APP_URL;
  if (!url) {
    throw new RecallError(
      "PUBLIC_URL is not set. Recall's browser has to load /bot over the internet — start a tunnel (cloudflared tunnel --url http://localhost:3000) and put its https address in PUBLIC_URL.",
      501,
    );
  }
  if (/localhost|127\.0\.0\.1/.test(url)) {
    throw new RecallError(
      `PUBLIC_URL is ${url}, which Recall's browser cannot reach. Use the tunnel's public https address instead.`,
      400,
    );
  }
  return url.replace(/\/$/, "");
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new RecallError(`Recall ${res.status}: ${text.slice(0, 400)}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type RecallBot = {
  id: string;
  status_changes?: { code: string; created_at: string; message?: string | null }[];
};

export async function createBot(meetingUrl: string, opts: { botName?: string } = {}): Promise<RecallBot> {
  const stage = `${publicUrl()}/bot`;

  const body: Record<string, unknown> = {
    meeting_url: meetingUrl,
    bot_name: opts.botName || process.env.BOT_NAME || "Ava — Moderator",
    // The camera, not a screenshare: a screenshare takes over everyone's main stage and
    // makes her the presenter. A camera puts her in a participant tile, like a person.
    output_media: {
      camera: {
        kind: "webpage",
        config: { url: stage },
      },
    },
    // The default instance renders the page on a small machine, and a live photoreal
    // avatar is more than it can keep up with — the symptom is exactly the stutter and
    // dropped audio you get from a CPU-bound browser. Recall's own avatar sample uses
    // the four-core variant for the same reason.
    variant: {
      google_meet: process.env.RECALL_BOT_VARIANT || "web_4_core",
    },
    recording_config: {
      transcript: {
        // Google Meet's own live captions: free, already diarised by the platform, and
        // no second vendor in the path. Swap to recallai_streaming (paid) if the
        // captions prove too lossy — the payload shape is the same either way.
        provider:
          process.env.RECALL_TRANSCRIPT_PROVIDER === "recallai"
            ? { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } }
            : { meeting_captions: {} },
      },
    },
  };

  return call<RecallBot>("/bot/", { method: "POST", body: JSON.stringify(body) });
}

export async function getBot(id: string): Promise<RecallBot> {
  return call<RecallBot>(`/bot/${encodeURIComponent(id)}/`);
}

/** Asks the bot to hang up. Recall keeps the record; only the call is left. */
export async function leaveCall(id: string): Promise<void> {
  await call(`/bot/${encodeURIComponent(id)}/leave_call/`, { method: "POST" });
}

/** The most recent status code Recall reported, for the control room's status line. */
export function latestStatus(bot: RecallBot): string | null {
  const changes = bot.status_changes ?? [];
  return changes.length ? changes[changes.length - 1].code : null;
}

export function isConfigured() {
  return Boolean(process.env.RECALL_API_KEY);
}
