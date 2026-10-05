import type { GoogleTokens, Session } from "./session";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  // Full Drive, not drive.file: the moderator shares documents that already exist and
  // that this app did not create, and it changes their permissions. drive.file only
  // ever sees files the app made itself, which is none of them.
  "https://www.googleapis.com/auth/drive",
];

function creds() {
  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set (see .env.example)");
  }
  return { client_id, client_secret };
}

/**
 * The site's own "Sign in with Google": its own OAuth client when one is set — in a project
 * open to outside accounts (ava-avatar), so clients can use it — else the main one. Ava's
 * own connection (calendar, Gmail, Drive) always stays on the main client.
 */
function loginCreds() {
  const client_id = process.env.GOOGLE_LOGIN_CLIENT_ID?.trim();
  const client_secret = process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim();
  return client_id && client_secret ? { client_id, client_secret } : creds();
}

export function redirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`
  );
}

export function buildAuthUrl(state: string, loginHint?: string) {
  const { client_id } = creds();
  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // select_account as well as consent: connecting Ava is done from a browser that is
    // usually signed in as somebody else, and Google would otherwise quietly pick them.
    prompt: loginHint ? "select_account consent" : "consent",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Signing in to the portal: who you are, and nothing else. Admins and clients get no
 * access to anything of theirs through this — Ava's own account is connected separately.
 */
export function buildLoginUrl(state: string) {
  const { client_id } = loginCreds();
  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

function idClaims(idToken?: string): { email?: string; email_verified?: boolean; name?: string } {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function emailFromIdToken(idToken?: string): string | undefined {
  const { email } = idClaims(idToken);
  return typeof email === "string" ? email : undefined;
}

/**
 * Who signed in, from the ID token Google returned straight to us over TLS (not a token
 * a browser handed over, so it needs no signature check). Unverified addresses are refused.
 */
export async function exchangeLoginCode(code: string): Promise<{ email: string; name?: string }> {
  const { client_id, client_secret } = loginCreds();
  const t = await tokenRequest({ code, client_id, client_secret, redirect_uri: redirectUri(), grant_type: "authorization_code" });
  const claims = idClaims(t.id_token);
  if (typeof claims.email !== "string" || claims.email_verified === false) {
    throw new Error("Google did not confirm that email address.");
  }
  return { email: claims.email.toLowerCase(), name: typeof claims.name === "string" ? claims.name : undefined };
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Google token request failed: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json as TokenResponse;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const { client_id, client_secret } = creds();
  const t = await tokenRequest({
    code,
    client_id,
    client_secret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
    scope: t.scope,
    email: emailFromIdToken(t.id_token),
  };
}

/**
 * Wraps the Google tokens for one request. Refreshes the access token on demand
 * and reports back (via `dirty`) when the caller needs to re-write the cookie.
 */
export class GoogleClient {
  dirty = false;

  constructor(private tokens: GoogleTokens) {}

  static fromSession(session: Session): GoogleClient | null {
    return session.google ? new GoogleClient(session.google) : null;
  }

  get current(): GoogleTokens {
    return this.tokens;
  }

  private async accessToken(): Promise<string> {
    if (Date.now() < this.tokens.expires_at - 60_000) return this.tokens.access_token;
    if (!this.tokens.refresh_token) {
      throw new Error("Google access token expired and no refresh token is stored. Reconnect Google.");
    }
    const { client_id, client_secret } = creds();
    const t = await tokenRequest({
      client_id,
      client_secret,
      refresh_token: this.tokens.refresh_token,
      grant_type: "refresh_token",
    });
    this.tokens = {
      ...this.tokens,
      access_token: t.access_token,
      expires_at: Date.now() + t.expires_in * 1000,
    };
    this.dirty = true;
    return this.tokens.access_token;
  }

  /** A current access token, for requests `request` cannot make (uploads, downloads). */
  token(): Promise<string> {
    return this.accessToken();
  }

  async request<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.accessToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const message = json?.error?.message ?? json?.error_description ?? `HTTP ${res.status}`;
      throw new Error(`Google API error: ${message}`);
    }
    return json as T;
  }
}
