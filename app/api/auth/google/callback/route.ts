import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google";
import { readSession, sessionCookie } from "@/lib/session";
import { saveAvaGoogle } from "@/lib/ava";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const home = new URL("/", url.origin);

  const error = url.searchParams.get("error");
  if (error) {
    home.searchParams.set("google", `error:${error}`);
    return NextResponse.redirect(home);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("pa_oauth_state="))
    ?.slice("pa_oauth_state=".length);

  if (!code || !state || state !== expectedState) {
    home.searchParams.set("google", "error:invalid_state");
    return NextResponse.redirect(home);
  }

  const asAva =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("pa_oauth_as="))
      ?.slice("pa_oauth_as=".length) === "ava";

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
    if (asAva) {
      const want = process.env.AVA_EMAIL?.trim().toLowerCase();
      const got = tokens.email?.toLowerCase();
      if (want && got !== want) {
        home.searchParams.set("google", `error:signed in as ${got ?? "an unknown account"}, not ${want}. Try again and pick her account.`);
        const response = NextResponse.redirect(home);
        response.cookies.delete("pa_oauth_state");
        response.cookies.delete("pa_oauth_as");
        return response;
      }
      await saveAvaGoogle(tokens);
      home.searchParams.set("google", "ava-connected");
      const response = NextResponse.redirect(home);
      response.cookies.delete("pa_oauth_state");
      response.cookies.delete("pa_oauth_as");
      return response;
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
    response.cookies.delete("pa_oauth_state");
    response.cookies.delete("pa_oauth_as");
    return response;
  } catch (e) {
    home.searchParams.set("google", `error:${e instanceof Error ? e.message : "unknown"}`);
    return NextResponse.redirect(home);
  }
}
