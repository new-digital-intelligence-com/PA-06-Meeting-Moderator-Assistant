/**
 * Her voice, 24 kHz as GPT-Live sends it, doubled to 48 kHz — the rate her microphone runs
 * at, and Meet's own — piece by piece, with the filter's history carried from one piece to
 * the next, so the joins are seamless.
 *
 * Left to Chrome, each piece was converted on its own, crudely, to whatever rate the page's
 * audio ran at (44.1 kHz on her server): measured with a test tone, that gave a signal-to-noise
 * of 41 dB at best and 19 dB at the joins — the noise and crackle on her voice. Doubled here,
 * into a 48 kHz audio engine: 119 dB throughout, not a sample off.
 *
 * A windowed-sinc low-pass (Blackman, 96 taps, 11 kHz): the doubled stream has zeros between
 * the samples, so each output needs only every other tap — two phases of 48.
 */
const TAPS = (() => {
  const n = 96;
  const fc = 11000 / 48000;
  const h = new Float32Array(n);
  const mid = (n - 1) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)));
    sum += h[i];
  }
  // ×2: half the samples of the doubled stream are zeros.
  for (let i = 0; i < n; i++) h[i] = (h[i] / sum) * 2;
  return h;
})();

export type Upsampler = { (piece: Float32Array): Float32Array; reset(): void };

/** A ×2 upsampler that remembers the end of the last piece. */
export function makeUp2(): Upsampler {
  const H = TAPS.length / 2;
  let hist = new Float32Array(H);
  const up = ((x: Float32Array) => {
    const buf = new Float32Array(H + x.length);
    buf.set(hist);
    buf.set(x, H);
    const out = new Float32Array(x.length * 2);
    for (let i = 0; i < x.length; i++) {
      const p = H + i;
      let even = 0;
      let odd = 0;
      for (let j = 0; j < H; j++) {
        const s = buf[p - j];
        even += TAPS[2 * j] * s;
        odd += TAPS[2 * j + 1] * s;
      }
      out[2 * i] = even;
      out[2 * i + 1] = odd;
    }
    hist = buf.slice(buf.length - H);
    return out;
  }) as Upsampler;
  up.reset = () => {
    hist = new Float32Array(H);
  };
  return up;
}
