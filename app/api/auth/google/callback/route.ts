import { NextResponse } from "next/server";
import { exchangeCode, exchangeLoginCode } from "@/lib/google";
import { readSession, sessionCookie } from "@/lib/session";
import { saveAvaGoogle } from "@/lib/ava";
import { appOrigin, roleFor, safeNext } from "@/lib/auth";

export const runtime = "nodejs";

function cookieOf(request: Request, name: string): string | undefined {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function done(response: NextResponse) {
  response.cookies.delete("pa_oauth_state");
  response.cookies.delete("pa_oauth_as");
  response.cookies.delete("pa_login_next");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Back to this site's own address — behind a proxy the request's is its inside one.
  const origin = appOrigin(request);
  const home = new URL("/", origin);
  const as = cookieOf(request, "pa_oauth_as");

  /**
   * Signing in to the portal goes back to /login when anything is wrong — "/" would only
   * bounce a signed-out visitor there anyway, without the reason.
   */
  const fail = (reason: string) => {
    if (as !== "login") {
      home.searchParams.set("google", `error:${reason}`);
      return done(NextResponse.redirect(home));
    }
    const login = new URL("/login", origin);
    login.searchParams.set("error", reason);
    return done(NextResponse.redirect(login));
  };

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "Sign-in was cancelled." : error);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== cookieOf(request, "pa_oauth_state")) {
    return fail(as === "login" ? "That sign-in link has expired. Try again." : "invalid_state");
  }

  /**
   * Signing in to the portal: an NDI admin, or an address an admin invited for a client.
   * Anybody else is turned away here — nobody signs up on their own.
   */
  if (as === "login") {
    try {
      const { email, name } = await exchangeLoginCode(code);
      const user = await roleFor(email, name);
      if (!user) return fail(`${email} has no access to Ava yet. Ask NDI to invite it.`);
      const target = new URL(safeNext(cookieOf(request, "pa_login_next")), origin);
      const session = await readSession();
      const response = NextResponse.redirect(target);
      response.cookies.set(sessionCookie({ ...session, user }));
      return done(response);
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Sign-in failed.");
    }
  }

  try {
    const tokens = await exchangeCode(code);

    /**
     * Connecting HER account: kept on the server only, so she can read her invites and
     * send notes with nobody's browser open. It deliberately does not touch your own
     * control-room session — that stays whoever you are.
     *
     * The address is checked. Google pre-selects whatever account the browser is signed
     * in as, and saving the wrong one would have her reading your calendar and mailing
     * people as you.
     */
    if (as === "ava") {
      const want = process.env.AVA_EMAIL?.trim().toLowerCase();
      const got = tokens.email?.toLowerCase();
      if (want && got !== want) {
        return fail(`signed in as ${got ?? "an unknown account"}, not ${want}. Try again and pick her account.`);
      }
      await saveAvaGoogle(tokens);
      home.searchParams.set("google", "ava-connected");
      return done(NextResponse.redirect(home));
    }

    const session = await readSession();
    // Google only returns a refresh token on the first consent — keep the old one.
    const merged = {
      ...session,
      google: { ...tokens, refresh_token: tokens.refresh_token ?? session.google?.refresh_token },
    };
    home.searchParams.set("google", "connected");
    const response = NextResponse.redirect(home);
    response.cookies.set(sessionCookie(merged));
    return done(response);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "unknown");
  }
}
