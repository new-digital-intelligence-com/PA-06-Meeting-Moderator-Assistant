"use client";

/**
 * The stage — what the meeting actually sees.
 *
 * This page is loaded by Recall's browser and streamed into the call as Ava's camera
 * tile, at 1280x720. Everything it renders is on screen in the meeting and everything
 * it plays is heard in the room, so it is laid out for a small tile in a Meet grid:
 * big type, high contrast, nothing that needs to be read closely.
 *
 * It runs the only loop that matters:
 *
 *   captions in  →  post to /api/moderator/tick  →  say whatever comes back
 *
 * and it only ticks while she is silent, so she can never talk over herself. A line is
 * reported back as delivered on the following tick, and only then does the server
 * record it as said — a cue she could not speak is offered again rather than lost.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnamStream } from "./useAnamStream";

const TICK_MS = 2000;
/** Recall exposes the live transcript to the page it is streaming, on this socket. */
const TRANSCRIPT_WS = "wss://meeting-data.bot.recall.ai/api/v1/transcript";

/** Anam attaches its media by element id, so these are fixed and referenced by name. */
const VIDEO_ID = "ava-video";
const AUDIO_ID = "ava-audio";

type Line = { id: string; speaker: string; text: string; at: number };

type Timer = {
  index: number;
  total: number;
  title: string | null;
  owner: string | null;
  elapsed: number;
  planned: number;
  remaining: number;
  overrunning: boolean;
  meetingElapsed: number;
};

type Action = { id: string; text: string; owner?: string; due?: string; confirmed: boolean };

const mmss = (s: number) => {
  const sign = s < 0 ? "-" : "";
  const abs = Math.abs(Math.floor(s));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
};

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
  const { videoRef, audioRef, status, detail, speak } = useAnamStream();

  const [timer, setTimer] = useState<Timer | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [caption, setCaption] = useState("");
  const [wsOpen, setWsOpen] = useState(false);

  /** Lines heard since the last tick. */
  const buffer = useRef<Line[]>([]);
  /** True from the moment we ask her to speak until she has finished. */
  const speaking = useRef(false);
  const tickBusy = useRef(false);
  /** A cue she has spoken but not yet reported; sent with the next tick. */
  const pendingDelivery = useRef<string | null>(null);

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
        setCaption(`${line.speaker}: ${line.text}`);
      };
    };

    open();
    return () => {
      window.clearTimeout(retry);
      socket?.close();
    };
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
      if (data.timer) setTimer(data.timer);
      if (data.actions) setActions(data.actions);

      if (data.say && !speaking.current) {
        speaking.current = true;
        setCaption(`Ava: ${data.say}`);
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
      // the loop continues and undelivered cues are still pending.
      if (delivered) pendingDelivery.current = delivered;
    } finally {
      tickBusy.current = false;
    }
  }, [speak]);

  useEffect(() => {
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  const live = status === "live" || status === "speaking";
  const over = timer?.overrunning ?? false;

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#0b0f17] text-white">
      {/* her face */}
      <section className="relative flex h-full w-[52%] items-center justify-center bg-black">
        <video id={VIDEO_ID} ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {/* Recall captures this page's audio output, so this element is the path from
            her voice into the meeting. It must not be muted. */}
        <audio id={AUDIO_ID} ref={audioRef} autoPlay />

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-8 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/face.png" alt="" className="h-40 w-40 rounded-full object-cover opacity-60" />
            <p className="text-lg text-white/60">
              {status === "unconfigured" ? "No Anam persona configured" : "Connecting…"}
            </p>
            {detail && <p className="max-w-md text-sm text-white/35">{detail}</p>}
          </div>
        )}

        <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              status === "speaking" ? "bg-emerald-400" : live ? "bg-sky-400" : "bg-white/30"
            }`}
          />
          <span className="font-medium">Ava</span>
          <span className="text-white/50">
            {status === "speaking" ? "speaking" : wsOpen ? "listening" : "waiting for the room"}
          </span>
        </div>
      </section>

      {/* the agenda panel */}
      <section className="flex h-full w-[48%] flex-col gap-5 p-8">
        <header>
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">
            {timer && timer.total > 0 ? `Item ${Math.min(timer.index + 1, timer.total)} of ${timer.total}` : "Agenda"}
          </p>
          <h1 className="mt-1 line-clamp-2 text-3xl leading-tight font-semibold">
            {timer?.title || "Waiting to start"}
          </h1>
          {timer?.owner && <p className="mt-1 text-lg text-white/50">led by {timer.owner}</p>}
        </header>

        <div className="flex items-baseline gap-4">
          <span className={`font-mono text-6xl tabular-nums ${over ? "text-amber-400" : "text-white"}`}>
            {timer ? mmss(timer.remaining) : "--:--"}
          </span>
          <span className="text-base text-white/40">{over ? "over time" : "left on this item"}</span>
        </div>

        {timer && timer.planned > 0 && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ${over ? "bg-amber-400" : "bg-sky-400"}`}
              style={{ width: `${Math.min(100, (timer.elapsed / timer.planned) * 100)}%` }}
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-white/40">
            Actions {actions.length > 0 && `· ${actions.length}`}
          </p>
          {actions.length === 0 ? (
            <p className="text-base text-white/30">Nothing captured yet.</p>
          ) : (
            <ul className="space-y-2">
              {actions.slice(-6).map((a) => (
                <li key={a.id} className="flex gap-2 text-base leading-snug">
                  <span className="text-sky-400">•</span>
                  <span>
                    {a.owner && <span className="font-medium text-white">{a.owner} — </span>}
                    <span className="text-white/80">{a.text}</span>
                    {a.due && <span className="text-white/40"> ({a.due})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="line-clamp-2 min-h-[3rem] border-t border-white/10 pt-3 text-base text-white/40">
          {caption || "…"}
        </footer>
      </section>
    </main>
  );
}
