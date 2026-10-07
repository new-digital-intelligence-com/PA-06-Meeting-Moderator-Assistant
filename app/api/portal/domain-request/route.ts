import { NextResponse } from "next/server";
import { avaEmail, avaGoogle } from "@/lib/ava";
import { appOrigin, handle, HttpError, portalClient } from "@/lib/auth";
import { domainsFor, escapeHtml, getClient, listMembers, ownerOf } from "@/lib/clients";
import { redisOrMongoKey } from "@/lib/store";
import { sendEmail } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 30;

/** One request per client at most this often: a page left open must not fill her inbox. */
const EVERY_MS = 10 * 60_000;

/**
 * A client's super admin asks NDI to change their company domain — only NDI changes it, as
 * anybody at it signs in to the client's page. The domain asked for is checked as NDI's would
 * be (real, not a shared provider, nobody else's), then the request goes to Ava's own inbox
 * from her Gmail, with a link to the client's page in /admin.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { user, clientId } = await portalClient(request);
    if (user.role === "admin") throw new HttpError(400, "NDI changes the domain right here, on the client's setup.");
    const owner = ownerOf(await listMembers(clientId));
    if (user.email !== owner?.email) throw new HttpError(403, `Only your super admin${owner ? `, ${owner.email},` : ""} asks for a change.`);
    const client = await getClient(clientId);
    if (!client) throw new HttpError(404, "No such client.");

    const body = (await request.json().catch(() => ({}))) as { domains?: string; note?: string };
    const note = String(body.note ?? "").trim().slice(0, 1000);
    let domains: string[];
    try {
      domains = await domainsFor(clientId, body.domains ?? "", { admin: false });
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "That domain cannot be used.");
    }
    const same = domains.join(",") === client.domains.join(",");
    if (same && !note) throw new HttpError(400, domains.length ? "That is your domain already." : "Write which domain, or why.");

    const last = Number((await redisOrMongoKey(`domain-request:${clientId}`).read()) ?? 0);
    if (Date.now() - last < EVERY_MS) throw new HttpError(429, "Your last request went a few minutes ago — NDI will be in touch.");

    const google = await avaGoogle();
    const to = await avaEmail();
    if (!google || !to) throw new HttpError(503, "The request cannot be sent right now: Ava's Google account is not connected. Ask NDI directly.");

    const link = `${appOrigin(request)}/admin/clients/${client.id}`;
    const now = client.domains.length ? client.domains.map((d) => `@${d}`).join(", ") : "none";
    const asked = domains.length ? domains.map((d) => `@${d}`).join(", ") : "none — take it off";
    const subject = `Company domain change asked for: ${client.name}`;
    const text = [
      `${user.email}, ${client.name}'s super admin, asks NDI to change their company domain.`,
      "",
      `Now: ${now}`,
      `Asked for: ${asked}`,
      ...(note ? ["", `Their note: ${note}`] : []),
      "",
      `Everybody at the domain signs in to ${client.name}'s page and has their invites accepted. Change it on their page:`,
      link,
      "",
      "— Ava",
    ].join("\n");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#111827;max-width:560px">
<p><b>${escapeHtml(user.email)}</b>, ${escapeHtml(client.name)}'s super admin, asks NDI to change their company domain.</p>
<p>Now: <b>${escapeHtml(now)}</b><br>Asked for: <b>${escapeHtml(asked)}</b></p>
${note ? `<p>Their note: ${escapeHtml(note)}</p>` : ""}
<p style="color:#6B7280">Everybody at the domain signs in to ${escapeHtml(client.name)}'s page and has their invites accepted.</p>
<p><a href="${link}" style="display:inline-block;background:#002A6C;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Open ${escapeHtml(client.name)}</a></p>
<p style="color:#6B7280">— Ava</p></div>`;
    await sendEmail(google, to, subject, text, html);
    await redisOrMongoKey(`domain-request:${clientId}`).write(String(Date.now()));
    return NextResponse.json({ sent: true });
  });
}
