"use client";

/**
 * A client's setup: their logo and name, which invites are theirs, and who can use her.
 *
 * The same box for both sides. NDI sees it at the top of a client's page in /admin and
 * changes everything; the client's own people see it in their Setup tab and change their
 * logo, their name and who can use her. Which invites are theirs, pausing her and removing
 * the client stay NDI's: a client could otherwise claim another company's domain.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Chip, CompanyLogo, Notice, Section, ago, api, danger, field, primary, quiet } from "./ui";

type Client = {
  id: string;
  name: string;
  domains: string[];
  addresses: string[];
  status: string;
  logo_url: string | null;
  created_at: string;
  created_by: string | null;
};
type Person = { id: string; email: string; name: string | null; last_login_at: string | null };
type Data = { client: Client; people: Person[]; me: string; admin: boolean };

export default function Setup({ clientId, onChanged }: { clientId?: string; onChanged?: () => void }) {
  const router = useRouter();
  const q = clientId ? `?client=${clientId}` : "";
  const amp = q ? "&" : "?";
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ name: "", domains: "", addresses: "", status: "active" });
  const [newPerson, setNewPerson] = useState({ email: "", invite: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api<Data>(`/api/portal/setup${q}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setForm({ name: d.client.name, domains: d.client.domains.join(", "), addresses: d.client.addresses.join(", "), status: d.client.status });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load."));
    return () => {
      alive = false;
    };
  }, [q]);

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

  /** The page around shows the name and logo too: it is told, or — in /admin — loaded again. */
  const changed = () => (onChanged ? onChanged() : window.location.reload());

  if (!data) {
    return error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-slate-500">Loading…</p>;
  }
  const { client, people, me, admin } = data;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Only NDI sends which invites are theirs and whether she is paused.
    const body = admin ? form : { name: form.name };
    const r = await step("save", () => api<{ client: { name: string } }>(`/api/portal/setup${q}`, { method: "PATCH", body: JSON.stringify(body) }));
    if (!r) return;
    setData((d) => (d ? { ...d, client: { ...d.client, name: r.client.name } } : d));
    setNotice("Saved.");
    changed();
  }

  async function changeLogo(file: File | undefined) {
    if (logoInput.current) logoInput.current.value = "";
    if (!file) return;
    const upload = new FormData();
    upload.set("file", file);
    const r = await step("logo", () => api<{ logo_url: string | null }>(`/api/portal/logo${q}`, { method: "POST", body: upload }));
    if (!r) return;
    setData((d) => (d ? { ...d, client: { ...d.client, logo_url: r.logo_url } } : d));
    changed();
  }

  async function removeLogo() {
    const r = await step("logo:remove", () => api<{ logo_url: null }>(`/api/portal/logo${q}`, { method: "DELETE" }));
    if (!r) return;
    setData((d) => (d ? { ...d, client: { ...d.client, logo_url: null } } : d));
    changed();
  }

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    const r = await step("person", () =>
      api<{ people: Person[]; invited: boolean; inviteError: string | null }>(`/api/portal/people${q}`, {
        method: "POST",
        body: JSON.stringify(newPerson),
      }),
    );
    if (!r) return;
    setData((d) => (d ? { ...d, people: r.people } : d));
    setNotice(r.inviteError ? `Added, but the invitation was not sent: ${r.inviteError}` : r.invited ? `Invitation sent to ${newPerson.email}.` : "Added.");
    setNewPerson({ email: "", invite: true });
  }

  async function resend(p: Person) {
    const r = await step(`resend:${p.id}`, () =>
      api<{ people: Person[]; inviteError: string | null }>(`/api/portal/people${q}`, {
        method: "POST",
        body: JSON.stringify({ email: p.email, invite: true }),
      }),
    );
    if (r) setNotice(r.inviteError ? `Not sent: ${r.inviteError}` : `Invitation sent again to ${p.email}.`);
  }

  async function removePerson(p: Person) {
    if (!window.confirm(`${p.email} will no longer be able to use Ava for ${client.name}. Remove?`)) return;
    const r = await step(`remove:${p.id}`, () => api<{ people: Person[] }>(`/api/portal/people${q}${amp}person=${p.id}`, { method: "DELETE" }));
    if (r) setData((d) => (d ? { ...d, people: r.people } : d));
  }

  async function removeClient() {
    const typed = window.prompt(
      `This removes ${client.name}: who can use her, their documents, meetings and notes. Their files in NDI's Drive stay.\n\nType the name to confirm:`,
    );
    if (typed?.trim() !== client.name) return;
    const r = await step("delete", () => api(`/api/admin/clients/${client.id}`, { method: "DELETE" }));
    if (r) router.push("/admin");
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const routes = [...client.domains.map((d) => `anyone @${d}`), ...client.addresses];

  return (
    <div className="space-y-4">
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
        title={admin ? "Client setup" : "Setup"}
        aside={
          admin && (
            <span className="text-xs text-slate-400">
              Created {ago(client.created_at)}
              {client.created_by ? ` by ${client.created_by}` : ""}
            </span>
          )
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={save} className="space-y-4">
            <div className="flex items-center gap-4">
              <CompanyLogo name={client.name} url={client.logo_url} size={64} />
              <div className="min-w-0 space-y-1.5">
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => void changeLogo(e.target.files?.[0])}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={quiet} onClick={() => logoInput.current?.click()} disabled={busy !== null}>
                    {busy === "logo" ? "Uploading…" : client.logo_url ? "Change logo" : "Add a logo"}
                  </button>
                  {client.logo_url && (
                    <button type="button" className="text-xs text-slate-400 hover:text-rose-700" onClick={() => void removeLogo()} disabled={busy !== null}>
                      {busy === "logo:remove" ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">PNG, JPG, WebP or GIF, up to 2 MB.</p>
              </div>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700">{admin ? "Name" : "Company name"}</span>
              <input className={field} value={form.name} onChange={set("name")} />
            </label>

            {admin ? (
              <fieldset className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-900">Which meetings Ava joins for them</legend>
                <p className="-mt-1 text-xs leading-5 text-slate-500">
                  When the person who sent the invite is one of the people who can use her, or matches one of these. NDI only.
                </p>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Company domain</span>
                  <input className={field} value={form.domains} onChange={set("domains")} placeholder="acme.com" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-700">Personal email addresses</span>
                  <input className={field} value={form.addresses} onChange={set("addresses")} placeholder="assistant@gmail.com" />
                </label>
              </fieldset>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                <p className="text-sm font-semibold text-slate-900">Which meetings Ava joins for you</p>
                <p className="mt-1">
                  Those sent by the people who can use her{routes.length > 0 && <>, and by {routes.join(", ")}</>}. To change this, ask NDI.
                </p>
              </div>
            )}

            {admin && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Status</span>
                <select className={field} value={form.status} onChange={set("status")}>
                  <option value="active">Active: she attends their meetings</option>
                  <option value="paused">Paused: she skips them, and nobody signs in</option>
                </select>
              </label>
            )}

            <div className="flex flex-wrap gap-2">
              <button className={primary} disabled={busy !== null || !form.name.trim()}>
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              {admin && (
                <button type="button" className={danger} onClick={() => void removeClient()} disabled={busy !== null}>
                  Delete client
                </button>
              )}
            </div>
          </form>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Who can use her</h3>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                They sign in to give Ava documents and prepare her, and she joins the meetings they invite her to — from any
                address, company or personal.
              </p>
            </div>
            {people.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {people.map((p) => {
                  const you = !admin && p.email === me;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={p.email}>
                        {p.name ? `${p.name} · ` : ""}
                        {p.email}
                      </span>
                      {you ? <Chip tone="info">You</Chip> : p.last_login_at ? <Chip tone="good">Signed in {ago(p.last_login_at)}</Chip> : <Chip>Not yet</Chip>}
                      {!you && (
                        <>
                          <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => void resend(p)} disabled={busy !== null}>
                            {busy === `resend:${p.id}` ? "Sending…" : "Resend invite"}
                          </button>
                          <button className="text-xs text-slate-400 hover:text-rose-700" onClick={() => void removePerson(p)} disabled={busy !== null}>
                            Remove
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <form onSubmit={addPerson} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  className={field}
                  placeholder="name@company.com"
                  value={newPerson.email}
                  onChange={(e) => setNewPerson((n) => ({ ...n, email: e.target.value }))}
                />
                <button className={quiet} disabled={busy !== null || !newPerson.email.includes("@")}>
                  {busy === "person" ? "Adding…" : "Add"}
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={newPerson.invite}
                  onChange={(e) => setNewPerson((n) => ({ ...n, invite: e.target.checked }))}
                />
                Email them an invitation from Ava
              </label>
            </form>
          </div>
        </div>
      </Section>
    </div>
  );
}
