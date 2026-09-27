/**
 * Runs inside meet.google.com, before Meet's own code, in the Chrome that is signed in
 * as Ava.
 *
 * Meet asks the browser for a camera and a microphone like any web page does, through
 * navigator.mediaDevices. This answers those requests with Ava herself.
 *
 *   voice   (default) — no camera; she joins with her profile photo, and her microphone
 *           is a live audio track we play her speech into. Nothing to connect to, so
 *           nothing that can drop mid-meeting.
 *   avatar  — the Anam avatar's face is the camera and its voice the microphone.
 *
 * It also reads the live captions Meet draws on screen — the conversation, with real
 * speaker names — and hands them to the runner through `__avaHeard`.
 *
 * Nothing here decides what to say. That stays on the server, in the same brain the rest
 * of the app uses; this is only her ears and mouth.
 */

import { AnamEvent, MessageRole, createClient } from "@anam-ai/js-sdk";
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";

declare global {
  interface Window {
    __ava?: AvaApi;
    /** Set by the runner in a tiny init script that runs before this one. */
    __AVA_MODE?: "voice" | "avatar";
    /** Supplied by the runner through Playwright's exposeBinding. */
    __avaHeard?: (speaker: string, text: string, blockId: string) => void;
    __avaLog?: (message: string) => void;
  }
}

type AvaApi = {
  start(sessionToken?: string): Promise<void>;
  /** Avatar mode: have Anam say this text. */
  talk(text: string): Promise<boolean>;
  /** Voice mode: play this audio (base64 mp3) as her voice. */
  play(base64: string): Promise<boolean>;
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
  const mode = window.__AVA_MODE === "avatar" ? "avatar" : "voice";
  let isSpeaking = false;
  let finished: (() => void) | null = null;

  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => (markReady = r));

  /* ── voice mode: a microphone she speaks into ─────────────────────────── */

  let audio: AudioContext | null = null;
  let mic: MediaStreamAudioDestinationNode | null = null;
  let playing: AudioBufferSourceNode | null = null;

  const ensureAudio = () => {
    if (!audio) {
      audio = new AudioContext();
      mic = audio.createMediaStreamDestination();
    }
    // Chrome may create the context suspended; the runner starts Chrome with an autoplay
    // policy that allows resuming it without anybody clicking.
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    return { audio, mic: mic! };
  };

  /* ── avatar mode: Anam ────────────────────────────────────────────────── */

  let client: AnamClient | null = null;
  let avatarStream: MediaStream | null = null;

  /* ── what Meet sees as her devices ────────────────────────────────────── */

  const md = navigator.mediaDevices;
  const device = (kind: MediaDeviceKind, deviceId: string, label: string) =>
    ({ deviceId, groupId: "ava", kind, label, toJSON: () => ({}) }) as MediaDeviceInfo;

  md.enumerateDevices = async () => [
    device("audioinput", "ava-microphone", "Ava"),
    device("audiooutput", "default", "Default"),
    // In voice mode she has no camera at all, so Meet joins her camera-off and shows her
    // Google profile photo — rather than a black rectangle.
    ...(mode === "avatar" ? [device("videoinput", "ava-camera", "Ava")] : []),
  ];

  md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (constraints?.video && !constraints.audio && mode === "voice") {
      throw new DOMException("Requested device not found", "NotFoundError");
    }
    await ready;
    const out = new MediaStream();
    if (constraints?.audio) {
      const track = mode === "voice" ? ensureAudio().mic.stream.getAudioTracks()[0] : avatarStream?.getAudioTracks()[0];
      if (track) out.addTrack(track.clone());
    }
    if (constraints?.video && mode === "avatar" && avatarStream) {
      for (const t of avatarStream.getVideoTracks()) out.addTrack(t.clone());
    }
    log(`getUserMedia → video:${out.getVideoTracks().length} audio:${out.getAudioTracks().length}`);
    return out;
  };

  /* ── her ears: Meet's live captions ────────────────────────────────────── */

  /**
   * Meet's caption DOM is undocumented and its class names change, so this avoids them.
   * It finds the region by its accessible label, and treats each block inside as one
   * speaker's turn: the first line is the name, the rest is what they said.
   *
   * Each block keeps a stable id for as long as it is on screen. That matters: Meet does
   * not append to a caption, it rewrites it as it goes — "Hello Ava Ava!" becomes "Hello,
   * Ava, Ava. Thank you for joining." — so recognising the same turn by its text fails,
   * and every rewrite used to land in the transcript as a separate line. With the id,
   * the server replaces the line in place.
   */
  const ids = new WeakMap<Element, string>();
  const sent = new WeakMap<Element, string>();
  let nextId = 0;
  const idOf = (el: Element) => {
    let id = ids.get(el);
    if (!id) {
      id = `blk-${Date.now().toString(36)}-${++nextId}`;
      ids.set(el, id);
    }
    return id;
  };

  // Meet's own buttons inside the captions panel ("Jump to bottom", "Summarize
  // captions") render as a material-icon name followed by a label. They are not speech.
  const looksLikeChrome = (line: string) =>
    /^[a-z]+(_[a-z]+)*$/.test(line) || /^(jump to bottom|summari[sz]e captions|close|captions)$/i.test(line);

  const readCaptions = () => {
    const region = document.querySelector<HTMLElement>('[role="region"][aria-label*="aption" i]');
    if (!region) return;

    for (const block of Array.from(region.children)) {
      if (block.querySelector("button") || block.tagName === "BUTTON") continue;
      const lines = (block as HTMLElement).innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2 || looksLikeChrome(lines[0])) continue;

      const speaker = lines[0];
      const text = lines
        .slice(1)
        .filter((l) => !looksLikeChrome(l))
        .join(" ")
        .trim();
      if (!text || text === sent.get(block)) continue;
      sent.set(block, text);

      try {
        window.__avaHeard?.(speaker, text, idOf(block));
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

  /* ── the API the runner drives ─────────────────────────────────────────── */

  const done = () => {
    isSpeaking = false;
    finished?.();
    finished = null;
  };

  const api: AvaApi = {
    async start(sessionToken) {
      if (mode === "voice") {
        ensureAudio();
        log("voice ready");
        markReady();
        return;
      }

      if (client || !sessionToken) return;
      const video = document.createElement("video");
      video.id = "__ava_video";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true; // local playback only; the tracks Meet sends are untouched
      video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;bottom:0;right:0";
      (document.body ?? document.documentElement).appendChild(video);

      client = createClient(sessionToken, { disableInputAudio: true });
      client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e: MessageStreamEvent) => {
        if (e.role === MessageRole.PERSONA && (e.endOfSpeech || e.interrupted)) done();
      });
      client.addListener(AnamEvent.CONNECTION_CLOSED, (reason) => {
        log(`anam closed: ${reason}`);
        done();
      });
      await client.streamToVideoElement(video.id);
      for (let i = 0; i < 100; i++) {
        const s = video.srcObject as MediaStream | null;
        if (s && s.getVideoTracks().length && s.getAudioTracks().length) {
          avatarStream = s;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      log(avatarStream ? "anam stream ready" : "anam stream never produced both tracks");
      markReady();
    },

    async play(base64) {
      try {
        const { audio, mic } = ensureAudio();
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const buffer = await audio.decodeAudioData(bytes.buffer);
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(mic);
        playing = source;
        isSpeaking = true;
        const ended = new Promise<void>((r) => {
          finished = r;
          source.onended = () => r();
        });
        source.start();
        // A suspended audio context never fires `ended`, which would leave her
        // "speaking" — and so silent — for the rest of the meeting.
        await Promise.race([ended, new Promise((r) => setTimeout(r, buffer.duration * 1000 + 2000))]);
        return true;
      } catch (e) {
        log(`play failed: ${e instanceof Error ? e.message : e}`);
        return false;
      } finally {
        playing = null;
        isSpeaking = false;
        finished = null;
      }
    },

    async talk(text) {
      if (!client || !text.trim()) return false;
      isSpeaking = true;
      const spoken = new Promise<void>((r) => (finished = r));
      try {
        await client.talk(text);
        const words = text.trim().split(/\s+/).length;
        const ceiling = Math.min(40_000, Math.max(8_000, (words / 2.3) * 1000 + 6_000));
        await Promise.race([spoken, new Promise((r) => setTimeout(r, ceiling))]);
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
        playing?.stop();
      } catch {
        /* already stopped */
      }
      try {
        client?.interruptPersona();
      } catch {
        /* nothing in flight */
      }
      done();
    },

    speaking: () => isSpeaking,
  };

  window.__ava = api;
}
