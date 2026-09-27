/**
 * Runs inside meet.google.com, before Meet's own code, in the Chrome that is signed in
 * as Ava.
 *
 * Meet asks the browser for a camera and a microphone like any web page does, through
 * navigator.mediaDevices. This answers those requests with Ava herself: the video track
 * is the Anam avatar's face and the audio track is her voice. As far as Meet can tell she
 * is a person with a webcam — which is what lets her be a real, signed-in participant
 * instead of a bot streaming a webpage.
 *
 * It also reads the live captions Meet draws on screen, which gives the conversation with
 * real speaker names, and hands them to the runner through `__avaHeard`.
 *
 * Nothing here decides what to say. That stays on the server, in the same brain the rest
 * of the app uses; this is only her eyes, ears and mouth.
 */

import { AnamEvent, MessageRole, createClient } from "@anam-ai/js-sdk";
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";

declare global {
  interface Window {
    __ava?: AvaApi;
    /** Supplied by the runner through Playwright's exposeBinding. */
    __avaHeard?: (speaker: string, text: string) => void;
    __avaLog?: (message: string) => void;
  }
}

type AvaApi = {
  start(sessionToken: string): Promise<void>;
  talk(text: string): Promise<boolean>;
  interrupt(): void;
  speaking(): boolean;
};

const log = (m: string) => {
  try {
    window.__avaLog?.(m);
  } catch {
    /* the binding may not be installed yet on this frame */
  }
};

// Init scripts run in every frame and on every navigation. Only the Meet page itself.
if (window.top === window && location.hostname === "meet.google.com" && !window.__ava) {
  let client: AnamClient | null = null;
  let stream: MediaStream | null = null;
  let finished: (() => void) | null = null;
  let isSpeaking = false;

  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => (markReady = r));

  /* ── her camera and microphone ─────────────────────────────────────────── */

  const md = navigator.mediaDevices;

  // A device list with one camera and one microphone, so Meet does not decide she has
  // neither and grey out the buttons before she has even arrived.
  const fakeDevices: MediaDeviceInfo[] = [
    { deviceId: "ava-camera", groupId: "ava", kind: "videoinput", label: "Ava", toJSON: () => ({}) },
    { deviceId: "ava-microphone", groupId: "ava", kind: "audioinput", label: "Ava", toJSON: () => ({}) },
    { deviceId: "default", groupId: "ava", kind: "audiooutput", label: "Default", toJSON: () => ({}) },
  ] as MediaDeviceInfo[];
  md.enumerateDevices = async () => fakeDevices;

  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    // Meet asks early, on the pre-join screen, usually before her stream is up. Holding
    // the request until it is means she arrives with her face on rather than a black tile.
    await ready;
    const out = new MediaStream();
    if (constraints?.video && stream) {
      for (const t of stream.getVideoTracks()) out.addTrack(t.clone());
    }
    if (constraints?.audio && stream) {
      for (const t of stream.getAudioTracks()) out.addTrack(t.clone());
    }
    log(`getUserMedia → video:${out.getVideoTracks().length} audio:${out.getAudioTracks().length}`);
    return out;
  };

  /* ── her ears: Meet's live captions ────────────────────────────────────── */

  /**
   * Meet's caption DOM is undocumented and its class names change, so this avoids them.
   * It finds the region by its accessible label, then treats each block inside as one
   * speaker's run of text: the first short line is the name, the rest is what they said.
   * Growing text is sent again as it grows; the server folds it into one line.
   */
  const seen = new WeakMap<Element, string>();

  const readCaptions = () => {
    const region = document.querySelector<HTMLElement>(
      '[role="region"][aria-label*="aption" i], [aria-label*="captions" i][role="region"]',
    );
    if (!region) return;

    for (const block of Array.from(region.children)) {
      const lines = (block as HTMLElement).innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) continue;

      const speaker = lines[0];
      const text = lines.slice(1).join(" ").trim();
      if (!text || text === seen.get(block)) continue;
      seen.set(block, text);

      try {
        window.__avaHeard?.(speaker, text);
      } catch {
        /* runner not listening yet */
      }
    }
  };

  new MutationObserver(() => readCaptions()).observe(document, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  /* ── her face and voice ────────────────────────────────────────────────── */

  const api: AvaApi = {
    async start(sessionToken) {
      if (client) return;

      // A hidden element to receive Anam's stream. Muted locally so the machine running
      // her does not play her voice out of its speakers — muting the element does not
      // touch the tracks themselves, which is what Meet sends to the room.
      const video = document.createElement("video");
      video.id = "__ava_video";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;bottom:0;right:0";
      (document.body ?? document.documentElement).appendChild(video);

      client = createClient(sessionToken, { disableInputAudio: true });

      client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e: MessageStreamEvent) => {
        if (e.role !== MessageRole.PERSONA) return;
        if (e.endOfSpeech || e.interrupted) {
          isSpeaking = false;
          finished?.();
          finished = null;
        }
      });
      client.addListener(AnamEvent.CONNECTION_CLOSED, (reason) => {
        log(`anam closed: ${reason}`);
        isSpeaking = false;
        finished?.();
        finished = null;
      });

      await client.streamToVideoElement(video.id);

      // Wait for both tracks to exist before telling Meet there is a camera to use.
      for (let i = 0; i < 100; i++) {
        const s = video.srcObject as MediaStream | null;
        if (s && s.getVideoTracks().length && s.getAudioTracks().length) {
          stream = s;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      log(stream ? "anam stream ready" : "anam stream never produced both tracks");
      markReady();
    },

    async talk(text) {
      if (!client || !text.trim()) return false;
      isSpeaking = true;
      const done = new Promise<void>((r) => (finished = r));
      try {
        await client.talk(text);
        // A ceiling scaled to the words, so one missed end-of-speech event cannot leave
        // her marked as speaking for the rest of the meeting.
        const words = text.trim().split(/\s+/).length;
        const ceiling = Math.min(40_000, Math.max(8_000, (words / 2.3) * 1000 + 6_000));
        await Promise.race([done, new Promise((r) => setTimeout(r, ceiling))]);
        return true;
      } catch (e) {
        log(`talk failed: ${e instanceof Error ? e.message : e}`);
        return false;
      } finally {
        isSpeaking = false;
        finished = null;
      }
    },

    interrupt() {
      try {
        client?.interruptPersona();
      } catch {
        /* nothing in flight */
      }
      isSpeaking = false;
      finished?.();
      finished = null;
    },

    speaking: () => isSpeaking,
  };

  window.__ava = api;
}
