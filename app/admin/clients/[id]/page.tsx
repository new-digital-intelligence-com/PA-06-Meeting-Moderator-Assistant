import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import ClientSettings from "@/components/admin/ClientSettings";
import Workspace from "@/components/portal/Workspace";
import { avaScreen } from "@/lib/ava";
import { pickerConfig } from "@/lib/google";
import { isUuid, requireAdminPage } from "@/lib/auth";
import { getClient } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Client — Ava" };

/** One client, as NDI sees it: who can use her and which invites are theirs, then their page as they see it. */
export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdminPage();
  const { id } = await params;
  const client = isUuid(id) ? await getClient(id) : null;
  if (!client) notFound();
  // Her log of this client's meetings, on her server (bot/logs.mjs) — for NDI only. The
  // name is for its title until her first meeting with them writes it there.
  const screen = await avaScreen();
  const log = screen ? `${screen}/logs/client/${id}?name=${encodeURIComponent(client.name)}` : null;
  return (
    <>
      <TopBar user={user} active="clients" />
      <ClientSettings id={id} log={log} />
      <Workspace clientId={id} picker={pickerConfig()} />
    </>
  );
}
