import type { Metadata } from "next";
import TopBar from "@/components/TopBar";
import Clients from "@/components/admin/Clients";
import { avaScreen } from "@/lib/ava";
import { requireAdminPage } from "@/lib/auth";
import { hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Clients — Ava" };

export default async function AdminPage() {
  const user = await requireAdminPage();
  return (
    <>
      <TopBar user={user} active="clients" />
      {hasDb() ? (
        // Her screen's address, as her runner reports it: each client's card links to their log there.
        <Clients ava={process.env.AVA_EMAIL || null} screen={await avaScreen()} />
      ) : (
        <main className="mx-auto w-full max-w-3xl p-6">
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Clients live in Supabase, and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Run{" "}
            <code className="text-amber-900">db/schema.sql</code> once in Supabase&apos;s SQL editor, add pa-06 to its exposed
            schemas, set those two (see .env.example), and reload.
          </p>
        </main>
      )}
    </>
  );
}
