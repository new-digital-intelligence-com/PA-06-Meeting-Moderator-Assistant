// Her voice, when she has no avatar: ElevenLabs text-to-speech, called straight from the
// server. One request per sentence and nothing held open between them — so, unlike an
// avatar session, there is nothing that can drop in the middle of a meeting and leave
// her mute for the rest of it.

const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL";
// Flash: the lowest-latency model. In a meeting, a reply that starts a second sooner
// matters more than a small gain in polish.
const DEFAULT_MODEL = "eleven_flash_v2_5";

export const voiceConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);

/** The sentence as spoken audio, base64-encoded mp3, ready to hand to the page. */
export async function speech(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set in bot/.env — she has no voice.");
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
