/**
 * Runs inside the meeting page — Google Meet or Microsoft Teams — before the page's own
 * code, in the Chrome that is signed in as Ava.
 *
 * Meet and Teams ask the browser for a camera and a microphone like any web page does,
 * through navigator.mediaDevices. This answers those requests with Ava herself.
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
  /** Her name, for the card shown when there is no picture of her at all. */
  name?: string;
  /** Anam's cut-off for one session on this plan. */
  sessionSeconds: number;
  /** How long the face stays connected after the conversation goes quiet. */
  idleSeconds: number;
  /**
   * The rate her face is sent her voice at: 16 kHz (ElevenLabs as it comes; GPT-Live's
   * 24 kHz filtered down), or 24 kHz to send GPT-Live's voice as it is (ANAM_PCM_RATE).
   */
  pcmRate?: number;
  /**
   * Where her voice is heard from while her face is up: "direct" — straight from GPT-Live,
   * held back to match the lips — or "anam", the face's own copy (AVA_FACE_AUDIO).
   */
  faceAudio?: "direct" | "anam";
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
    /** Her face's account ran out of minutes: the number of the account taking over, or null. */
    __avaAnamUsedUp?: () => Promise<number | null>;
    /** GPT-Live: the meeting's sound, 24 kHz 16-bit PCM, base64, every ~85 ms. */
    __avaHear?: (base64: string) => void;
  }
}

type AvaApi = {
  /** Avatar mode takes the first session token, and her idle clip if one was saved. */
  /**
   * `faceLater`: do not connect the face yet — nobody else is in the meeting, and an
   * empty room is not worth Anam's minutes. `warm()` brings it up when somebody arrives.
   */
  start(options?: { token?: string; idleClip?: string[]; faceLater?: boolean }): Promise<void>;
  /** Her voice: base64 mp3 in voice mode, 16 kHz 16-bit mono PCM in avatar mode. */
  play(base64: string): Promise<boolean>;
  /** Somebody is talking to her: have the face ready for when she answers. */
  warm(): void;
  /** Nobody else is in the meeting: close the face session now; `warm` brings it back. */
  rest(): void;
  interrupt(): void;
  speaking(): boolean;
  /** "live", "connecting" or "down" — and "voice" in voice mode. */
  face(): string;
  /**
   * Whether `start` has run on this page. A page that navigates (Teams' launcher does)
   * gets a fresh copy of this script, which has to be started again.
   */
  started(): boolean;
  /**
   * The meeting is over: close her face session now. Closing the browser alone leaves
   * Anam to notice the connection has gone, and it bills by the minute until it does.
   */
  end(): Promise<void>;
  /** GPT-Live: start or stop sending the meeting's sound to her runner. */
  listen(on: boolean): void;
  /** GPT-Live: a piece of her voice (24 kHz PCM, base64), played the moment it arrives. */
  feed(base64: string, turn: string): void;
  /** GPT-Live: the reply being fed is complete. */
  feedDone(): void;
};

/** Avatar mode's audio format, which is what Anam lip-syncs to. */
const PCM_RATE = 16000;
/** How far Anam's picture and sound run behind the audio we send it. */
const FACE_LAG_MS = 600;
/** How long her face's sound stays open after what she said should have played. */
const FACE_TAIL_MS = 900;
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

/** Which meeting page this is, if any. */
const platform =
  location.hostname === "meet.google.com"
    ? "meet"
    : /^teams\.(microsoft\.com|live\.com|cloud\.microsoft)$/.test(location.hostname)
      ? "teams"
      : null;

// Init scripts run in every frame and on every navigation. Only the meeting page itself.
if (window.top === window && platform && !window.__ava) {
  const mode = window.__AVA_MODE === "avatar" ? "avatar" : "voice";
  const options: FaceOptions = { sessionSeconds: 180, idleSeconds: 45, ...window.__AVA_FACE };
  let isSpeaking = false;
  let finished: (() => void) | null = null;

  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => (markReady = r));

  /* ── her ears for GPT-Live: the meeting's own sound ────────────────────── */

  // Other people reach the page as WebRTC audio tracks. Watching every peer connection
  // the page makes catches them, whatever Meet or Teams does with them afterwards. Her
  // own microphone is never a remote track, so she does not hear herself; the face's
  // connection (Anam) is marked as hers and never listened to either — otherwise she
  // would hear her own voice come back from it and interrupt herself.
  const remote = new Map<string, MediaStreamTrack>();
  const hers = new WeakSet<RTCPeerConnection>();
  let buildingFace = false;
  let hearCtx: AudioContext | null = null;
  let hearMix: GainNode | null = null;
  let hearing = false;
  const wired = new Map<string, MediaStreamAudioSourceNode>();

  const wire = (track: MediaStreamTrack) => {
    if (!hearCtx || !hearMix || wired.has(track.id)) return;
    try {
      const src = hearCtx.createMediaStreamSource(new MediaStream([track]));
      src.connect(hearMix);
      wired.set(track.id, src);
    } catch {
      /* ended already */
    }
  };
  const unwire = (id: string) => {
    wired.get(id)?.disconnect();
    wired.delete(id);
    remote.delete(id);
  };

  const Native = window.RTCPeerConnection;
  if (Native) {
    const Watched = function (...args: ConstructorParameters<typeof RTCPeerConnection>) {
      const pc = new Native(...args);
      // Hers: made while her face connects — or made by Anam's SDK at any time, since it
      // builds a new connection when it reconnects mid-session, and hearing that one would
      // have her hear her own voice.
      if (buildingFace || /initPeerConnection/.test(new Error().stack ?? "")) hers.add(pc);
      pc.addEventListener("track", (e: RTCTrackEvent) => {
        if (e.track.kind !== "audio" || hers.has(pc)) return;
        remote.set(e.track.id, e.track);
        e.track.addEventListener("ended", () => unwire(e.track.id));
        wire(e.track);
      });
      return pc;
    } as unknown as typeof RTCPeerConnection;
    Watched.prototype = Native.prototype;
    Object.setPrototypeOf(Watched, Native);
    window.RTCPeerConnection = Watched;
  }

  /** Mixes everybody else's audio at 24 kHz and hands it to the runner in small pieces. */
  const ensureHearing = () => {
    if (hearCtx) return;
    hearCtx = new AudioContext({ sampleRate: 24000 });
    hearMix = hearCtx.createGain();
    const tap = hearCtx.createScriptProcessor(2048, 1, 1);
    hearMix.connect(tap);
    tap.connect(hearCtx.destination); // it only runs when connected; it outputs silence
    tap.onaudioprocess = (e) => {
      if (!hearing) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const bytes = new Uint8Array(pcm.buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      try {
        window.__avaHear?.(btoa(bin));
      } catch {
        /* runner not listening */
      }
    };
    for (const t of remote.values()) wire(t);
  };

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

  /**
   * Her face's sound reaches her microphone only while she is speaking through it. Between
   * sentences the face's audio still carries the stream's own hiss — hidden while Meet's
   * Studio sound was scrubbing her voice, a steady noise under the conversation once it
   * was off. Opened as soon as her voice is sent to the face, closed a margin after it has
   * played; the face's level while closed is logged once per session.
   */
  let faceOpenUntil = 0;
  let faceGateOpen = false;
  let faceMeter: AnalyserNode | null = null;
  let faceLevelNoted = false;
  const gateFace = () => {
    if (!audio || !faceGain) return;
    const open = Date.now() < faceOpenUntil;
    if (open === faceGateOpen) return;
    faceGateOpen = open;
    const at = audio.currentTime;
    faceGain.gain.cancelScheduledValues(at);
    faceGain.gain.setTargetAtTime(open ? 1 : 0, at, open ? 0.01 : 0.05);
  };
  const openFaceSound = (untilMs: number) => {
    faceOpenUntil = Math.max(faceOpenUntil, untilMs);
    gateFace();
  };
  const muteFaceSound = () => {
    faceOpenUntil = 0;
    gateFace();
  };
  /**
   * How far her face's lips run behind the voice it is sent, measured: from sending the
   * first sound of a reply to that sound coming back out of the face. Her own voice is
   * held back by the same amount, so the lips match it. Starts at FACE_LAG_MS.
   */
  let faceLagMs = FACE_LAG_MS;
  let lagProbe: { sentAt: number } | null = null;
  let lagProbedTurn = "";
  let lagMeasured = 0;
  const probeFaceLag = () => {
    if (!lagProbe || !faceMeter) return;
    const waited = performance.now() - lagProbe.sentAt;
    if (waited > 2500) {
      lagProbe = null;
      return;
    }
    const samples = new Float32Array(faceMeter.fftSize);
    faceMeter.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = samples.length - 480; i < samples.length; i++) sum += samples[i] * samples[i];
    if (10 * Math.log10(sum / 480 + 1e-12) < -45) return;
    lagProbe = null;
    if (waited < 150 || waited > 2000) return;
    faceLagMs = lagMeasured ? Math.round(faceLagMs * 0.6 + waited * 0.4) : Math.round(waited);
    if (lagMeasured++ < 3) log(`her lips run ${Math.round(waited)} ms behind — her voice is held back ${faceLagMs} ms to match`);
  };

  const noteFaceLevel = () => {
    if (faceLevelNoted || !faceMeter || faceGateOpen || face !== "live" || Date.now() - sessionAt < 3000) return;
    if (rtSources.length > 0 || Date.now() < rtFaceEnd + 500 || isSpeaking) return;
    const samples = new Float32Array(faceMeter.fftSize);
    faceMeter.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const s of samples) sum += s * s;
    const db = 10 * Math.log10(sum / samples.length + 1e-12);
    faceLevelNoted = true;
    log(`face sound while she is quiet: ${db.toFixed(0)} dBFS — kept out of her microphone`);
  };
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
    faceMeter = null;
    faceGone();
    if (c) void c.stopStreaming().catch(() => {});
  };

  /**
   * When not to try again. Anam refusing because the plan's minutes are used up will not
   * change mid-meeting, and every attempt made her wait before answering; anything else
   * gets a short pause before the next try.
   */
  let faceRetryAt = 0;

  const openFace = (): Promise<boolean> => {
    if (mode !== "avatar" || Date.now() < faceRetryAt) return Promise.resolve(false);
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
        buildingFace = true;
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

        // Her own face's sound is never something she hears.
        for (const t of stream!.getAudioTracks()) unwire(t.id);
        const { audio, faceGain } = ensureAudio();
        faceSound = audio.createMediaStreamSource(new MediaStream(stream!.getAudioTracks()));
        faceSound.connect(faceGain);
        // Closed until she speaks through it (see gateFace).
        faceGain.gain.cancelScheduledValues(audio.currentTime);
        faceGain.gain.value = 0;
        faceGateOpen = false;
        faceOpenUntil = 0;
        faceMeter = audio.createAnalyser();
        faceMeter.fftSize = 2048;
        faceSound.connect(faceMeter);
        faceLevelNoted = false;
        faceInput = c.createAgentAudioInputStream({ encoding: "pcm_s16le", sampleRate: options.pcmRate ?? PCM_RATE, channels: 1 });
        faceGonePromise = new Promise<void>((r) => (faceGone = r));
        face = "live";
        sessionAt = Date.now();
        log(`face live (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        return true;
      } catch (e) {
        // Anam's own reason rides on `cause` ("…is a persona ID…"); without it the log only
        // said "Invalid request to start session".
        const cause = e instanceof Error && e.cause ? ` — ${String(e.cause)}` : "";
        const why = (e instanceof Error ? e.message : String(e)) + cause;
        if (/usage limit|spend cap|upgrade your plan|sign up for a plan|quota/i.test(why)) {
          // Out of minutes on this account: the next one takes over, straight away.
          const next = await window.__avaAnamUsedUp?.().catch(() => null);
          if (next) {
            faceRetryAt = 0;
            log(`Anam refused: ${why} — trying her next Anam account (${next})`);
            setTimeout(() => {
              if (face === "down" && Date.now() - lastActive < options.idleSeconds * 1000) void openFace();
            }, 300);
          } else {
            faceRetryAt = Number.POSITIVE_INFINITY;
            log(`Anam refused: ${why} — she carries on with her voice and her resting face`);
          }
        } else {
          faceRetryAt = Date.now() + 30_000;
        }
        if (gen === generation) dropFace(`could not connect: ${why}`);
        if (video !== faceVideo) video?.remove();
        return false;
      } finally {
        buildingFace = false;
        if (gen === generation || face !== "connecting") opening = null;
      }
    })();
    return opening;
  };

  // Her face's sound: shut when she is not speaking through it (see gateFace); and how far
  // its lips run behind (see probeFaceLag), checked often enough to be accurate.
  if (mode === "avatar") {
    setInterval(() => {
      gateFace();
      noteFaceLevel();
    }, 50);
    setInterval(probeFaceLag, 10);
  }

  // Close when the conversation has gone quiet (minutes are billed), and reconnect ahead
  // of Anam's cut-off at a moment she is not speaking, rather than be cut off mid-word.
  if (mode === "avatar") {
    setInterval(() => {
      // Not mid-reply: renewing then would stop her lips halfway through a sentence.
      if (face !== "live" || isSpeaking || rtSources.length > 0 || Date.now() < rtFaceEnd) return;
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
      // No face and no clip of her yet: a card with her name, never a black tile.
      const name = options.name || "Ava";
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#1e293b");
      bg.addColorStop(1, "#0f172a");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#38bdf8";
      g.beginPath();
      g.arc(W / 2, H / 2 - 40, 110, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#0f172a";
      g.font = "600 120px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(name.charAt(0).toUpperCase(), W / 2, H / 2 - 32);
      g.fillStyle = "#e2e8f0";
      g.font = "500 44px system-ui, sans-serif";
      g.fillText(name, W / 2, H / 2 + 130);
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

  /** Hands one caption block to the runner, if its text changed since last time. */
  const report = (block: Element, speaker: string, text: string) => {
    if (!text || text === sent.get(block)) return;
    sent.set(block, text);
    try {
      window.__avaHeard?.(speaker, text, idOf(block));
    } catch {
      /* runner not listening yet */
    }
  };

  /**
   * Teams: each caption entry holds its author and its text, marked with `data-tid`
   * attributes, and like Meet it rewrites the entry in place as the sentence goes on.
   * The entry is found by climbing from the text to the nearest element that also holds
   * an author — climbing further would reach the whole list and the first author in it.
   */
  const readTeamsCaptions = () => {
    const texts = document.querySelectorAll<HTMLElement>('[data-tid="closed-caption-text"]');
    for (const t of Array.from(texts)) {
      let entry: HTMLElement | null = t.parentElement;
      let author: Element | null = null;
      for (let i = 0; i < 6 && entry; i++) {
        author = entry.querySelector('[data-tid="author"]');
        if (author) break;
        entry = entry.parentElement;
      }
      report(entry ?? t, author?.textContent?.trim() || "Someone", t.innerText.trim());
    }
    return texts.length > 0;
  };

  const readCaptions = () => {
    // Teams, when its own markers are there; otherwise the generic reader below, which is
    // how Meet draws them and a fair guess at anything labelled as captions.
    if (platform === "teams" && readTeamsCaptions()) return;

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
      report(block, speaker, text);
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

  let startCalled = false;

  /* ── her voice from GPT-Live, played as it streams in ────────────────────── */

  const RT_RATE = 24000;
  let rtItem = "";
  /**
   * Where her voice is heard right now: through her face (lip-synced) or straight into her
   * microphone. The face whenever it is up. When it comes up mid-reply, it takes over at
   * the next pause — the face plays what it is sent about FACE_LAG_MS later, so a switch
   * leaves a short gap, and in a pause nobody hears it. (Chosen once per reply, it kept a
   * greeting that began before the face was up — and everything after — off the face.)
   */
  let rtVia: "face" | "mic" = "mic";
  /** Voice: when the next piece is due, on the audio clock. */
  let rtNext = 0;
  let rtSources: AudioBufferSourceNode[] = [];
  /** Face: when what was sent to it ends, on the wall clock. */
  let rtFaceEnd = 0;
  /** Live is meant to stream in step with the room; if it runs ahead, say so once a turn. */
  let rtAheadSaid = "";

  const pcm24 = (bytes: Uint8Array) => {
    const n = bytes.length >> 1;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
  };
  /**
   * 24 kHz → 16 kHz for her face, which lip-syncs at 16 kHz. Filtered first: dropping to
   * 16 kHz without cutting what is above 8 kHz folds it back down as hiss, which is what
   * made her voice noisy. Up by 2, a windowed-sinc low-pass at 7.2 kHz, down by 3 — with
   * the filter's history carried from one piece to the next, so no clicks at the joins.
   */
  const RS_TAPS = (() => {
    const n = 64;
    const fc = 7200 / 48000;
    const h = new Float32Array(n);
    const mid = (n - 1) / 2;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t = i - mid;
      const sinc = Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
      h[i] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)));
      sum += h[i];
    }
    // ×2: every other sample of the doubled stream is a zero.
    for (let i = 0; i < n; i++) h[i] = (h[i] / sum) * 2;
    return h;
  })();
  let rsTail = new Float32Array(0);
  let rsBase = 0;
  let rsOut = 0;
  const resetResampler = () => {
    rsTail = new Float32Array(0);
    rsBase = 0;
    rsOut = 0;
  };
  const to16k = (samples: Float32Array) => {
    const buf = new Float32Array(rsTail.length + samples.length);
    buf.set(rsTail);
    buf.set(samples, rsTail.length);
    const end = rsBase + buf.length;
    const out: number[] = [];
    // Output n sits at 3n on the 48 kHz grid; input j at 2j.
    while (Math.floor((3 * rsOut) / 2) < end) {
      const at = 3 * rsOut;
      let acc = 0;
      for (let k = at % 2; k < RS_TAPS.length; k += 2) {
        const j = (at - k) / 2;
        if (j < rsBase) break;
        acc += RS_TAPS[k] * buf[j - rsBase];
      }
      out.push(acc);
      rsOut++;
    }
    const keep = Math.min(buf.length, RS_TAPS.length);
    rsTail = buf.slice(buf.length - keep);
    rsBase = end - keep;
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767)));
    return new Uint8Array(pcm.buffer);
  };
  /** A piece with no speech in it — a pause, where switching to the face goes unheard. */
  const quiet = (samples: Float32Array) => {
    for (let i = 0; i < samples.length; i++) if (samples[i] > 0.025 || samples[i] < -0.025) return false;
    return true;
  };
  const stopStream = () => {
    for (const s of rtSources) {
      try {
        s.stop();
      } catch {
        /* already done */
      }
    }
    rtSources = [];
    rtNext = 0;
    rtFaceEnd = 0;
    rtItem = "";
  };

  const api: AvaApi = {
    async start(opts = {}) {
      if (startCalled) return;
      startCalled = true;
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

      firstToken = opts.token;
      lastActive = Date.now();
      if (opts.faceLater) {
        // The camera shows her at rest until somebody is there to see her.
        log("voice ready — her face connects when somebody else arrives");
        markReady();
        return;
      }
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

        openFaceSound(Date.now() + ms + FACE_LAG_MS + FACE_TAIL_MS);
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

    rest() {
      if (mode !== "avatar" || face === "down") return;
      dropFace("nobody else is in the meeting");
    },

    interrupt() {
      try {
        playing?.stop();
      } catch {
        /* already stopped */
      }
      const streaming = rtSources.length > 0 || Date.now() < rtFaceEnd;
      stopStream();
      if (streaming && faceGain && face === "live") {
        muteFaceSound();
        try {
          client?.interruptPersona();
        } catch {
          /* nothing in flight */
        }
      }
      // The face has the rest of the sentence queued: silence it until that has played
      // out, rather than let it carry on over the person who cut in.
      if (faceGain && isSpeaking && face === "live") {
        muteFaceSound();
        try {
          client?.interruptPersona();
        } catch {
          /* nothing in flight */
        }
      }
      done();
    },

    speaking: () => isSpeaking || rtSources.length > 0 || Date.now() < rtFaceEnd,
    face: () => (mode === "voice" ? "voice" : face),
    started: () => startCalled,

    listen(on) {
      hearing = on;
      if (on) {
        ensureHearing();
        if (hearCtx?.state === "suspended") void hearCtx.resume().catch(() => {});
      }
    },

    feed(base64, turn) {
      const { audio, mic, faceGain } = ensureAudio();
      const bytes = bytesOf(base64);
      const samples = pcm24(bytes);
      lastActive = Date.now();
      const faceReady = mode === "avatar" && face === "live" && Boolean(faceInput);
      if (turn !== rtItem) {
        rtItem = turn;
        rtVia = faceReady ? "face" : "mic";
        resetResampler();
        // A little ahead, so a piece arriving late does not leave a click in the middle.
        rtNext = Math.max(rtNext, audio.currentTime + 0.15);
      } else if (rtVia === "mic" && faceReady && quiet(samples)) {
        // The face came up while she was talking: it takes over at this pause.
        rtVia = "face";
        resetResampler();
      } else if (rtVia === "face" && !faceReady) {
        // The face went away mid-reply (renewing, or lost): carry on through the microphone.
        rtVia = "mic";
      }
      const ms = (samples.length / RT_RATE) * 1000;
      const ahead = (s: number) => {
        if (s > 1.5 && rtAheadSaid !== turn) {
          rtAheadSaid = turn;
          log(`her voice is arriving ${s.toFixed(1)} s ahead of the room — an interruption would not stop it at once`);
        }
      };
      /** Into her microphone, each piece after the last, at least `lead` seconds from now. */
      const schedule = (lead: number) => {
        const buffer = audio.createBuffer(1, Math.max(1, samples.length), RT_RATE);
        buffer.getChannelData(0).set(samples);
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(mic);
        const at = Math.max(audio.currentTime + lead, rtNext);
        source.start(at);
        rtNext = at + buffer.duration;
        ahead(rtNext - audio.currentTime - lead);
        rtSources.push(source);
        source.onended = () => {
          rtSources = rtSources.filter((s) => s !== source);
        };
      };
      if (rtVia === "face" && faceInput) {
        // Her lips: the face is sent her voice and moves them to it, faceLagMs later.
        faceInput.sendAudioChunk((options.pcmRate ?? PCM_RATE) === RT_RATE ? base64 : to16k(samples));
        const now = Date.now();
        rtFaceEnd = Math.max(rtFaceEnd, now + faceLagMs) + ms;
        if (options.faceAudio === "anam") {
          // Heard through the face, from now (so no word's start is cut) to a margin after.
          openFaceSound(rtFaceEnd + FACE_TAIL_MS);
          ahead((rtFaceEnd - now - faceLagMs) / 1000);
          return;
        }
        // Heard straight from GPT-Live, held back by the face's lag so her lips match. The
        // face's own copy of her voice has been cut to 16 kHz, through Anam's servers and
        // through one more codec: that was the noise on her voice.
        if (lagProbedTurn !== turn && !quiet(samples)) {
          lagProbedTurn = turn;
          lagProbe = { sentAt: performance.now() };
        }
        schedule(faceLagMs / 1000);
        return;
      }
      // No face (or voice mode): straight into her microphone.
      schedule(0.05);
    },

    feedDone() {
      if (mode === "avatar" && face === "live" && faceInput && Date.now() < rtFaceEnd) faceInput.endSequence();
    },

    async end() {
      hearing = false;
      if (mode !== "avatar") return;
      faceRetryAt = Number.POSITIVE_INFINITY; // nothing may reconnect it now
      const c = client;
      dropFace("the meeting is over");
      await c?.stopStreaming().catch(() => {});
    },
  };

  window.__ava = api;
}
