"use client";

import { useState } from "react";
import { field, primary, quiet } from "./portal/ui";

/**
 * Two ways in, no password: Google, or a link by email. Either way only an address NDI
 * invited — or anyone at NDI — gets past the callback.
 */
export default function LoginForm({ next, email: initialEmail, error }: { next: string; email: string; error: string | null }) {
  const [email, setEmail] = useState(initialEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [problem, setProblem] = useState<string | null>(error);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setProblem(null);
    try {
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState("sent");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not send the link.");
      setState("idle");
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Ava</h1>
          <p className="text-sm text-white/45">NDI&apos;s meeting assistant. Sign in to prepare her for your meetings.</p>
        </div>

        {problem && (
          <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-3 text-sm text-rose-200">
            {problem}
          </p>
        )}

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <a href={`/api/auth/login?next=${encodeURIComponent(next)}`} className={`${quiet} w-full bg-white/90 text-slate-900 hover:bg-white`}>
            <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Sign in with Google
          </a>

          <div className="flex items-center gap-3 text-xs text-white/30">
            <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
          </div>

          {state === "sent" ? (
            <p role="status" className="rounded-xl border border-sky-400/30 bg-sky-400/5 p-3 text-sm text-sky-200">
              If {email} has access, a sign-in link is on its way. It works once, for 15 minutes.
            </p>
          ) : (
            <form onSubmit={sendLink} className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs text-white/50">Your work email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  className={field}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </label>
              <button className={`${primary} w-full`} disabled={state === "sending" || !email.includes("@")}>
                {state === "sending" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-white/30">
          No account? NDI sets Ava up for your company and invites you.{" "}
          <a href="/docs" className="underline decoration-white/20 hover:text-white/60">
            How she works
          </a>
        </p>
      </div>
    </main>
  );
}
