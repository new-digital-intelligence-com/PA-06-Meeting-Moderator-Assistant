"use client";

/**
 * The control room — what Ava needs in order to work, each said in words: her own Google
 * account, her server, and where the meeting in progress is kept. Green is working, red
 * stops her.
 *
 * Nothing is run from here any more: she joins her clients' meetings from her calendar,
 * a client's page sends her to one right now, and the meeting itself is followed on that
 * client's page — which "Ava's server" links to while she is in one.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowRightIcon, DatabaseIcon, MailIcon, ServerIcon } from "./portal/icons";
import { IconTile, Notice, type IconTone } from "./portal/ui";

type Config = {
  publicUrl: string;
  botName: string;
  store: "redis" | "mongo" | "file";
  /** The Google account she reads invites from and sends notes as, if connected. */
  avaAccount: string | null;
  avaExpected: string | null;
  runnerKey: boolean;
};

/** What she is doing now in one of her seats, worked out on the server (lib/meeting.ts, inMeeting). */
export type Now = {
  seat: string;
  busy: boolean;
  phase: "sent" | "joining" | "live" | null;
  title: string;
  client: { id: string; name: string } | null;
  minutes: number;
};

function Card({
  ok,
  icon,
  tone,
  title,
  detail,
  hint,
  action,
}: {
  ok: boolean;
  icon: React.ReactNode;
  tone: IconTone;
  title: string;
  detail: React.ReactNode;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-16px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:shadow-lg ${
        ok ? "border-slate-200/70" : "border-rose-200 ring-4 ring-rose-500/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <IconTile tone={ok ? tone : "rose"} className="size-11">
          {icon}
        </IconTile>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`} />
          {ok ? "Working" : "Needs you"}
        </span>
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-900">{title}</h2>
      <div className={`mt-1 min-w-0 flex-1 break-words text-sm leading-relaxed ${ok ? "text-slate-600" : "text-rose-700"}`}>{detail}</div>
      <p className="mt-3 text-xs leading-5 text-slate-400">{hint}</p>
      {action && <div className="mt-4 border-t border-slate-100 pt-4">{action}</div>}
    </div>
  );
}

/** One seat: the meeting she is in there, or free. */
function SeatLine({ s, named }: { s: Now; named: boolean }) {
  const label = named ? <span className="font-semibold text-slate-500">Seat {s.seat} · </span> : null;
  if (!s.busy) {
    return (
      <p className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-slate-300" />
        <span>
          {label}
          Free
        </span>
      </p>
    );
  }
  return (
    <p className="flex min-w-0 items-start gap-2">
      <span className="relative mt-1.5 flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <span className="min-w-0">
        {label}
        {s.phase === "live" ? "In a meeting" : "On her way to a meeting"}
        {s.client ? ` for ${s.client.name}` : ""}
        {s.phase === "live" && s.minutes > 0 ? ` · ${s.minutes} min` : ""}
        {s.title ? <span className="block truncate text-slate-400">{s.title}</span> : null}
      </span>
    </p>
  );
}

export default function ControlRoom({ config, now, oauthError }: { config: Config; now: Now[]; oauthError: string | null }) {
  const router = useRouter();
  const name = config.botName.split("—")[0].trim();

  // What she is doing changes by itself: look again every fifteen seconds.
  useEffect(() => {
    const id = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(id);
  }, [router]);

  // A file is only fine on this computer: on a deployed site her server and the pages would not share it.
  const deployed = Boolean(config.publicUrl) && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(config.publicUrl);
  const storeOk = config.store !== "file" || !deployed;
  const link = "inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700";
  const busy = now.filter((s) => s.busy);
  const followable = busy.filter((s): s is Now & { client: { id: string; name: string } } => Boolean(s.client));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-24 pt-6 sm:px-6">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Control room</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
          What {name} needs in order to work. She joins her clients&apos; meetings from her calendar, or right away when a client
          sends her from their page — where the meeting is followed live.{" "}
          <Link href="/docs" className="font-medium text-blue-600 hover:text-blue-700">
            How she works →
          </Link>
        </p>
      </header>

      {oauthError && <Notice tone="error">Google sign-in failed: {oauthError}</Notice>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          ok={Boolean(config.avaAccount)}
          icon={<MailIcon className="size-5" />}
          tone="blue"
          title="Ava's Google account"
          detail={config.avaAccount ?? "Not connected: she can't read her invites or send the notes."}
          hint="Her own account: she reads her calendar invites from it and sends the meeting notes as her."
          action={
            <a href="/api/auth/google?as=ava" title={`Sign in as ${config.avaExpected ?? "her"}, not as yourself.`} className={link}>
              {config.avaAccount ? "Reconnect" : "Connect her account"}
              <ArrowRightIcon className="size-4" />
            </a>
          }
        />
        <Card
          ok={config.runnerKey}
          icon={<ServerIcon className="size-5" />}
          tone="emerald"
          title="Ava's server"
          detail={
            !config.runnerKey ? (
              "AVA_RUNNER_KEY is not set on this site."
            ) : now.length === 1 && !busy.length ? (
              "Free — she joins her clients' meetings by herself."
            ) : (
              <div className="space-y-2">
                {now.length > 1 && !busy.length && <p>Free — she joins her clients&apos; meetings by herself, up to {now.length} at once.</p>}
                {now.map((s) => (
                  <SeatLine key={s.seat} s={s} named={now.length > 1} />
                ))}
              </div>
            )
          }
          hint={
            now.length > 1
              ? `The computer with her Chrome, which joins the calls: ${now.length} seats — that many clients' meetings at once, one at a time for each client.`
              : "The computer with her Chrome, which joins the calls."
          }
          action={
            followable.length ? (
              <div className="flex flex-col gap-2">
                {followable.map((s) => (
                  <Link key={s.seat} href={`/admin/clients/${s.client.id}`} className={link}>
                    {followable.length > 1 ? `Follow ${s.client.name}'s meeting` : "Follow the meeting"}
                    <ArrowRightIcon className="size-4" />
                  </Link>
                ))}
              </div>
            ) : undefined
          }
        />
        <Card
          ok={storeOk}
          icon={<DatabaseIcon className="size-5" />}
          tone="violet"
          title="Meeting storage"
          detail={
            config.store === "file"
              ? deployed
                ? "A local file: set up Redis for the live site."
                : "A local file (this computer)."
              : `${config.store === "redis" ? "Redis" : "MongoDB"}: shared by her and this site.`
          }
          hint="Where the meeting in progress is kept, so her server and the pages see the same one."
        />
      </div>
    </div>
  );
}
