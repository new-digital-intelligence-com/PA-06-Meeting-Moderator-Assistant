/**
 * What Meet (or Teams) actually sends of her camera — size, frames a second, bitrate, the
 * encoder, and what is holding it back (Chrome's own "cpu" or "bandwidth") — logged half a
 * minute into the call, then every two minutes, and whenever what holds it back changes. Her
 * camera is drawn on her server and compressed there in software, then Meet compresses it
 * again for each viewer: this says how much of her picture is getting through, and why not more.
 */
export function makeMeetStats(log: (m: string) => void) {
  const pcs = new Set<RTCPeerConnection>();
  let timer: number | null = null;
  let lastReason = "";
  let lastFull = 0;
  const before = new Map<string, { bytes: number; at: number }>();

  const look = async () => {
    for (const pc of pcs) {
      if (pc.connectionState === "closed") {
        pcs.delete(pc);
        continue;
      }
      const reports = await pc.getStats().catch(() => null);
      if (!reports) continue;
      const all = [...reports.values()] as Record<string, unknown>[];
      // Meet sends her camera at up to three sizes at once (simulcast): each layer is a report.
      const layers = all.filter((r) => r.type === "outbound-rtp" && r.kind === "video" && Number(r.bytesSent ?? 0) > 0);
      if (!layers.length) continue;
      const now = performance.now();
      const parts: string[] = [];
      const reasons = new Set<string>();
      for (const out of layers) {
        const id = String(out.id);
        const bytes = Number(out.bytesSent ?? 0);
        const prev = before.get(id);
        before.set(id, { bytes, at: now });
        const kbps = prev ? ((bytes - prev.bytes) * 8) / (now - prev.at) : null;
        const codec = all.find((r) => r.id === out.codecId);
        reasons.add(String(out.qualityLimitationReason ?? "none"));
        parts.push(
          `${out.frameWidth ?? "?"}x${out.frameHeight ?? "?"} @ ${Math.round(Number(out.framesPerSecond ?? 0))} fps` +
            `${kbps !== null ? `, ${kbps.toFixed(0)} kbps` : ""}` +
            `, ${String(codec?.mimeType ?? "?").replace("video/", "")} (${out.encoderImplementation ?? "?"})`,
        );
      }
      const reason = [...reasons].join("/");
      if (Date.now() - lastFull > 110_000 || reason !== lastReason) {
        lastFull = Date.now();
        lastReason = reason;
        log(`camera out: ${parts.join(" | ")} — held back by: ${reason}`);
      }
    }
  };

  return {
    /** A connection of the meeting's, not her face's. */
    watch(pc: RTCPeerConnection) {
      pcs.add(pc);
      if (timer !== null) return;
      // Half a minute in, once Meet has settled; then often enough to catch a change.
      window.setTimeout(() => void look(), 30_000);
      timer = window.setInterval(() => void look(), 15_000);
    },
  };
}
