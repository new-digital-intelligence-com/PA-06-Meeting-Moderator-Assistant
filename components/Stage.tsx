"use client";

/**
 * The stage — what the meeting sees, and nothing else.
 *
 * Recall streams this page into the call as Ava's camera tile, so it is her face full
 * frame and no more than that. No agenda, no timer, no action list: her tile sits in a
 * grid with the real people's tiles, and a participant with a dashboard stuck to their
 * chest reads as signage, not as somebody in the room. Everything worth *reading*
 * belongs in the control room, where it can be read properly.
 *
 * What is left here is the loop:
 *
 *   captions in  →  post to /api/moderator/tick  →  say whatever comes back
 *
 * It only ticks while she is silent, so she can never talk over herself, and a line is
 * reported as delivered on the following tick — the server records a cue as spoken only
 * once she has actually said it, so a line lost to a dead stream comes back round.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnamStream } from "./useAnamStream";

/**
 * The idle heartbeat. Kept short because it is only a POST — the thing that actually
 * costs time is the model call, and that only happens when she is spoken to.
 */
const TICK_MS = 1200;
/** Recall exposes the live transcript to the page it is streaming, on this socket. */
const TRANSCRIPT_WS = "wss://meeting-data.bot.recall.ai/api/v1/transcript";

/** Anam attaches its media by element id, so this is fixed and referenced by name. */
const VIDEO_ID = "ava-video";

type Line = { id: string; speaker: string; text: string; at: number };

/**
 * Recall's socket and Recall's webhooks wrap the same payload differently, and the
 * shape has moved between API versions. Rather than pin one, pull the two fields we
 * need out of whichever nesting arrived.
 */
function readLine(raw: string): Line | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  // Partial results are the caption still being typed — waiting for the final one
  // costs a second and saves her answering half a sentence.
  const event = (payload as { event?: string }).event;
  if (event && event.endsWith("partial_data")) return null;

  const nested = payload as Record<string, Record<string, Record<string, unknown>>>;
  const t =
    (payload.transcript as Record<string, unknown> | undefined) ??
    (nested.data?.data as Record<string, unknown> | undefined) ??
    (payload.data as Record<string, unknown> | undefined) ??
    payload;

  const words = (t?.words ?? []) as { text?: string; start_timestamp?: { relative?: number } }[];
  const text = words
    .map((w) => w.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const participant = (t?.participant ?? {}) as { name?: string | null; id?: number };
  const start = words[0]?.start_timestamp?.relative ?? 0;

  return {
    // Speaker plus utterance start is stable across redeliveries, so the server can
    // drop a line it has already filed.
    id: `${participant.id ?? participant.name ?? "x"}-${start.toFixed(2)}`,
    speaker: participant.name?.trim() || "Someone",
    text,
    at: Date.now(),
  };
}

export default function Stage() {
  const { videoRef, status, detail, speak } = useAnamStream();
  const [wsOpen, setWsOpen] = useState(false);
  /** Her name, for spotting when a caption is aimed at her. */
  const nameRef = useRef<RegExp | null>(null);

  /** Lines heard since the last tick. */
  const buffer = useRef<Line[]>([]);
  /** True from the moment we ask her to speak until she has finished. */
  const speaking = useRef(false);
  const tickBusy = useRef(false);
  /** A cue she has spoken but not yet reported; sent with the next tick. */
  const pendingDelivery = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/anam")
      .then((r) => r.json())
      .then((d) => {
        // A word-boundary match on her name, not a substring — otherwise "available"
        // summons her mid-sentence. Mirrors isAddressed() on the server; this copy
        // exists only to decide whether to tick early.
        const n = String(d.botName ?? "Ava").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        nameRef.current = new RegExp(`\\b${n}\\b`, "i");
      })
      .catch(() => undefined);
  }, []);

  /* ── the loop ─────────────────────────────────────────────────────────── */
  const tick = useCallback(async () => {
    if (tickBusy.current) return;
    tickBusy.current = true;

    const lines = buffer.current;
    buffer.current = [];
    const delivered = pendingDelivery.current;
    pendingDelivery.current = null;

    try {
      const res = await fetch("/api/moderator/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, idle: !speaking.current, delivered }),
      });
      const data = await res.json();

      if (data.say && !speaking.current) {
        speaking.current = true;
        try {
          const said = await speak(data.say);
          // Only a line she actually got out counts. A failed one stays unrecorded
          // and comes back round on the next tick.
          if (said && data.key) pendingDelivery.current = data.key;
        } finally {
          speaking.current = false;
        }
      }
    } catch {
      // A dropped tick is survivable: the lines we took are lost from the buffer, but
      // the loop continues and an unconfirmed cue is still pending.
      if (delivered) pendingDelivery.current = delivered;
    } finally {
      tickBusy.current = false;
    }
  }, [speak]);

  useEffect(() => {
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  /* ── the meeting's captions ───────────────────────────────────────────── */
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | undefined;

    const open = () => {
      try {
        socket = new WebSocket(TRANSCRIPT_WS);
      } catch {
        return; // not running inside a Recall bot — the page still renders
      }
      socket.onopen = () => setWsOpen(true);
      socket.onclose = () => {
        setWsOpen(false);
        retry = window.setTimeout(open, 5000);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (event) => {
        const line = readLine(String(event.data));
        if (!line) return;
        buffer.current.push(line);
        // Somebody just said her name. Waiting out the heartbeat before even noticing
        // would put a second on top of a reply that is already slower than a person's,
        // so go now. The tick guards itself against overlapping.
        if (nameRef.current?.test(line.text)) void tick();
      };
    };

    open();
    return () => {
      window.clearTimeout(retry);
      socket?.close();
    };
    // `tick` is stable after mount — its whole chain of callbacks is — so naming it
    // here does not reconnect the socket. It is listed because the socket calls it.
  }, [tick]);

  const live = status === "live" || status === "speaking";

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Deliberately NOT muted. Recall captures this page's audio output, so a muted
          element is a meeting that sees her mouth move and hears nothing. */}
      <video id={VIDEO_ID} ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" />

      {/* Only before she is up. Once the stream is live the tile is pure video — no
          overlay, nothing to read. The status here is not decoration: a black tile
          with no explanation is exactly what made the first failure so hard to place. */}
      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-10 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/face.png" alt="" className="h-48 w-48 rounded-full object-cover opacity-70" />
          <p className="text-lg text-white/55">
            {status === "unconfigured"
              ? "No Anam persona configured"
              : wsOpen
                ? "Connecting…"
                : "Connecting…"}
          </p>
          {detail && <p className="max-w-lg text-sm text-white/30">{detail}</p>}
        </div>
      )}
    </main>
  );
}
