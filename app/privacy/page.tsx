import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata: Metadata = {
  title: "Privacy — Ava",
  description: "What Ava, NDI's meeting assistant, does with the information it handles.",
};

const UPDATED = "5 October 2026";

/**
 * The privacy notice — public, like the docs: Google asks for it before people outside NDI
 * may sign in with Google or use the Drive picker.
 */
export default function Privacy() {
  const contact = process.env.AVA_EMAIL || "ava@new-digital-intelligence.com";
  const h2 = "mt-10 text-lg font-semibold tracking-tight text-slate-900";
  const p = "mt-3 text-[15px] leading-7 text-slate-600";
  const li = "text-[15px] leading-7 text-slate-600";
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">Ava</span>
          <span className="text-sm text-slate-500">by New Digital Intelligence</span>
        </Link>
        <p className="text-xs text-slate-400">Updated {UPDATED}</p>
      </header>

      <article className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Privacy</h1>
        <p className={p}>
          Ava is a meeting assistant made by New Digital Intelligence (NDI). She joins video meetings she is invited to,
          takes notes and emails a summary afterwards; NDI&apos;s clients use this site to give her their documents and
          prepare her for their meetings. This page says what information that involves, and what happens to it.
        </p>

        <h2 className={h2}>Signing in</h2>
        <p className={p}>
          Only people NDI has invited can sign in, with Google or with a link sent by email. From Google we receive your
          name and email address, and nothing else; we use them to recognise you and to show you your company&apos;s page.
          We keep the time you last signed in. A cookie keeps you signed in.
        </p>

        <h2 className={h2}>What you give Ava</h2>
        <p className={p}>
          Documents, links, files from Google Drive and text that you add, the instructions you write, and the preparation
          for a meeting. A copy of each file is kept in NDI&apos;s Google Drive; its text, cut into passages, and a short
          summary are kept in NDI&apos;s database so that Ava can find the relevant passage during your meetings. You can
          remove a document at any time from your page, which removes its copy and its passages.
        </p>

        <h2 className={h2}>Google Drive</h2>
        <p className={p}>
          If you choose “From Google Drive”, Google&apos;s own file picker opens and you pick the files. The access
          Google gives this site reaches only the files you picked — not the rest of your Drive — and it is used once,
          to copy those files into NDI&apos;s Drive for Ava to read. We do not keep that access afterwards.
        </p>
        <p className={p}>
          Ava&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-medium text-blue-600 hover:text-blue-700"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. It is used only to provide the features described here — never for
          advertising, never sold, and never used to train AI models.
        </p>

        <h2 className={h2}>In meetings</h2>
        <p className={p}>
          When Ava attends a meeting, she listens to it to take part and to take notes. The transcript, the actions and
          the summary are kept with the meeting, and the summary is emailed to the people invited. Meetings are only
          attended when someone invites her.
        </p>

        <h2 className={h2}>Services that process it</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li className={li}>Google (sign-in, Drive, Calendar and Gmail for Ava&apos;s own account, Meet).</li>
          <li className={li}>Supabase, where the database is hosted, and Vercel, where this site runs.</li>
          <li className={li}>Anthropic (Claude), which writes summaries, briefs and meeting notes.</li>
          <li className={li}>
            OpenAI, which turns passages into vectors for searching, and gives Ava her voice in meetings. Nothing is stored
            with OpenAI for later use.
          </li>
        </ul>
        <p className={p}>
          These providers process the information on NDI&apos;s behalf and do not use it to train their models.
        </p>

        <h2 className={h2}>Keeping and deleting</h2>
        <p className={p}>
          Information is kept while your company works with NDI. Ask, and NDI deletes your company&apos;s documents,
          meetings and notes; removing a person from your company&apos;s page ends their access at once.
        </p>

        <h2 className={h2}>Contact</h2>
        <p className={p}>
          Questions, or a request to see or delete your information: write to{" "}
          <a href={`mailto:${contact}`} className="font-medium text-blue-600 hover:text-blue-700">
            {contact}
          </a>
          .
        </p>
      </article>
    </main>
  );
}
