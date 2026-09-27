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

/** A short-lived token for her face and voice. */
export const anamToken = async () => (await call("POST", "/api/anam")).sessionToken;

/** Hand over what was heard; get back what to say, if anything. */
export const tick = (body) => call("POST", "/api/moderator/tick", body);

/** She has left the call. */
export const stop = () => call("POST", "/api/meeting/control", { command: "stop" });

/** Write the notes and send them to the guests. */
export const sendNotes = () => call("POST", "/api/meeting/followup", { mode: "send" });

/** Whether the server is set up to send mail on her behalf with nobody's browser open. */
export const session = () => call("GET", "/api/session");

/** Her upcoming invites, from her own calendar. */
export const upcoming = (hours = 12) => call("GET", `/api/ava/upcoming?hours=${hours}`);
