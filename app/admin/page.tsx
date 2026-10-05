import type { Metadata } from "next";
import TopBar from "@/components/TopBar";
import Clients from "@/components/admin/Clients";
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
        <Clients ava={process.env.AVA_EMAIL || null} />
      ) : (
        <main className="mx-auto w-full max-w-3xl p-6">
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-5 text-sm text-amber-200">
            Clients live in Postgres, and DATABASE_URL is not set. Add it (Supabase, see .env.example), run{" "}
            <code className="text-amber-100">node db/migrate.mjs</code> once, and reload.
          </p>
        </main>
      )}
    </>
  );
}
