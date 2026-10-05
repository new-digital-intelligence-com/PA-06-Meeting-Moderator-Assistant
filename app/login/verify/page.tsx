import type { Metadata } from "next";
import { safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Ava" };

/**
 * Where an emailed sign-in link lands. It does not sign in by itself: mail scanners open
 * links to check them, and that would use up the link. The button does.
 */
export default async function Verify({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <form method="post" action="/api/auth/email/verify" className="w-full max-w-sm space-y-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Sign in to Ava</h1>
          <p className="text-sm text-white/45">{token ? "One click and you are in." : "This link is incomplete. Ask for a new one."}</p>
        </div>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        {token ? (
          <button className="w-full rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400">Sign in</button>
        ) : (
          <a href="/login" className="inline-block rounded-lg bg-white/5 px-4 py-2 text-sm text-white/75 hover:bg-white/10">
            Back to sign-in
          </a>
        )}
      </form>
    </main>
  );
}
