"use client";

/**
 * A client's setup: their logo and name, and who can use her — whose invites are theirs.
 *
 * The same box for both sides. NDI sees it at the top of a client's page in /admin and
 * changes everything; the client's own people see it in their Setup tab and change their
 * logo and name, and add people. Only their super admin — the address NDI set them up with —
 * changes addresses (theirs too), sends an invitation again and removes people, and nobody of
 * theirs removes the super admin. NDI does all of it, to the super admin too, and alone
 * decides who the super admin is, pauses her and removes the client.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SettingsIcon, UsersIcon } from "./icons";
import { Chip, CompanyLogo, IconTile, Notice, Section, ago, api, danger, field, primary, quiet } from "./ui";

type Client = {
  id: string;
  name: string;
  status: string;
  logo_url: string | null;
  created_at: string;
  created_by: string | null;
  /** NDI's own client: everybody at this domain organises its meetings too. */
  ndi_domain: string | null;
};
type Person = { id: string; email: string; name: string | null; last_login_at: string | null; owner: boolean };
type Data = { client: Client; people: Person[]; me: string; admin: boolean };

export default function Setup({ clientId, onChanged }: { clientId?: string; onChanged?: () => void }) {
  const router = useRouter();
  const q = clientId ? `?client=${clientId}` : "";
  const amp = q ? "&" : "?";
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ name: "", status: "active" });
  const [newPerson, setNewPerson] = useState({ email: "", invite: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Someone's address being changed, as typed so far. */
  const [editing, setEditing] = useState<{ id: string; email: string } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api<Data>(`/api/portal/setup${q}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setForm({ name: d.client.name, status: d.client.status });
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
  const owner = people.find((p) => p.owner);
  // Their super admin changes addresses, sends an invitation again and removes people; NDI does
  // all of it, to the super admin too. Everybody on the list adds people.
  const inCharge = admin || (owner !== undefined && owner.email === me);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Only NDI sends whether she is paused.
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
    const warning = p.owner
      ? `${p.email} is ${client.name}'s super admin. Remove them? Until you make someone else super admin, nobody of theirs removes people, changes addresses or sends an invitation again.`
      : `${p.email} will no longer be able to use Ava for ${client.name}. Remove?`;
    if (!window.confirm(warning)) return;
    const r = await step(`remove:${p.id}`, () => api<{ people: Person[] }>(`/api/portal/people${q}${amp}person=${p.id}`, { method: "DELETE" }));
    if (r) setData((d) => (d ? { ...d, people: r.people } : d));
  }

  /** NDI only: the client's super admin becomes someone else on the list. */
  async function makeSuperAdmin(p: Person) {
    if (!window.confirm(`Make ${p.email} ${client.name}'s super admin? ${owner ? `${owner.email} stays on the list, as one of their people.` : ""}`)) return;
    const r = await step(`owner:${p.id}`, () =>
      api<{ people: Person[] }>(`/api/portal/people${q}${amp}person=${p.id}`, { method: "PATCH", body: JSON.stringify({ owner: true }) }),
    );
    if (!r) return;
    setData((d) => (d ? { ...d, people: r.people } : d));
    setNotice(`${p.email} is ${client.name}'s super admin now.`);
  }

  /** A new address for someone on the list — their super admin's, or NDI's, to change. */
  async function saveAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const p = people.find((x) => x.id === editing.id);
    if (!p) return;
    const email = editing.email.trim().toLowerCase();
    if (!admin && p.email === me && !window.confirm(`Change your address to ${email}? You sign in again with it.`)) return;
    const r = await step(`address:${p.id}`, () =>
      api<{ people: Person[]; changed: boolean; self?: boolean }>(`/api/portal/people${q}${amp}person=${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ email }),
      }),
    );
    if (!r) return;
    setEditing(null);
    if (r.self) {
      // This session was the old address's: signing in again proves the new one.
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      router.push(`/login?email=${encodeURIComponent(email)}`);
      return;
    }
    setData((d) => (d ? { ...d, people: r.people } : d));
    if (r.changed) setNotice(`${p.email} is now ${email}: they sign in with it from now on. Send them the invitation again if they need it.`);
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
        icon={<SettingsIcon />}
        tone="sky"
        description={admin ? "Everything about this client — NDI sees all of it." : "Your company on Ava, and the people who can use her."}
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

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              <p className="text-sm font-semibold text-slate-900">Which meetings Ava joins {admin ? "for them" : "for you"}</p>
              <p className="mt-1">
                Those whose invite comes from one of the people who can use her
                {client.ndi_domain && <>, or from anyone with an @{client.ndi_domain} address</>}. Invites from anyone else she leaves
                alone — add the person first.
              </p>
            </div>

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

          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="flex items-start gap-3">
              <IconTile tone="blue" className="size-8">
                <UsersIcon className="size-4" />
              </IconTile>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Who can use her</h3>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">
                  They sign in to give Ava documents and prepare her, and she joins the meetings they invite her to — from any
                  address, company or personal. Everyone here can add people; only the super admin
                  {admin
                    ? " — the address the client was set up with — changes addresses, invites them again or removes them, and nobody of theirs can remove the super admin. NDI can do all of it, to the super admin too."
                    : " changes addresses (theirs too), invites people again or removes them, and nobody can remove the super admin."}
                </p>
              </div>
            </div>
            {people.length > 0 && !owner && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No super admin — {admin ? "make one of them the super admin." : "ask NDI to make one of you the super admin."}
              </p>
            )}
            {people.length === 0 ? (
              <p className="text-sm text-slate-500">Nobody yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {people.map((p) => {
                  const you = !admin && p.email === me;
                  if (editing?.id === p.id) {
                    return (
                      <li key={p.id} className="p-3">
                        <form onSubmit={saveAddress} className="flex flex-wrap items-center gap-2">
                          <input
                            type="email"
                            autoFocus
                            aria-label={`New address for ${p.email}`}
                            className={`${field} min-w-48 flex-1`}
                            value={editing.email}
                            onChange={(e) => setEditing({ id: p.id, email: e.target.value })}
                          />
                          <button className={quiet} disabled={busy !== null || !editing.email.includes("@")}>
                            {busy === `address:${p.id}` ? "Saving…" : "Save"}
                          </button>
                          <button type="button" className="text-xs text-slate-500 hover:text-slate-700" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </form>
                      </li>
                    );
                  }
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <span className="min-w-40 flex-1 truncate text-slate-700" title={p.email}>
                        {p.name ? `${p.name} · ` : ""}
                        {p.email}
                      </span>
                      {p.owner && <Chip tone="warn">Super admin</Chip>}
                      {you ? <Chip tone="info">You</Chip> : p.last_login_at ? <Chip tone="good">Signed in {ago(p.last_login_at)}</Chip> : <Chip>Not yet</Chip>}
                      {inCharge && (
                        <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => setEditing({ id: p.id, email: p.email })} disabled={busy !== null}>
                          Change address
                        </button>
                      )}
                      {!you && (
                        <>
                          {inCharge && (
                            <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => void resend(p)} disabled={busy !== null}>
                              {busy === `resend:${p.id}` ? "Sending…" : "Resend invite"}
                            </button>
                          )}
                          {admin && !p.owner && (
                            <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => void makeSuperAdmin(p)} disabled={busy !== null}>
                              {busy === `owner:${p.id}` ? "Saving…" : "Make super admin"}
                            </button>
                          )}
                          {(admin || (inCharge && !p.owner)) && (
                            <button className="text-xs text-slate-400 hover:text-rose-700" onClick={() => void removePerson(p)} disabled={busy !== null}>
                              Remove
                            </button>
                          )}
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
