// OpenAI Realtime: one model that hears the meeting, decides and answers out loud, over
// one live connection — sound in, sound out, both at once ("full duplex"). Used instead
// of captions → Claude → ElevenLabs when AVA_BRAIN=openai.
//
// This file is only the connection. What she is told, when she may speak and where her
// voice goes are decided in meet.mjs.

const URL_BASE = "wss://api.openai.com/v1/realtime";
export const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const VOICE = process.env.OPENAI_VOICE || "marin";
const TRANSCRIBE = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

/**
 * Opens a session. Handlers:
 *   onAudio(base64Pcm24k, itemId)   a piece of her voice, as it is made
 *   onSpeechStarted()               somebody started talking — stop hers
 *   onHeard(text)                   what somebody said, transcribed
 *   onSaid(text)                    what she said, transcribed
 *   onResponseDone()                she has finished a reply
 *   onClose(reason)                 the session ended
 */
export function connectRealtime({ instructions, autoRespond, log, onAudio, onSpeechStarted, onHeard, onSaid, onResponseDone, onClose }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set in bot/.env");

  // Node's built-in WebSocket cannot set headers; OpenAI also accepts the key as a
  // subprotocol, which is what browsers use.
  const ws = new WebSocket(`${URL_BASE}?model=${encodeURIComponent(REALTIME_MODEL)}`, [
    "realtime",
    `openai-insecure-api-key.${key}`,
  ]);

  let open = false;
  const queue = [];
  const send = (event) => {
    const data = JSON.stringify(event);
    if (open) ws.send(data);
    else queue.push(data);
  };

  const turnDetection = (auto) => ({
    // Semantic VAD decides the end of a turn from what was said, not just silence.
    type: "semantic_vad",
    eagerness: "auto",
    create_response: auto,
    interrupt_response: true,
  });

  ws.addEventListener("open", () => {
    open = true;
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          output_modalities: ["audio"],
          instructions,
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              turn_detection: turnDetection(autoRespond),
              transcription: { model: TRANSCRIBE },
            },
            output: { format: { type: "audio/pcm", rate: 24000 }, voice: VOICE },
          },
        },
      }),
    );
    for (const data of queue.splice(0)) ws.send(data);
  });

  let announced = false;
  ws.addEventListener("message", (msg) => {
    let e;
    try {
      e = JSON.parse(typeof msg.data === "string" ? msg.data : Buffer.from(msg.data).toString());
    } catch {
      return;
    }
    switch (e.type) {
      case "session.updated":
        if (!announced) log(`  OpenAI Realtime connected (${REALTIME_MODEL}, voice ${VOICE})`);
        announced = true;
        break;
      case "input_audio_buffer.speech_started":
        onSpeechStarted?.();
        break;
      case "response.output_audio.delta":
        onAudio?.(e.delta, e.item_id);
        break;
      case "response.output_audio_transcript.done":
        if (e.transcript?.trim()) onSaid?.(e.transcript.trim());
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.transcript?.trim()) onHeard?.(e.transcript.trim());
        break;
      case "response.done":
        onResponseDone?.();
        break;
      case "error":
        log(`  OpenAI Realtime error: ${e.error?.message ?? JSON.stringify(e.error)}`);
        break;
    }
  });
  ws.addEventListener("close", (e) => {
    open = false;
    onClose?.(`${e.code}${e.reason ? ` ${e.reason}` : ""}`);
  });
  ws.addEventListener("error", () => log("  OpenAI Realtime connection error"));

  return {
    /** The meeting's sound: 24 kHz 16-bit mono PCM, base64. */
    appendAudio: (b64) => send({ type: "input_audio_buffer.append", audio: b64 }),
    /** Speak now, optionally with a one-off instruction ("greet the room"). */
    respond: (extra) => send({ type: "response.create", ...(extra ? { response: { instructions: extra } } : {}) }),
    /** Stop the reply in progress. */
    cancel: () => send({ type: "response.cancel" }),
    /** Keep her memory true to what was actually heard of an interrupted reply. */
    truncate: (itemId, ms) => send({ type: "conversation.item.truncate", item_id: itemId, content_index: 0, audio_end_ms: Math.max(0, Math.round(ms)) }),
    /** One-on-one she answers by herself; in a group she waits to be asked. */
    setAutoRespond: (auto) => send({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection: turnDetection(auto) } } } }),
    /** Something she should know, as text — who is speaking, a recap after reconnecting. */
    note: (text) =>
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } }),
    close: () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}
