/**
 * Her voice following her face. The face (Anam) plays what it is sent some time later — and
 * that time changes from one reply to the next (432 to 915 ms in a single call). Held back by
 * one figure for the whole call, her voice ran up to a third of a second ahead of her lips, or
 * behind them. So each stretch of her voice waits for the face to start sounding it — its
 * first loud moment, heard in the face's own sound — and plays from there: the lips' delay
 * taken as it is each time, not guessed. A stretch already playing carries straight on.
 *
 * Only what the face sounds after a quiet moment counts (the end of the last stretch must not
 * start this one). If the face stays quiet too long, her voice goes on without it.
 */
export type Follower = {
  /** A piece of her voice just sent to the face. `busy`: her voice is still playing a stretch. */
  add(samples: Float32Array, busy: boolean): void;
  /** Every 10 ms: how loud the face is now (dBFS over the last 10 ms). */
  tick(faceDb: number): void;
  /** A stretch with nothing loud in it, or the face gone: out now, held no longer. */
  flush(): void;
  /** Forget what is held (she was interrupted). */
  drop(): void;
  holding(): boolean;
};

type Options = {
  /** Her voice's rate (24 kHz). */
  rate: number;
  nowMs(): number;
  /** Plays these samples now, or straight after what is playing. */
  play(samples: Float32Array): void;
  /** The face started sounding a stretch this long after its first loud sound was sent. */
  followed?(ms: number): void;
  /** The face stayed quiet: her voice went on without it. */
  gaveUp?(): void;
  /** Kept from before her first loud sound, so its start is not clipped (seconds). */
  preroll?: number;
  /** How long to wait for the face before going on without it. */
  giveUpMs?: number;
};

/** Loud: what her voice is when she is saying something, not the hush around it. */
const LOUD = 0.025;
const LOUD_DB = -45;
const QUIET_DB = -50;

export function makeFollower(o: Options): Follower {
  const preroll = o.preroll ?? 0.03;
  const giveUpMs = o.giveUpMs ?? 1500;
  let stretch: {
    pieces: Float32Array[];
    /** Seconds of her voice held so far; when the first piece came. */
    held: number;
    since: number;
    /** Where, in seconds into the stretch, her first loud sound is; when it was sent. */
    loudAt: number | null;
    loudSentAt: number;
    /** The face has been quiet a moment since the stretch began: what it sounds next is this. */
    armed: boolean;
    quietMs: number;
  } | null = null;

  const release = (followedMs: number | null) => {
    const s = stretch;
    if (!s) return;
    stretch = null;
    const total = s.pieces.reduce((n, p) => n + p.length, 0);
    const all = new Float32Array(total);
    let o2 = 0;
    for (const p of s.pieces) {
      all.set(p, o2);
      o2 += p.length;
    }
    // From just before her first loud sound — where the face is now; the hush before it is
    // left out, as the face has already played it.
    const from = followedMs !== null && s.loudAt !== null ? Math.max(0, Math.round((s.loudAt - preroll) * o.rate)) : 0;
    if (followedMs !== null) o.followed?.(followedMs);
    o.play(all.subarray(from));
  };

  return {
    add(samples, busy) {
      if (!stretch && busy) {
        o.play(samples);
        return;
      }
      if (!stretch) stretch = { pieces: [], held: 0, since: o.nowMs(), loudAt: null, loudSentAt: 0, armed: false, quietMs: 0 };
      const s = stretch;
      if (s.loudAt === null) {
        for (let i = 0; i < samples.length; i++) {
          if (samples[i] > LOUD || samples[i] < -LOUD) {
            s.loudAt = s.held + i / o.rate;
            s.loudSentAt = o.nowMs();
            break;
          }
        }
      }
      s.pieces.push(samples);
      s.held += samples.length / o.rate;
    },
    tick(faceDb) {
      const s = stretch;
      if (!s) return;
      if (s.loudAt !== null && o.nowMs() - s.loudSentAt > giveUpMs) {
        o.gaveUp?.();
        release(null);
        return;
      }
      // Nothing loud in it after all this time: only hush, out as it is.
      if (s.loudAt === null && o.nowMs() - s.since > giveUpMs) {
        release(null);
        return;
      }
      if (!s.armed) {
        if (faceDb < QUIET_DB) {
          s.quietMs += 10;
          if (s.quietMs >= 60) s.armed = true;
        } else {
          s.quietMs = 0;
        }
        return;
      }
      if (s.loudAt !== null && faceDb > LOUD_DB) release(o.nowMs() - s.loudSentAt);
    },
    flush() {
      release(null);
    },
    drop() {
      stretch = null;
    },
    holding: () => stretch !== null,
  };
}
