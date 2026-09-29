// Talks to the deployed app. The runner is only her body — deciding what to say, keeping
// the transcript and writing the notes all happen there, exactly as they did when Recall
// was the body. Swapping one body for another did not require a second brain.
import { requireApp } from "./config.mjs";

async function call(method, path, body) {
  const res = await fetch(`${requireApp()}${path}`, {
    method,
    // Her key: the server only lets the runner read her calendar, send mail as her or
    // mark her as attending, since each of those is dangerous from a stranger.
    headers: { "Content-Type": "application/json", "x-ava-key": process.env.AVA_RUNNER_KEY || "" },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A request that never comes back would freeze her mid-meeting.
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data.error ?? text.slice(0, 200)}`);
  return data;
}

/** Brief her: what the meeting is about, who is in it, where it is. */
export const brief = (meeting) => call("PUT", "/api/meeting", meeting);

/** Tell the server she is in the room, as herself — not a rehearsal, not a Recall bot. */
export const attend = () => call("POST", "/api/meeting/control", { command: "attend" });

/**
 * A short-lived session for her face: `{ sessionToken, avatarId }`. The face lip-syncs to
 * her own voice, which is sent to it, so it has no voice of its own.
 *
 * With ANAM_API_KEY and ANAM_AVATAR_ID in bot/.env she asks Anam herself, next to where
 * her ElevenLabs key already lives; otherwise the app asks for her. Her first Teams call
 * showed a black tile because the key on the app's side was wrong — this way her face
 * depends on one file on her own server.
 */
export async function anamSession() {
  const key = process.env.ANAM_API_KEY?.trim();
  const avatarId = process.env.ANAM_AVATAR_ID?.trim();
  if (!key || !avatarId) return call("POST", "/api/anam", { passthrough: true });

  const res = await fetch("https://api.anam.ai/v1/auth/session-token", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ personaConfig: { name: "Ava", avatarId, enableAudioPassthrough: true } }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anam refused the session: ${text.slice(0, 200)}`);
  const { sessionToken } = JSON.parse(text);
  if (!sessionToken) throw new Error("Anam returned no session token");
  return { sessionToken, avatarId };
}

/**
 * Has the control room sent her somewhere? Takes it if so — once — and returns the
 * meeting `{ meetingUrl, title, context, recipients, platform }`, or null.
 */
export const claimDispatch = async (earlySeconds) =>
  (await call("POST", "/api/ava/dispatch", { earlySeconds })).meeting ?? null;

/** Hand over what was heard; get back what to say, if anything. */
export const tick = (body) => call("POST", "/api/moderator/tick", body);

/** GPT-Live handed something over that needs her memory of the meeting: Claude answers. */
export const ask = (asked) => call("POST", "/api/moderator/ask", { asked });

/** The meeting so far — transcript, actions, notes — for GPT-Live's OpenAI backend; `note` adds an action first. */
export const record = (note) => call("POST", "/api/moderator/record", note ? { note } : {});

/** She has left the call. */
export const stop = () => call("POST", "/api/meeting/control", { command: "stop" });

/** Write the notes and send them to the guests. */
export const sendNotes = () => call("POST", "/api/meeting/followup", { mode: "send" });

/** Whether the server is set up to send mail on her behalf with nobody's browser open. */
export const session = () => call("GET", "/api/session");

/** Her upcoming invites, from her own calendar. */
export const upcoming = (hours = 12) => call("GET", `/api/ava/upcoming?hours=${hours}`);
