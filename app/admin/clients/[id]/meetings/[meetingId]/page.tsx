import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import MeetingPage from "@/components/portal/MeetingPage";
import { pickerConfig } from "@/lib/google";
import { isUuid, requireAdminPage } from "@/lib/auth";
import { getClient } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Meeting — Ava" };

/** One of a client's meetings, as NDI sees it: the same page the client has. */
export default async function AdminMeetingPage({ params }: { params: Promise<{ id: string; meetingId: string }> }) {
  const user = await requireAdminPage();
  const { id, meetingId } = await params;
  if (!isUuid(id) || !isUuid(meetingId) || !(await getClient(id))) notFound();
  return (
    <>
      <TopBar user={user} active="clients" />
      <MeetingPage meetingId={meetingId} clientId={id} picker={pickerConfig()} />
    </>
  );
}
