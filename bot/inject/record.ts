/**
 * A test call recorded, to find where noise in her voice comes from (AVA_RECORD_VOICE=1; off
 * otherwise). Two points of the path, each up to three minutes from her first word:
 *   "raw" — GPT-Live's voice as it arrives, 24 kHz, before anything of hers touches it;
 *   "mic" — what her microphone gives Meet, 48 kHz, recorded off the very track Meet sends.
 * And Meet's own numbers for the sound it sends — codec, bitrate, packets lost, jitter,
 * round trip — logged every 15 seconds. Her voice only: nobody else's is recorded.
 * Handed to her runner when the call ends; it writes them to /data/recordings.
 */
type Send = (kind: string, part: number, base64: string, last: boolean, rate: number) => Promise<void>;

const MAX_SECONDS = 180;
const PART = 1 << 18; // samples per piece handed over

export function makeRecorder(log: (m: string) => void) {
  const raw: Float32Array[] = [];
  let rawLen = 0;
  const mic: Float32Array[] = [];
  let micLen = 0;
  let ctx: AudioContext | null = null;
  const pcs = new Set<RTCPeerConnection>();
  let timer: number | null = null;
  const before = new Map<string, { bytes: number; at: number }>();

  const stats = async () => {
    for (const pc of pcs) {
      if (pc.connectionState === "closed") {
        pcs.delete(pc);
        continue;
      }
      const reports = await pc.getStats().catch(() => null);
      if (!reports) continue;
      const all = [...reports.values()] as Record<string, unknown>[];
      for (const out of all.filter((r) => r.type === "outbound-rtp" && r.kind === "audio")) {
        const codec = all.find((r) => r.id === out.codecId);
        const back = all.find((r) => r.type === "remote-inbound-rtp" && r.kind === "audio" && r.localId === out.id);
        const id = String(out.id);
        const bytes = Number(out.bytesSent ?? 0);
        const now = performance.now();
        const prev = before.get(id);
        before.set(id, { bytes, at: now });
        const kbps = prev ? ((bytes - prev.bytes) * 8) / (now - prev.at) : null;
        log(
          `sound out: ${codec?.mimeType ?? "?"} ${codec?.clockRate ?? "?"}/${codec?.channels ?? "?"}` +
            `${kbps !== null ? `, ${kbps.toFixed(0)} kbps` : ""}` +
            (back
              ? `, lost ${back.packetsLost ?? "?"} (${(Number(back.fractionLost ?? 0) * 100).toFixed(1)}%), jitter ${(Number(back.jitter ?? 0) * 1000).toFixed(0)} ms, round trip ${(Number(back.roundTripTime ?? 0) * 1000).toFixed(0)} ms`
              : "") +
            `${codec?.sdpFmtpLine ? ` [${codec.sdpFmtpLine}]` : ""}`,
        );
      }
    }
  };

  return {
    /** A piece of GPT-Live's voice as it arrived. */
    raw(samples: Float32Array) {
      if (rawLen >= 24000 * MAX_SECONDS) return;
      raw.push(samples.slice());
      rawLen += samples.length;
    },
    /** Starts recording what her microphone gives Meet (once). */
    mic(stream: MediaStream) {
      if (ctx) return;
      ctx = new AudioContext({ sampleRate: 48000 });
      const src = ctx.createMediaStreamSource(stream);
      const tap = ctx.createScriptProcessor(4096, 1, 1);
      tap.onaudioprocess = (e) => {
        if (micLen >= 48000 * MAX_SECONDS) return;
        const d = e.inputBuffer.getChannelData(0);
        mic.push(new Float32Array(d));
        micLen += d.length;
      };
      src.connect(tap);
      tap.connect(ctx.destination); // it only runs when connected; it outputs silence
      void ctx.resume().catch(() => {});
      log("recording this call's voice (AVA_RECORD_VOICE)");
    },
    /** Meet's connection, for its numbers. */
    watch(pc: RTCPeerConnection) {
      pcs.add(pc);
      if (timer === null) timer = window.setInterval(() => void stats(), 15_000);
    },
    /** Hands both recordings to her runner, with how many samples were past full scale. */
    async save(send: Send) {
      if (timer !== null) window.clearInterval(timer);
      await stats();
      await ctx?.close().catch(() => {});
      for (const [kind, parts, rate] of [["raw", raw, 24000], ["mic", mic, 48000]] as const) {
        const total = parts.reduce((n, p) => n + p.length, 0);
        if (!total) continue;
        const pcm = new Int16Array(total);
        let o = 0;
        let clipped = 0;
        let peak = 0;
        for (const p of parts) {
          for (let i = 0; i < p.length; i++) {
            const v = p[i];
            const a = Math.abs(v);
            if (a > peak) peak = a;
            if (a > 1) clipped++;
            const s = Math.max(-1, Math.min(1, v));
            pcm[o++] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
        }
        log(`recorded ${kind}: ${(total / rate).toFixed(1)} s, peak ${(20 * Math.log10(peak || 1e-9)).toFixed(1)} dBFS, ${clipped} samples past full scale`);
        for (let start = 0, part = 0; start < total; start += PART, part++) {
          const bytes = new Uint8Array(pcm.buffer, start * 2, Math.min(PART, total - start) * 2);
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          await send(kind, part, btoa(bin), start + PART >= total, rate);
        }
      }
    },
  };
}
