// Her voice, when she has no avatar: ElevenLabs text-to-speech, called straight from the
// server. One request per sentence and nothing held open between them — so, unlike an
// avatar session, there is nothing that can drop in the middle of a meeting and leave
// her mute for the rest of it.

const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL";
// Flash: the lowest-latency model. In a meeting, a reply that starts a second sooner
// matters more than a small gain in polish.
const DEFAULT_MODEL = "eleven_flash_v2_5";

export const voiceConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);

/**
 * The sentence as spoken audio, base64-encoded, ready to hand to the page: mp3 by
 * default, or raw 16 kHz PCM ("pcm_16000") for her face to lip-sync to.
 *
 * `lang` ("en", "de", "ar") tells the model which language it is reading, so a German
 * sentence is not read with English sounds. The same voice speaks all three; a voice of
 * its own per language can be set with ELEVENLABS_VOICE_ID_DE / ELEVENLABS_VOICE_ID_AR.
 */
export async function speech(text, format = "mp3_44100_128", lang = "en") {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set in bot/.env — she has no voice.");
  const voice = process.env[`ELEVENLABS_VOICE_ID_${lang.toUpperCase()}`] || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${format}`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      // A hung request would leave her "about to speak", and so silent, for good.
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
        language_code: lang,
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
