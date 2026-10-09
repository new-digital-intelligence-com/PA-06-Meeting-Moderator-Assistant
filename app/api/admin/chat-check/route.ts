import { NextResponse } from "next/server";
import { avaGoogle } from "@/lib/ava";
import { handle, HttpError, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

const CHAT = "https://chat.googleapis.com/v1";

/**
 * Temporary, NDI only: Google Chat calls as Ava, read only, each with Google's whole answer —
 * to find why her replies are refused. Nothing is sent. Message words are left out.
 */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const google = await avaGoogle();
    if (!google) throw new HttpError(409, "Ava's Google is not connected.");
    const token = await google.token();
    const call = async (url: string) => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      let body: unknown = text.slice(0, 1500);
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { url: url.replace(CHAT, ""), status: res.status, body };
    };
    const who = await call("https://openidconnect.googleapis.com/v1/userinfo");
    const spaces = await call(`${CHAT}/spaces?pageSize=50`);
    const list = ((spaces.body as { spaces?: { name: string; spaceType?: string }[] })?.spaces ?? []).slice(0, 6);
    const other = new URL(request.url).searchParams.get("user");
    const results = [];
    for (const s of list) {
      results.push(await call(`${CHAT}/${s.name}`));
      results.push(await call(`${CHAT}/${s.name}/members?pageSize=10`));
      const msgs = await call(`${CHAT}/${s.name}/messages?pageSize=3&orderBy=createTime%20desc`);
      // Who wrote and when only — not what.
      const kept = (msgs.body as { messages?: { name: string; sender?: unknown; createTime?: string; thread?: unknown }[] })?.messages?.map((m) => ({
        name: m.name,
        sender: m.sender,
        createTime: m.createTime,
        thread: m.thread,
      }));
      results.push({ ...msgs, body: kept ?? msgs.body });
    }
    const direct = other ? await call(`${CHAT}/spaces:findDirectMessage?name=${encodeURIComponent(other)}`) : null;
    return NextResponse.json({
      scope: google.current.scope,
      who: { status: who.status, sub: (who.body as { sub?: string })?.sub, email: (who.body as { email?: string })?.email },
      spaces: { status: spaces.status, list },
      results,
      direct,
    });
  });
}
