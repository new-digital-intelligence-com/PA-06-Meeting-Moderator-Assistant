// OpenAI GPT-Live: her ears and voice when AVA_BRAIN=live. One model hears the meeting and
// talks, over one live connection — it listens while it speaks ("full duplex"), so it
// takes turns, stops when talked over and backchannels by itself. What needs her memory
// of the meeting it hands back to us ("delegation"), and Claude answers.
//
// This file is only the connection. What she is told, when she may speak and where her
// voice goes are decided in meet.mjs.

const LIVE_URL = "wss://api.openai.com/v1/live/sessions";
export const LIVE_MODEL = process.env.OPENAI_LIVE_MODEL || "gpt-live-1";
const VOICE = process.env.OPENAI_VOICE || "gleam";
/** What she said is transcribed in pieces with no end marker: a pause this long ends a line. */
const LINE_GAP_MS = 1200;

/**
 * Opens a session. Handlers:
 *   onAudio(base64Pcm24k)       a piece of her voice, in order, as it is made
 *   onHeard(text)               a piece of what the room said, as she heard it
 *   onSaid(text, at)            one line of hers, once she has finished it
 *   onDelegation(id)            she handed something over — answer with say(text, id)
 *   onStarted(expiresAt)        the session is up (expiresAt in ms)
 *   onClose(reason, byUs)       the session ended
 */
export function connectLive({ instructions, history, log, onAudio, onHeard, onSaid, onDelegation, onStarted, onClose }) {
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
        // What she hands over comes to us, and Claude answers it.
        delegation: { type: "client" },
        ...(history ? { input: [{ type: "message", role: "developer", content: [{ type: "input_text", text: history }] }] } : {}),
      },
    });
  });

  let saying = "";
  let sayingAt = 0;
  let sayTimer = null;
  const flushSaid = () => {
    clearTimeout(sayTimer);
    const text = saying.replace(/\s+/g, " ").trim();
    if (text) onSaid?.(text, sayingAt);
    saying = "";
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
        if (e.delegation?.target === "client") onDelegation?.(e.delegation.id);
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
