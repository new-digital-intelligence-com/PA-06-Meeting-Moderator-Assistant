import { cookies } from "next/headers";
import { decrypt, encrypt } from "./seal";
import { SESSION_MS, stillValid } from "./sessionLife";

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
  /** When this sign-in ends (epoch ms): checked here, not only by the browser's cookie. */
  until?: number;
};

/** The session in a cookie value, or an empty one when it is missing, tampered with or over. */
export function sessionFrom(raw: string | undefined): Session {
  if (!raw) return {};
  const plain = decrypt(raw);
  if (!plain) return {};
  try {
    const session = JSON.parse(plain) as Session;
    return stillValid(session) ? session : {};
  } catch {
    return {};
  }
}

export async function readSession(): Promise<Session> {
  return sessionFrom((await cookies()).get(COOKIE)?.value);
}

/** Serialised cookie value — set it on a NextResponse. Good for 30 days from now, cookie and session alike. */
export function sessionCookie(session: Session) {
  return {
    name: COOKIE,
    value: encrypt(JSON.stringify({ ...session, until: Date.now() + SESSION_MS })),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie({}), value: "", maxAge: 0 };
}
