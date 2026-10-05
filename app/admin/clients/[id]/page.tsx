import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import ClientSettings from "@/components/admin/ClientSettings";
import Workspace from "@/components/portal/Workspace";
import { pickerConfig } from "@/lib/google";
import { isUuid, requireAdminPage } from "@/lib/auth";
import { getClient } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client — Ava" };

/** One client, as NDI sees it: who signs in and which invites are theirs, then their page as they see it. */
export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPage();
  const { id } = await params;
  if (!isUuid(id) || !(await getClient(id))) notFound();
  return (
    <>
      <TopBar user={user} active="clients" />
      <ClientSettings id={id} />
      <Workspace clientId={id} picker={pickerConfig()} />
    </>
  );
}
