import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { currentUser, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in — Ava" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  let next = safeNext(one("next"));
  if (next.startsWith("/login")) next = "/";

  const user = await currentUser();
  if (user) redirect(user.role === "admin" ? next : "/client");

  return <LoginForm next={next} email={one("email") ?? ""} error={one("error") ?? null} />;
}
