"use client";

/**
 * Holds the Anam session: a photoreal person who speaks the lines we hand her.
 *
 * Video and audio both land on ONE unmuted <video> element. That is not a style
 * choice: Recall captures the page's audio output, so a muted element is a silent
 * meeting, and the separate-audio-element method is deprecated in the SDK anyway.
 * Recall's own avatar sample does exactly this — one full-screen <video autoPlay
 * playsInline>, no mute.
 *
 * `speak()` resolves when she has actually finished the sentence, not when the command
 * was accepted — Anam reports `endOfSpeech` on the persona's message stream and we wait
 * for it. That matters because the stage only ticks while she is silent; without a
 * truthful "she has stopped" the moderator talks over herself.
 *
 * Every wait has a ceiling. Inside Recall's browser there is nobody to notice a hung
 * promise, and a speak() that never settles would freeze the loop for the rest of the
 * meeting — which is exactly how a moderator goes quiet halfway through and stays that
 * way.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnamEvent, MessageRole, createClient } from "@anam-ai/js-sdk";
import type { AnamClient, MessageStreamEvent } from "@anam-ai/js-sdk";

export type FaceStatus =
  | "unconfigured"
  | "idle"
  | "connecting"
  | "live"
  | "speaking"
  | "error";

/** Back off before retrying a failed connection, so a hard failure cannot spin. */
const RECONNECT_MS = 10_000;
/** Longest we will wait for a connection before calling it failed. */
const CONNECT_TIMEOUT_MS = 25_000;
/** Nothing she says is anywhere near this long; past it, assume the stream is gone. */
const SPEAK_TIMEOUT_MS = 90_000;

export function useAnamStream() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<AnamClient | null>(null);
  const connectingRef = useRef<Promise<void> | null>(null);
  const failuresRef = useRef(0);

  /** Resolved by the endOfSpeech event for the utterance currently in flight. */
  const finishedRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<FaceStatus>("idle");
  const [configured, setConfigured] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);

  const report = (message: string) => {
    console.warn("[Anam]", message);
    setDetail(message);
  };

  useEffect(() => {
    fetch("/api/anam")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(Boolean(d.configured));
        setStatus(d.configured ? "idle" : "unconfigured");
      })
      .catch(() => undefined);
  }, []);

  const teardown = useCallback(() => {
    finishedRef.current?.();
    finishedRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.stopStreaming().catch(() => undefined);
  }, []);

  const connect = useCallback(async () => {
    if (clientRef.current) return;
    if (connectingRef.current) return connectingRef.current;

    const run = (async () => {
      setStatus("connecting");

      const res = await fetch("/api/anam", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      if (!videoRef.current) throw new Error("The video element is not mounted yet");

      const client = createClient(data.sessionToken, {
        // There is no microphone in Recall's browser and we would not want one: the
        // meeting reaches us as Recall's transcript, not as audio into Anam.
        disableInputAudio: true,
      });

      client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event: MessageStreamEvent) => {
        if (event.role !== MessageRole.PERSONA) return;
        if (event.endOfSpeech || event.interrupted) {
          setStatus((s) => (s === "speaking" ? "live" : s));
          finishedRef.current?.();
          finishedRef.current = null;
        }
      });
      client.addListener(AnamEvent.CONNECTION_CLOSED, (reason) => {
        report(`stream closed: ${reason}`);
        clientRef.current = null;
        finishedRef.current?.();
        finishedRef.current = null;
        setStatus("idle");
      });

      await withTimeout(
        client.streamToVideoElement(videoRef.current.id),
        CONNECT_TIMEOUT_MS,
        "Anam did not start streaming in time",
      );

      // Autoplay of audible media can be refused without a user gesture, and inside
      // Recall's browser there is no one to click anything. Ask explicitly, and if it
      // is refused say so out loud rather than presenting a silent avatar as working.
      const el = videoRef.current;
      if (el) {
        el.muted = false;
        el.volume = 1;
        try {
          await el.play();
        } catch (e) {
          report(`the browser blocked audio playback: ${e instanceof Error ? e.message : e}`);
        }
      }

      clientRef.current = client;
      failuresRef.current = 0;
      setDetail(null);
      setStatus("live");
    })();

    connectingRef.current = run;
    try {
      await run;
    } catch (e) {
      failuresRef.current += 1;
      teardown();
      setStatus("idle"); // the reconnect effect tries again after a pause
      report(e instanceof Error ? e.message : "Could not start the video stream");
      throw e;
    } finally {
      connectingRef.current = null;
    }
  }, [teardown]);

  // Stay connected: the session costs the same idle, and reconnecting mid-meeting in
  // front of everybody is worse than holding it open.
  useEffect(() => {
    if (status !== "idle" || !configured) return;
    const delay = failuresRef.current > 0 ? RECONNECT_MS : 0;
    const timer = window.setTimeout(() => {
      void connect().catch(() => undefined);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [status, configured, connect]);

  /**
   * Says one line and waits for her to finish it.
   *
   * Resolves `true` only if she actually spoke — the caller uses that to decide
   * whether the line may be marked as delivered, so a cue lost to a dead stream is
   * spoken on the next tick instead of vanishing.
   */
  const speak = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text.trim()) return true;
      try {
        await connect();
        const client = clientRef.current;
        if (!client) throw new Error("Anam session is not open");

        setStatus("speaking");

        const finished = new Promise<void>((resolve) => {
          finishedRef.current = resolve;
        });

        await client.talk(text);
        await withTimeout(finished, SPEAK_TIMEOUT_MS, "she never reported finishing the line");

        setStatus((s) => (s === "speaking" ? "live" : s));
        return true;
      } catch (e) {
        finishedRef.current = null;
        setStatus((s) => (s === "speaking" ? "live" : s));
        report(e instanceof Error ? e.message : "She could not speak");
        return false;
      }
    },
    [connect],
  );

  /** Cuts her off — used when somebody starts talking over her. */
  const interrupt = useCallback(() => {
    clientRef.current?.interruptPersona();
    finishedRef.current?.();
    finishedRef.current = null;
    setStatus((s) => (s === "speaking" ? "live" : s));
  }, []);

  useEffect(() => {
    const release = () => teardown();
    window.addEventListener("pagehide", release);
    return () => window.removeEventListener("pagehide", release);
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  return { videoRef, status, configured, detail, speak, interrupt, disconnect: teardown };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}
