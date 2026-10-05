"use client";

/**
 * NDI's list of clients: each one's Ava at a glance, a new client, and the invites she
 * received from organisers who are nobody's client — those she does not attend.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { PERSONAL, emailDomain } from "@/lib/mail-domains";
import { Chip, Notice, Section, ago, api, field, primary, quiet, when } from "../portal/ui";

type ClientSummary = {
  id: string;
  name: string;
  domains: string[];
  addresses: string[];
  status: string;
  members: number;
  documents: number;
  upcoming: number;
  last_meeting: string | null;
  digest_at: string | null;
};

type Skipped = { id: string; title: string; starts_at: string; organizer: string | null; organizer_name: string | null };

const EMPTY = { name: "", domains: "", addresses: "", contacts: "", invite: true };

export default function Clients({ ava }: { ava: string | null }) {
  const [data, setData] = useState<{ clients: ClientSummary[]; skipped: Skipped[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ clients: ClientSummary[]; skipped: Skipped[] }>("/api/admin/clients")
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load the clients."));
    return () => {
      alive = false;
    };
  }, [version]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ client: { name: string }; invited: string[]; failed: { email: string; error: string }[] }>("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setNotice(
        [
          `${r.client.name} is set up.`,
          r.invited.length ? `Invitation sent to ${r.invited.join(", ")}.` : "",
          r.failed.length ? `Not sent to ${r.failed.map((f) => `${f.email} (${f.error})`).join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setForm(EMPTY);
      setAdding(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the client.");
    } finally {
      setBusy(false);
    }
  }

  /** A client from an invite she skipped: its organiser's company domain, or the address itself. */
  function fromInvite(m: Skipped) {
    const email = m.organizer ?? "";
    const domain = emailDomain(email);
    const personal = PERSONAL.has(domain);
    const company = domain.split(".").slice(-2, -1)[0] ?? "";
    setForm({
      name: personal ? (m.organizer_name ?? "") : company.charAt(0).toUpperCase() + company.slice(1),
      domains: personal ? "" : domain,
      addresses: personal ? email : "",
      contacts: email,
      invite: true,
    });
    setAdding(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === "invite" ? e.target.checked : e.target.value }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            One Ava, many clients. She attends a meeting when its organiser belongs to a client here, with that client&apos;s knowledge.
            Invites from anybody else she leaves alone.
          </p>
        </div>
        {!adding && (
          <button className={primary} onClick={() => setAdding(true)}>
            New client
          </button>
        )}
      </header>

      {error && (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {notice && (
        <Notice tone="info" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}

      {adding && (
        <Section title="New client">
          <form onSubmit={create} className="space-y-6">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-900">Company name</span>
              <input required className={field} value={form.name} onChange={set("name")} placeholder="Acme GmbH" />
            </label>

            {/* Two different questions, kept visibly apart: whose meetings, and who logs in. */}
            <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-900">1 · Which meetings Ava joins for them</legend>
              <p className="-mt-1 text-xs leading-5 text-slate-500">
                Ava joins a meeting when the person who <b>sent the invite</b> matches one of these. Fill in one or both.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Company domain</span>
                  <input className={field} value={form.domains} onChange={set("domains")} placeholder="acme.com" />
                  <span className="block text-xs leading-5 text-slate-500">Everyone with an @acme.com address.</span>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Personal email addresses</span>
                  <input className={field} value={form.addresses} onChange={set("addresses")} placeholder="founder@gmail.com" />
                  <span className="block text-xs leading-5 text-slate-500">
                    One person each — for people who use Gmail or another personal address instead of a company domain.
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-900">2 · Who can open their page</legend>
              <p className="-mt-1 text-xs leading-5 text-slate-500">
                The people who sign in to this site to give Ava their documents and prepare her for meetings (with Google or an
                emailed link). This does not decide which meetings she joins.
              </p>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-700">Their email addresses</span>
                <input className={field} value={form.contacts} onChange={set("contacts")} placeholder="anna@acme.com, ben@acme.com" />
                <span className="block text-xs leading-5 text-slate-500">
                  Often the same person as above: a founder on Gmail goes in both boxes.
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.invite} onChange={set("invite")} className="accent-blue-600" />
                Email them an invitation from {ava ?? "Ava"}
              </label>
            </fieldset>

            <div className="flex gap-2">
              <button className={primary} disabled={busy || !form.name.trim()}>
                {busy ? "Setting up…" : "Create"}
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setAdding(false);
                  setForm(EMPTY);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </Section>
      )}

      <Section title="Their Avas" aside={<span className="text-xs text-slate-400">{data?.clients.length ?? "…"} clients</span>}>
        {!data ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.clients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/clients/${c.id}`}
                  className="block h-full rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-300 hover:bg-slate-50"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <Chip tone={c.status === "active" ? "good" : "warn"}>{c.status === "active" ? "Active" : "Paused"}</Chip>
                  </div>
                  <p className="truncate text-xs text-slate-500">{[...c.domains.map((d) => `@${d}`), ...c.addresses].join(", ") || "No domain yet"}</p>
                  <p className="mt-3 text-xs text-slate-500">
                    {c.members} with access · {c.documents} documents · {c.upcoming} upcoming
                  </p>
                  <p className="mt-1 text-xs text-slate-400">Last meeting: {c.last_meeting ? ago(c.last_meeting) : "none yet"}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data && data.skipped.length > 0 && (
        <Section title="Invites she skipped">
          <p className="mb-3 text-sm text-slate-500">
            From organisers who are nobody&apos;s client, so she did not go. Make them a client and she will.
          </p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {data.skipped.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700">{m.title}</span>
                <span className="text-xs text-slate-500">{m.organizer_name || m.organizer}</span>
                <span className="text-xs text-slate-400">{when(m.starts_at)}</span>
                {m.organizer && (
                  <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => fromInvite(m)}>
                    Make a client
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
