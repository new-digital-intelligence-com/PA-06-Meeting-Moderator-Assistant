import type { Metadata } from "next";
import Logo from "@/components/Logo";
import { primary, quiet } from "@/components/portal/ui";
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
    <main className="flex flex-1 items-center justify-center bg-[radial-gradient(60rem_30rem_at_50%_-10rem,rgba(37,99,235,0.10),transparent)] px-4 py-16">
      <form
        method="post"
        action="/api/auth/email/verify"
        className="w-full max-w-sm space-y-6 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
      >
        <div className="flex flex-col items-center gap-4">
          <Logo className="size-12" />
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign in to Ava</h1>
            <p className="text-sm text-slate-500">{token ? "One click and you are in." : "This link is incomplete. Ask for a new one."}</p>
          </div>
        </div>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        {token ? (
          <button className={`${primary} w-full py-2.5`}>Sign in</button>
        ) : (
          <a href="/login" className={`${quiet} w-full`}>
            Back to sign-in
          </a>
        )}
      </form>
    </main>
  );
}
