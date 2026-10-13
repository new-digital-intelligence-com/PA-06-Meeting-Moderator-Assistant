/**
 * What Meet (or Teams) actually sends of her camera, logged 20, 45 and 75 seconds into the call,
 * then every two minutes and whenever what holds it back changes:
 *   - "drawn": what her camera produces — its size and frames a second (her canvas);
 *   - "sent": each layer Meet encodes of it — size, frames a second, bitrate, codec;
 *   - what holds the sending back (Chrome's own "cpu" or "bandwidth"), and how much the
 *     connection is estimated to carry.
 * Her camera is drawn on her server and compressed there in software, then Meet compresses
 * it again for each viewer: this says how much of her picture gets through, and why not more.
 * (With Meet's send resolution on Auto it sent 640x360 at 11 frames a second, held back by
 * nothing, of a camera drawn at 1280x720, 25 a second.)
 */
export function makeMeetStats(log: (m: string) => void) {
  const pcs = new Set<RTCPeerConnection>();
  let started = false;
  let lastReason = "";
  const before = new Map<string, { bytes: number; at: number }>();

  const look = async (always: boolean) => {
    for (const pc of pcs) {
      if (pc.connectionState === "closed") {
        pcs.delete(pc);
        continue;
      }
      const reports = await pc.getStats().catch(() => null);
      if (!reports) continue;
      const all = [...reports.values()] as Record<string, unknown>[];
      // Meet may send her camera at up to three sizes at once (simulcast): each is a layer.
      const layers = all.filter((r) => r.type === "outbound-rtp" && r.kind === "video" && Number(r.bytesSent ?? 0) > 0);
      if (!layers.length) continue;
      const now = performance.now();
      const sent: string[] = [];
      const reasons = new Set<string>();
      for (const out of layers) {
        const id = String(out.id);
        const bytes = Number(out.bytesSent ?? 0);
        const prev = before.get(id);
        before.set(id, { bytes, at: now });
        const kbps = prev ? ((bytes - prev.bytes) * 8) / (now - prev.at) : null;
        const codec = all.find((r) => r.id === out.codecId);
        reasons.add(String(out.qualityLimitationReason ?? "none"));
        sent.push(
          `${out.frameWidth ?? "?"}x${out.frameHeight ?? "?"} @ ${Math.round(Number(out.framesPerSecond ?? 0))} fps` +
            `${kbps !== null ? ` ${kbps.toFixed(0)} kbps` : ""} ${String(codec?.mimeType ?? "?").replace("video/", "")}`,
        );
      }
      const source = all.find((r) => r.type === "media-source" && r.kind === "video");
      const pair = all.find((r) => r.type === "candidate-pair" && r.nominated && r.state === "succeeded");
      const reason = [...reasons].join("/");
      if (!always && reason === lastReason) continue;
      lastReason = reason;
      log(
        `camera: drawn ${source?.width ?? "?"}x${source?.height ?? "?"} @ ${Math.round(Number(source?.framesPerSecond ?? 0))} fps` +
          ` → sent ${sent.join(" | ")} — held back by: ${reason}` +
          `${pair?.availableOutgoingBitrate ? `; connection carries ~${(Number(pair.availableOutgoingBitrate) / 1000).toFixed(0)} kbps` : ""}`,
      );
    }
  };

  return {
    /** A connection of the meeting's, not her face's. */
    watch(pc: RTCPeerConnection) {
      pcs.add(pc);
      if (started) return;
      started = true;
      for (const s of [20, 45, 75]) window.setTimeout(() => void look(true), s * 1000);
      window.setTimeout(() => window.setInterval(() => void look(true), 120_000), 75_000);
      // In between, only when what holds it back changes.
      window.setInterval(() => void look(false), 15_000);
    },
  };
}
