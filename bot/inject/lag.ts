/**
 * How far her face's lips run behind the voice it is sent, from one reading to the next. A
 * reading is how long the face took to play back the first sound of one of her replies.
 *
 * Steady readings are averaged in. One far from the rest is a hiccup — one slow reply of the
 * face's — and is left out: averaged in, a single 1368 ms among readings of 739 and 795 ms
 * held her voice back a quarter of a second too long for the rest of the call. Two such in a
 * row, close to each other, mean the lag has really changed, and she follows it.
 */
export type Lag = { ms: number; readings: number; odd: number | null };
export type LagStep = Lag & { said: "first" | "steady" | "hiccup" | "changed" };

/** Far from the rest: more than a quarter of a second, or a third of the lag, off it. */
const far = (reading: number, from: number) => Math.abs(reading - from) > Math.max(250, from * 0.35);

export function nextLag(lag: Lag, reading: number): LagStep {
  const ms = Math.round(reading);
  if (!lag.readings) return { ms, readings: 1, odd: null, said: "first" };
  if (!far(ms, lag.ms)) return { ms: Math.round(lag.ms * 0.6 + ms * 0.4), readings: lag.readings + 1, odd: null, said: "steady" };
  if (lag.odd !== null && !far(ms, lag.odd)) return { ms: Math.round((lag.odd + ms) / 2), readings: lag.readings + 1, odd: null, said: "changed" };
  return { ...lag, odd: ms, said: "hiccup" };
}
