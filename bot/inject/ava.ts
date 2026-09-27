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
 *   avatar  — the same voice, plus a face: the camera is a canvas we draw her on.
 *
 * In avatar mode the face comes from Anam, which lip-syncs the avatar to the audio we
 * send it. But Anam cuts every session after a few minutes (three, on the free plan) and
 * bills by the minute, so the face is live only while she is in conversation, and the
 * canvas shows a looping clip of her at rest the rest of the time — including the couple
 * of seconds it takes to reconnect. Meet only ever sees one camera and one microphone,
 * so none of this is visible to the call. Her voice never depends on Anam: if the face
 * is not there, she speaks anyway.
 *
 * It also reads the live captions Meet draws on screen — the conversation, with real
 * speaker names — and hands them to the runner through `__avaHeard`.
 *
 * Nothing here decides what to say. That stays on the server, in the same brain the rest
 * of the app uses; this is only her ears, mouth and face.
 */

import { AnamEvent, createClient } from "@anam-ai/js-sdk";
import type { AgentAudioInputStream, AnamClient } from "@anam-ai/js-sdk";

type FaceOptions = {
  /** Anam's cut-off for one session on this plan. */
  sessionSeconds: number;
  /** How long the face stays connected after the conversation goes quiet. */
  idleSeconds: number;
};

declare global {
  interface Window {
    __ava?: AvaApi;
    /** Set by the runner in a tiny init script that runs before this one. */
    __AVA_MODE?: "voice" | "avatar";
    __AVA_FACE?: FaceOptions;
    /** Supplied by the runner through Playwright's exposeBinding. */
    __avaHeard?: (speaker: string, text: string, blockId: string) => void;
    __avaLog?: (message: string) => void;
    /** A fresh Anam session token, from the server. */
    __avaAnamToken?: () => Promise<string>;
    /** Keeps her idle clip for next time (JPEG frames, base64). */
    __avaIdleClip?: (frames: string[]) => void;
  }
}

type AvaApi = {
  /** Avatar mode takes the first session token, and her idle clip if one was saved. */
  start(options?: { token?: string; idleClip?: string[] }): Promise<void>;
  /** Her voice: base64 mp3 in voice mode, 16 kHz 16-bit mono PCM in avatar mode. */
  play(base64: string): Promise<boolean>;
  /** Somebody is talking to her: have the face ready for when she answers. */
  warm(): void;
  interrupt(): void;
  speaking(): boolean;
  /** "live", "connecting" or "down" — and "voice" in voice mode. */
  face(): string;
};

/** Avatar mode's audio format, which is what Anam lip-syncs to. */
const PCM_RATE = 16000;
/** How far Anam's picture and sound run behind the audio we send it. */
const FACE_LAG_MS = 600;
/** How long a reply waits for the face to connect before she speaks without it. */
const FACE_WAIT_MS = 3500;
/** Reconnect this long before Anam's cut-off, while she is quiet. */
const ROTATE_EARLY_MS = 30_000;
/** Her idle clip: a few seconds, played forwards then backwards so it loops without a seam. */
const IDLE_FPS = 12;
const IDLE_FRAMES = 48;

const log = (m: string) => {
  try {
    window.__avaLog?.(m);
  } catch {
    /* the binding may not be installed yet on this frame */
  }
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

// Init scripts run in every frame and on every navigation. Only the Meet page itself.
if (window.top === window && location.hostname === "meet.google.com" && !window.__ava) {
  const mode = window.__AVA_MODE === "avatar" ? "avatar" : "voice";
  const options: FaceOptions = { sessionSeconds: 180, idleSeconds: 45, ...window.__AVA_FACE };
  let isSpeaking = false;
  let finished: (() => void) | null = null;

  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => (markReady = r));

  /* ── her microphone ────────────────────────────────────────────────────── */

  let audio: AudioContext | null = null;
  let mic: MediaStreamAudioDestinationNode | null = null;
  /** The face's own sound — our audio, handed back in step with her lips. */
  let faceGain: GainNode | null = null;
  let playing: AudioBufferSourceNode | null = null;

  const ensureAudio = () => {
    if (!audio) {
      audio = new AudioContext();
      mic = audio.createMediaStreamDestination();
      faceGain = audio.createGain();
      faceGain.connect(mic);
    }
    // Chrome may create the context suspended; the runner starts Chrome with an autoplay
    // policy that allows resuming it without anybody clicking.
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    return { audio, mic: mic!, faceGain: faceGain! };
  };

  const pcmToBuffer = (ctx: AudioContext, bytes: Uint8Array) => {
    const n = bytes.length >> 1;
    const buffer = ctx.createBuffer(1, Math.max(1, n), PCM_RATE);
    const channel = buffer.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
    return buffer;
  };

  /** Plays audio straight into her microphone; resolves when it ends or is cut off. */
  const playDirect = async (buffer: AudioBuffer, offset = 0) => {
    const { audio, mic } = ensureAudio();
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(mic);
    playing = source;
    const ended = new Promise<void>((r) => {
      finished = r;
      source.onended = () => r();
    });
    source.start(0, Math.min(offset, buffer.duration));
    // A suspended audio context never fires `ended`, which would leave her
    // "speaking" — and so silent — for the rest of the meeting.
    await Promise.race([ended, sleep((buffer.duration - offset) * 1000 + 2000)]);
    playing = null;
  };

  /* ── her face: Anam, when she is in conversation ──────────────────────── */

  let face: "down" | "connecting" | "live" = "down";
  let client: AnamClient | null = null;
  let faceInput: AgentAudioInputStream | null = null;
  let faceSound: MediaStreamAudioSourceNode | null = null;
  let sessionAt = 0;
  let lastActive = 0;
  let generation = 0;
  let opening: Promise<boolean> | null = null;
  /** Resolves when the live face goes away, so a sentence mid-flight can carry on without it. */
  let faceGone: () => void = () => {};
  let faceGonePromise = new Promise<void>(() => {});
  let firstToken: string | undefined;

  /**
   * One video element per session. Reusing one handed each new session the previous
   * session's tracks — already dead — so after her first reconnect her lips moved and
   * nothing reached the microphone.
   */
  let faceVideo = document.createElement("video");
  const newFaceVideo = (gen: number) => {
    const v = document.createElement("video");
    v.id = `__ava_face_${gen}`;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true; // her sound reaches Meet through the microphone, not this element
    v.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;bottom:0;right:0";
    (document.body ?? document.documentElement).appendChild(v);
    return v;
  };

  const dropFace = (why?: string) => {
    generation++;
    opening = null;
    const c = client;
    client = null;
    faceInput = null;
    if (face !== "down" && why) log(`face down: ${why}`);
    face = "down";
    faceSound?.disconnect();
    faceSound = null;
    faceGone();
    if (c) void c.stopStreaming().catch(() => {});
  };

  const openFace = (): Promise<boolean> => {
    if (mode !== "avatar") return Promise.resolve(false);
    if (face === "live") return Promise.resolve(true);
    if (opening) return opening;
    const gen = ++generation;
    face = "connecting";
    const t0 = Date.now();
    let video: HTMLVideoElement | null = null;
    opening = (async () => {
      try {
        const token = firstToken ?? (await window.__avaAnamToken!());
        firstToken = undefined;
        if (gen !== generation) return false;
        video = newFaceVideo(gen);

        const c = createClient(token, { disableInputAudio: true });
        client = c;
        c.addListener(AnamEvent.CONNECTION_CLOSED, (reason: unknown) => {
          if (client === c) dropFace(`Anam closed the session (${String(reason)})`);
        });
        await c.streamToVideoElement(video.id);

        const up = (s: MediaStream | null) =>
          Boolean(s?.getVideoTracks().length && s.getAudioTracks().length && s.getTracks().every((t) => t.readyState === "live"));
        let stream: MediaStream | null = null;
        for (let i = 0; i < 150 && gen === generation; i++) {
          stream = video.srcObject as MediaStream | null;
          if (up(stream) && video.videoWidth > 0) break;
          await sleep(100);
        }
        if (gen !== generation || client !== c) {
          video.remove();
          return false;
        }
        if (!up(stream) || !video.videoWidth) throw new Error("no picture from Anam");
        const old = faceVideo;
        faceVideo = video;
        old.remove();

        const { audio, faceGain } = ensureAudio();
        faceSound = audio.createMediaStreamSource(new MediaStream(stream!.getAudioTracks()));
        faceSound.connect(faceGain);
        faceGain.gain.value = 1;
        faceInput = c.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: PCM_RATE, channels: 1 });
        faceGonePromise = new Promise<void>((r) => (faceGone = r));
        face = "live";
        sessionAt = Date.now();
        log(`face live (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        return true;
      } catch (e) {
        if (gen === generation) dropFace(`could not connect: ${e instanceof Error ? e.message : e}`);
        if (video !== faceVideo) video?.remove();
        return false;
      } finally {
        if (gen === generation || face !== "connecting") opening = null;
      }
    })();
    return opening;
  };

  // Close when the conversation has gone quiet (minutes are billed), and reconnect ahead
  // of Anam's cut-off at a moment she is not speaking, rather than be cut off mid-word.
  if (mode === "avatar") {
    setInterval(() => {
      if (face !== "live" || isSpeaking) return;
      const age = Date.now() - sessionAt;
      const quiet = Date.now() - lastActive;
      if (quiet > options.idleSeconds * 1000) {
        dropFace("the conversation went quiet — resting until somebody talks to her");
      } else if (age > options.sessionSeconds * 1000 - ROTATE_EARLY_MS) {
        dropFace("renewing the session before Anam's time limit");
        void openFace();
      }
    }, 1000);
  }

  /* ── her camera: a canvas, so the picture never drops out ─────────────── */

  const W = 1280;
  const H = 720;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  let camera: MediaStream | null = null;

  /** The last live frame, for when there is no idle clip yet. */
  const still = document.createElement("canvas");
  still.width = W;
  still.height = H;
  let hasStill = false;

  let idle: ImageBitmap[] = [];
  let recording = false;

  type Source = "live" | "idle" | "still" | "blank";
  let shown: Source = "blank";
  let previous: Source = "blank";
  let switchedAt = 0;

  /** Draws a frame scaled to fill a 16:9 canvas, cropping the bottom to keep the top of the head. */
  const cover = (ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number) => {
    const dw = ctx.canvas.width;
    const dh = ctx.canvas.height;
    let sw = w;
    let sh = (w * dh) / dw;
    let sx = 0;
    if (sh > h) {
      sh = h;
      sw = (h * dw) / dh;
      sx = (w - sw) / 2;
    }
    ctx.drawImage(img, sx, 0, sw, sh, 0, 0, dw, dh);
  };

  const idleFrame = () => {
    // Forwards then backwards: a loop with no jump at the join.
    const n = idle.length;
    const i = Math.floor((Date.now() / 1000) * IDLE_FPS) % (2 * n - 2 || 1);
    return idle[i < n ? i : 2 * n - 2 - i];
  };

  const paint = (source: Source) => {
    if (source === "live") cover(g, faceVideo, faceVideo.videoWidth, faceVideo.videoHeight);
    else if (source === "idle") g.drawImage(idleFrame(), 0, 0, W, H);
    else if (source === "still") g.drawImage(still, 0, 0);
    else {
      g.fillStyle = "#1f1f1f";
      g.fillRect(0, 0, W, H);
    }
  };

  let lastStill = 0;
  const draw = () => {
    const want: Source =
      face === "live" && faceVideo.videoWidth > 0 ? "live" : idle.length > 1 ? "idle" : hasStill ? "still" : "blank";
    if (want !== shown) {
      previous = shown;
      shown = want;
      switchedAt = Date.now();
    }
    // A short crossfade, so the switch between live and resting is not a jump cut.
    const t = Math.min(1, (Date.now() - switchedAt) / 300);
    if (t < 1 && previous !== "blank") {
      g.globalAlpha = 1;
      paint(previous);
      g.globalAlpha = t;
    }
    paint(shown);
    g.globalAlpha = 1;

    if (shown === "live" && Date.now() - lastStill > 1000) {
      still.getContext("2d")!.drawImage(canvas, 0, 0);
      hasStill = true;
      lastStill = Date.now();
    }
  };

  /**
   * Films a few seconds of her at rest, once, from the live face — that is what the
   * camera shows whenever the face is not connected. Saved by the runner, so later
   * meetings have it from the first second.
   */
  const recordIdle = async () => {
    if (recording || idle.length || face !== "live" || isSpeaking) return;
    recording = true;
    const frames: ImageBitmap[] = [];
    const jpegs: string[] = [];
    const small = document.createElement("canvas");
    small.width = 640;
    small.height = 360;
    const sg = small.getContext("2d")!;
    try {
      while (frames.length < IDLE_FRAMES) {
        if (face !== "live" || isSpeaking) throw new Error("interrupted");
        cover(sg, faceVideo, faceVideo.videoWidth, faceVideo.videoHeight);
        frames.push(await createImageBitmap(small));
        jpegs.push(small.toDataURL("image/jpeg", 0.8).split(",")[1]);
        await sleep(1000 / IDLE_FPS);
      }
      idle = frames;
      log(`idle clip recorded (${frames.length} frames)`);
      try {
        window.__avaIdleClip?.(jpegs);
      } catch {
        /* nowhere to keep it; it still works for this meeting */
      }
    } catch {
      for (const f of frames) f.close();
    } finally {
      recording = false;
    }
  };
  const loadIdle = async (clip: string[]) => {
    const frames: ImageBitmap[] = [];
    for (const jpeg of clip) frames.push(await createImageBitmap(new Blob([bytesOf(jpeg)], { type: "image/jpeg" })));
    idle = frames;
    log(`idle clip loaded (${frames.length} frames)`);
  };

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
      const track = ensureAudio().mic.stream.getAudioTracks()[0];
      if (track) out.addTrack(track.clone());
    }
    if (constraints?.video && mode === "avatar" && camera) {
      for (const t of camera.getVideoTracks()) out.addTrack(t.clone());
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
    finished?.();
    finished = null;
  };

  const api: AvaApi = {
    async start(opts = {}) {
      ensureAudio();
      if (mode === "voice") {
        log("voice ready");
        markReady();
        return;
      }

      camera = canvas.captureStream(25);
      // Timers, not animation frames: an animation frame never fires in a window nobody
      // is looking at, and her camera would freeze.
      setInterval(draw, 40);
      if (opts.idleClip?.length) await loadIdle(opts.idleClip).catch((e) => log(`idle clip unusable: ${e}`));

      // She says hello the moment she walks in, so the face is wanted straight away.
      firstToken = opts.token;
      lastActive = Date.now();
      await Promise.race([openFace(), sleep(12_000)]);
      log(face === "live" ? "face and voice ready" : "voice ready — her face will join when Anam connects");
      markReady();
    },

    async play(base64) {
      isSpeaking = true;
      lastActive = Date.now();
      try {
        const bytes = bytesOf(base64);
        const { audio, faceGain } = ensureAudio();
        if (mode === "voice") {
          await playDirect(await audio.decodeAudioData(bytes.buffer));
          return true;
        }

        const ms = (bytes.length / 2 / PCM_RATE) * 1000;
        // Not enough of this session left to finish the sentence: renew it first.
        if (face === "live" && Date.now() - sessionAt + ms + 5000 > options.sessionSeconds * 1000) {
          dropFace("renewing the session before Anam's time limit");
        }
        if (face !== "live") await Promise.race([openFace(), sleep(FACE_WAIT_MS)]);

        const input = face === "live" ? faceInput : null;
        if (!input) {
          // No face: speak anyway. The camera shows her at rest.
          await playDirect(pcmToBuffer(audio, bytes));
          return true;
        }

        faceGain.gain.value = 1;
        const sentAt = Date.now();
        const chunk = PCM_RATE * 2 * 0.2;
        for (let i = 0; i < bytes.length; i += chunk) input.sendAudioChunk(bytes.slice(i, i + chunk));
        input.endSequence();

        const outcome = await Promise.race([
          sleep(ms + FACE_LAG_MS).then(() => "done" as const),
          new Promise<"cut">((r) => (finished = () => r("cut"))),
          faceGonePromise.then(() => "lost" as const),
        ]);
        // The face dropped mid-sentence: finish it without the face, from where it was.
        if (outcome === "lost") {
          const at = Math.max(0, (Date.now() - sentAt - FACE_LAG_MS) / 1000);
          if (at < ms / 1000 - 0.3) await playDirect(pcmToBuffer(audio, bytes), at);
        }
        return true;
      } catch (e) {
        log(`play failed: ${e instanceof Error ? e.message : e}`);
        return false;
      } finally {
        isSpeaking = false;
        finished = null;
        lastActive = Date.now();
        // Now is a good moment to film her at rest, if that has not happened yet.
        if (mode === "avatar" && !idle.length) setTimeout(() => void recordIdle(), 1500);
      }
    },

    warm() {
      if (mode !== "avatar") return;
      lastActive = Date.now();
      if (face === "down") void openFace();
    },

    interrupt() {
      try {
        playing?.stop();
      } catch {
        /* already stopped */
      }
      // The face has the rest of the sentence queued: silence it until that has played
      // out, rather than let it carry on over the person who cut in.
      if (faceGain && isSpeaking && face === "live") {
        faceGain.gain.value = 0;
        try {
          client?.interruptPersona();
        } catch {
          /* nothing in flight */
        }
      }
      done();
    },

    speaking: () => isSpeaking,
    face: () => (mode === "voice" ? "voice" : face),
  };

  window.__ava = api;
}
