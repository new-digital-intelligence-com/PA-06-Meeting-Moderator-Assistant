"use client";

/**
 * One client's setup, for NDI: which invites are theirs, who may sign in for them, and
 * pausing or removing them. Their page itself follows below it (Workspace).
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Chip, Notice, Section, ago, api, danger, field, primary, quiet } from "../portal/ui";

type Client = { id: string; name: string; domains: string[]; addresses: string[]; status: string; created_at: string; created_by: string | null };
type Member = { id: string; email: string; name: string | null; invited_at: string; last_login_at: string | null };

export default function ClientSettings({ id }: { id: string }) {
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: "", domains: "", addresses: "", status: "active" });
  const [newMember, setNewMember] = useState({ email: "", invite: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ client: Client; members: Member[] }>(`/api/admin/clients/${id}`)
      .then((d) => {
        if (!alive) return;
        setClient(d.client);
        setMembers(d.members);
        setForm({ name: d.client.name, domains: d.client.domains.join(", "), addresses: d.client.addresses.join(", "), status: d.client.status });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load."));
    return () => {
      alive = false;
    };
  }, [id]);

  async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await step("save", () => api<{ client: Client }>(`/api/admin/clients/${id}`, { method: "PATCH", body: JSON.stringify(form) }));
    // Their page below reads the client once; load it all again so it shows the change.
    if (r) window.location.reload();
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const r = await step("member", () =>
      api<{ members: Member[]; invited: boolean; inviteError: string | null }>(`/api/admin/clients/${id}/members`, {
        method: "POST",
        body: JSON.stringify(newMember),
      }),
    );
    if (r) {
      setMembers(r.members);
      setNotice(r.inviteError ? `Added, but the invitation was not sent: ${r.inviteError}` : r.invited ? `Invitation sent to ${newMember.email}.` : "Added.");
      setNewMember({ email: "", invite: true });
    }
  }

  async function resend(m: Member) {
    const r = await step(`resend:${m.id}`, () =>
      api<{ members: Member[]; inviteError: string | null }>(`/api/admin/clients/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: m.email, invite: true }),
      }),
    );
    if (r) setNotice(r.inviteError ? `Not sent: ${r.inviteError}` : `Invitation sent again to ${m.email}.`);
  }

  async function removeMember(m: Member) {
    if (!window.confirm(`${m.email} will no longer be able to sign in for ${client?.name}. Remove?`)) return;
    const r = await step(`remove:${m.id}`, () => api<{ members: Member[] }>(`/api/admin/clients/${id}/members?member=${m.id}`, { method: "DELETE" }));
    if (r) setMembers(r.members);
  }

  async function removeClient() {
    if (!client) return;
    const typed = window.prompt(
      `This removes ${client.name}: who signs in, their documents, meetings and notes. Their files in NDI's Drive stay.\n\nType the name to confirm:`,
    );
    if (typed?.trim() !== client.name) return;
    const r = await step("delete", () => api(`/api/admin/clients/${id}`, { method: "DELETE" }));
    if (r) router.push("/admin");
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 pt-6 sm:px-6">
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

      <Section
        title="Client setup (NDI only)"
        aside={client && <span className="text-xs text-slate-400">Created {ago(client.created_at)}{client.created_by ? ` by ${client.created_by}` : ""}</span>}
      >
        {!client ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={save} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-700">Name</span>
                <input className={field} value={form.name} onChange={set("name")} />
              </label>
              <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">Which meetings Ava joins for them</legend>
                <p className="-mt-1 text-xs leading-5 text-slate-500">When the person who sent the invite matches one of these.</p>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Company domain</span>
                  <input className={field} value={form.domains} onChange={set("domains")} placeholder="acme.com" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Personal email addresses</span>
                  <input className={field} value={form.addresses} onChange={set("addresses")} placeholder="founder@gmail.com" />
                </label>
              </fieldset>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Status</span>
                <select className={field} value={form.status} onChange={set("status")}>
                  <option value="active">Active: she attends their meetings</option>
                  <option value="paused">Paused: she skips them, and nobody signs in</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button className={primary} disabled={busy !== null}>
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
                <button type="button" className={danger} onClick={() => void removeClient()} disabled={busy !== null}>
                  Delete client
                </button>
              </div>
            </form>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Who can open their page</h3>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  The people who sign in to give Ava documents and prepare her. This does not decide which meetings she joins.
                </p>
              </div>
              {members.length === 0 ? (
                <p className="text-sm text-slate-500">Nobody yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                  {members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={m.email}>
                        {m.name ? `${m.name} · ` : ""}
                        {m.email}
                      </span>
                      {m.last_login_at ? <Chip tone="good">Signed in {ago(m.last_login_at)}</Chip> : <Chip>Not yet</Chip>}
                      <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => void resend(m)} disabled={busy !== null}>
                        {busy === `resend:${m.id}` ? "Sending…" : "Resend invite"}
                      </button>
                      <button className="text-xs text-slate-400 hover:text-rose-700" onClick={() => void removeMember(m)} disabled={busy !== null}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form onSubmit={addMember} className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="email"
                    className={field}
                    placeholder="name@company.com"
                    value={newMember.email}
                    onChange={(e) => setNewMember((n) => ({ ...n, email: e.target.value }))}
                  />
                  <button className={quiet} disabled={busy !== null || !newMember.email.includes("@")}>
                    {busy === "member" ? "Adding…" : "Add"}
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={newMember.invite}
                    onChange={(e) => setNewMember((n) => ({ ...n, invite: e.target.checked }))}
                  />
                  Email them an invitation
                </label>
              </form>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
