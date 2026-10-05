import { cookies } from "next/headers";
import { decrypt, encrypt } from "./seal";

export { decrypt, encrypt };

export const COOKIE = "pa_session";

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at: number;
  scope?: string;
  email?: string;
};

/**
 * Who is signed in to the portal: an NDI admin, or a member of one client. Decided once,
 * at sign-in; client routes check the membership again on every request.
 */
export type PortalUser = {
  email: string;
  name?: string;
  role: "admin" | "client";
  clientId?: string;
};

export type Session = {
  google?: GoogleTokens;
  user?: PortalUser;
};

/** The session in a cookie value, or an empty one when it is missing or tampered with. */
export function sessionFrom(raw: string | undefined): Session {
  if (!raw) return {};
  const plain = decrypt(raw);
  if (!plain) return {};
  try {
    return JSON.parse(plain) as Session;
  } catch {
    return {};
  }
}

export async function readSession(): Promise<Session> {
  return sessionFrom((await cookies()).get(COOKIE)?.value);
}

/** Serialised cookie value — set it on a NextResponse. */
export function sessionCookie(session: Session) {
  return {
    name: COOKIE,
    value: encrypt(JSON.stringify(session)),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie({}), value: "", maxAge: 0 };
}
