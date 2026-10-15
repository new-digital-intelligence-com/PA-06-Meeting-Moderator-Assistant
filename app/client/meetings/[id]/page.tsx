import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import MeetingPage from "@/components/portal/MeetingPage";
import { pickerConfig } from "@/lib/google";
import { accessFor, isUuid, requireUserPage } from "@/lib/auth";
import { getClient } from "@/lib/clients";
import { hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meeting — Ava" };

/** One of a client's meetings, on its own page. Whether it is theirs, the API checks. */
export default async function ClientMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUserPage();
  if (user.role === "admin") redirect("/admin");
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Checked again, not taken from the session: access can be withdrawn after signing in.
  const access = hasDb() ? await accessFor(user.email) : null;
  const client = access?.clientId ? await getClient(access.clientId) : null;
  if (!client) redirect("/client");
  return (
    <>
      <TopBar user={user} clientName={client.name} />
      <MeetingPage meetingId={id} picker={pickerConfig()} />
    </>
  );
}
