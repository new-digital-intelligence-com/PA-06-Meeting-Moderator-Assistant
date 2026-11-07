import Link from "next/link";
import { currentUser } from "@/lib/auth";
import PublicWalkthrough from "@/components/PublicWalkthrough";

export default async function Preview() {
  const user = await currentUser();
  return <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-12">
    <header className="flex flex-wrap items-center justify-between gap-4"><Link href="/preview" className="text-2xl font-semibold">Ava · Meeting Assistant</Link>
      {user ? <div className="flex items-center gap-4 text-sm"><span>Signed in as {user.email}</span><form action="/api/auth/logout" method="post"><button className="text-blue-700">Sign out</button></form>{user.role !== "visitor" && <Link href="/">Open workspace</Link>}</div> : <Link href="/login" className="rounded-lg bg-blue-600 px-4 py-2 text-white">Sign in</Link>}
    </header>
    <section><p className="text-sm font-medium text-blue-700">PUBLIC WALKTHROUGH · FICTIONAL EXAMPLE</p><h1 className="mt-3 text-4xl font-semibold">See how Ava supports a meeting</h1><p className="mt-4 text-slate-600">Explore an example agenda, meeting notes and action list. Live meetings and saved client records require the appropriate workspace access.</p></section>
    <PublicWalkthrough />
    <p className="text-sm text-slate-600"><Link href="/docs" className="text-blue-700">Read the full guide</Link> or <Link href="/login" className="text-blue-700">sign in with any Google account</Link>. Existing client and staff permissions determine access to live operations.</p>
  </main>;
}
