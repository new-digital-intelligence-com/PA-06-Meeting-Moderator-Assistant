import type { Metadata } from "next";
import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import Workspace from "@/components/portal/Workspace";
import { accessFor, requireUserPage } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ava" };

/** A client's own page. Admins see clients from /admin instead. */
export default async function ClientPage() {
  const user = await requireUserPage();
  if (user.role === "admin") redirect("/admin");

  // Checked again, not taken from the session: access can be withdrawn after signing in.
  const access = hasDb() ? await accessFor(user.email) : null;
  const client = access?.clientId ? await getClient(access.clientId) : null;
  if (!client) {
    return (
      <>
        <TopBar user={user} />
        <main className="mx-auto w-full max-w-xl p-6">
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            {user.email} no longer has access to Ava. If that is a mistake, ask your contact at NDI.
          </p>
        </main>
      </>
    );
  }
  return (
    <>
      <TopBar user={user} clientName={client.name} />
      <Workspace />
    </>
  );
}
