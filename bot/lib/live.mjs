// OpenAI GPT-Live: her ears and voice when AVA_BRAIN=live. One model hears the meeting and
// talks, over one live connection — it listens while it speaks ("full duplex"), so it
// takes turns, stops when talked over and backchannels by itself. What needs more
// thought or her memory of the meeting it hands to a backend ("delegation"): an OpenAI
// model that OpenAI runs for it, or Claude through the app.
//
// This file is only the connection. What she is told, when she may speak and where her
// voice goes are decided in meet.mjs.

const LIVE_URL = "wss://api.openai.com/v1/live/sessions";
export const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || "gpt-live-1";
export const VOICE = process.env.OPENAI_VOICE || "gleam";
/** Who answers what she hands over: an OpenAI model (OpenAI runs it), or "claude" (the app). */
export const DELEGATE = (process.env.OPENAI_DELEGATION_MODEL || "gpt-6-luna").trim();
/** How hard the OpenAI backend thinks: none, minimal, low, medium, high, xhigh. */
export const EFFORT = (process.env.OPENAI_DELEGATION_EFFORT || "low").trim();
/** What she said is transcribed in pieces with no end marker: a pause this long ends a line. */
const LINE_GAP_MS = 1200;

/**
 * Opens a session. `delegation` is the session's delegation config. Handlers:
 *   onAudio(base64Pcm24k)       a piece of her voice, in order, as it is made
 *   onHeard(text)               a piece of what the room said, as she heard it
 *   onSaid(text, at)            one line of hers, once she has finished it
 *   onDelegation(id, target)    she handed something over; for "client", answer with say(text, id)
 *   onFunctionCall(name, args)  the OpenAI backend calls one of our tools; resolves to its output
 *   onStarted(expiresAt)        the session is up (expiresAt in ms)
 *   onClose(reason, byUs)       the session ended
 */
export function connectLive({ instructions, history, delegation, log, onAudio, onHeard, onSaid, onDelegation, onFunctionCall, onStarted, onClose }) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set in bot/.env");

  const ws = new WebSocket(LIVE_URL, { headers: { Authorization: `Bearer ${key}` } });
  let started = false;
  let byUs = false;
  let closedReason = null;
  const queue = [];
  const send = (event) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  };
  const command = (event) => (started ? send(event) : queue.push(event));

  ws.addEventListener("open", () => {
    send({
      type: "session.start",
      session: {
        model: LIVE_MODEL,
        instructions,
        audio: { format: { type: "audio/pcm", rate: 24000 }, output: { voice: VOICE } },
        delegation: delegation ?? { type: "client" },
        ...(history ? { input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: history }] }] } : {}),
      },
    });
  });

  let saying = "";
  let sayingAt = 0;
  let sayTimer = null;
  const flushSaid = () => {
    clearTimeout(sayTimer);
    // Her transcript marks sounds as "[sigh]" or "[laughs]": not words, not for the notes.
    const text = saying
      .replace(/\[[^\]\n]{1,24}\]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?،؟])/g, "$1")
      .trim();
    if (text) onSaid?.(text, sayingAt);
    saying = "";
  };

  /** The OpenAI backend's own events, wrapped: our tools, and its failures. */
  const backend = (inner) => {
    if (inner?.type === "response.output_item.done" && inner.item?.type === "function_call") {
      const { call_id, name } = inner.item;
      let args = {};
      try {
        args = JSON.parse(inner.item.arguments || "{}");
      } catch {
        /* no arguments */
      }
      void Promise.resolve()
        .then(() => onFunctionCall?.(name, args) ?? "Not available.")
        .catch((e) => `Failed: ${e.message}`)
        .then((output) => {
          command({ type: "response.item.create", item: { type: "function_call_output", call_id, output: String(output) } });
          command({ type: "response.create" });
        });
    } else if (inner?.type === "response.failed" || inner?.type === "error") {
      log(`  her backend failed: ${inner.response?.error?.message ?? inner.error?.message ?? inner.message ?? inner.type}`);
    }
  };

  ws.addEventListener("message", (msg) => {
    let e;
    try {
      e = JSON.parse(typeof msg.data === "string" ? msg.data : Buffer.from(msg.data).toString());
    } catch {
      return;
    }
    switch (e.type) {
      case "session.started":
        started = true;
        log(`  GPT-Live connected (${LIVE_MODEL}, voice ${VOICE})`);
        onStarted?.((e.session?.expires_at ?? 0) * 1000);
        for (const ev of queue.splice(0)) send(ev);
        break;
      case "session.output_audio.delta":
        onAudio?.(e.delta);
        break;
      case "session.output_transcript.delta":
        if (!saying) sayingAt = Date.now();
        saying += e.delta;
        clearTimeout(sayTimer);
        sayTimer = setTimeout(flushSaid, LINE_GAP_MS);
        break;
      case "session.input_transcript.delta":
        onHeard?.(e.delta);
        break;
      case "session.delegation.created":
        onDelegation?.(e.delegation?.id, e.delegation?.target);
        break;
      case "response.event":
        backend(e.event);
        break;
      case "session.closed":
        closedReason = e.reason;
        break;
      case "error":
        log(`  GPT-Live error: ${e.error?.message ?? JSON.stringify(e.error)}${e.error?.param ? ` (${e.error.param})` : ""}`);
        break;
      case "info":
        log(`  GPT-Live: ${e.message}`);
        break;
    }
  });
  ws.addEventListener("close", (e) => {
    flushSaid();
    started = false;
    onClose?.(closedReason ?? `${e.code}${e.reason ? ` ${e.reason}` : ""}`, byUs);
  });
  ws.addEventListener("error", () => log("  GPT-Live connection error"));

  return {
    /** The meeting's sound: 24 kHz 16-bit mono PCM, base64. Dropped until the session is up. */
    appendAudio: (b64) => {
      if (started) send({ type: "session.input_audio.append", audio: b64 });
    },
    /** Something for her to say — an answer to what she handed over, or (id null) a cue. */
    say: (content, delegationId = null) => command({ type: "session.commentary.append", content, delegation_id: delegationId }),
    /** Silent context: who is speaking, that a delegated task found nothing. */
    think: (content, delegationId = null) => command({ type: "session.thinking.append", content, delegation_id: delegationId }),
    /** A change of instructions while running: one-on-one, a group. */
    instruct: (content) => command({ type: "session.instructions.append", content, delegation_id: null }),
    close: () => {
      byUs = true;
      send({ type: "session.close" });
      // session.closed confirms it; do not wait forever for it.
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }, 3000);
    },
  };
}
