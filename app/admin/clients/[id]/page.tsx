import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import Setup from "@/components/portal/Setup";
import Workspace from "@/components/portal/Workspace";
import { pickerConfig } from "@/lib/google";
import { isUuid, requireAdminPage } from "@/lib/auth";
import { getClient } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client — Ava" };

/**
 * One client, as NDI sees it: their setup — all of it, where the client's own Setup tab
 * has only their part — then their page as they see it.
 */
export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPage();
  const { id } = await params;
  if (!isUuid(id) || !(await getClient(id))) notFound();
  return (
    <>
      <TopBar user={user} active="clients" />
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <Setup clientId={id} />
      </div>
      <Workspace clientId={id} picker={pickerConfig()} />
    </>
  );
}
