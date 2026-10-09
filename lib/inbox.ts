/**
 * Her inbox: she answers the emails the people she works for write to her — once a minute,
 * brought by her runner's calendar read (/api/ava/upcoming) — in the same thread, to the
 * sender, with their client's knowledge (lib/answers.ts).
 *
 * Each email she deals with gets a label, so none is answered twice: "Ava/Answered" (and
 * read), or "Ava/Not answered" — from a stranger, a machine, a mailing list, a calendar
 * invitation (her calendar answers those) — left unread for NDI to see. Only mail that came
 * after she started answering; never her own.
 */
import { answerMessage, clientOfSender, noteStatus, type Said } from "./answers";
import { EMAIL_SCOPES, granted, type GoogleClient } from "./google";
import { redisOrMongoKey } from "./store";
import { sendReply } from "./workspace";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** At most this many answers to one sender in an hour: two machines must not talk forever. */
const PER_SENDER_HOUR = 10;

type Header = { name: string; value: string };
type Part = { mimeType?: string; filename?: string; headers?: Header[]; body?: { data?: string; size?: number }; parts?: Part[] };
type Message = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: Part; snippet?: string };

const header = (p: Part | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
const flat = (p?: Part): Part[] => (p ? [p, ...(p.parts ?? []).flatMap(flat)] : []);

/** "Anna Weber <anna@acme.com>" → its address and name. */
export function addressOf(from: string): { email: string; name?: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  const email = (m ? m[2] : from).trim().toLowerCase();
  const name = m?.[1]?.trim() || undefined;
  return { email, name };
}

/** The words of a message, without the quoted ones below them. */
export function bodyText(payload?: Part): string {
  const parts = flat(payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && !p.filename)?.body?.data;
  const html = parts.find((p) => p.mimeType === "text/html" && !p.filename)?.body?.data;
  let text = plain
    ? decode(plain)
    : decode(html)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
  // Where the quoted conversation starts, as Gmail, Outlook and Apple Mail write it.
  const cut = text.search(
    /^(On .+ wrote:|Le .+ a écrit ?:|Am .+ schrieb .+:|El .+ escribió:|-{2,} ?Original Message ?-{2,}|_{10,}|From: .+\r?\nSent: .+)\s*$/im,
  );
  if (cut > 0) text = text.slice(0, cut);
  return text
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Why an email is not a person writing to her — or null when it is. */
export function machine(payload: Part | undefined, from: string): string | null {
  const auto = header(payload, "Auto-Submitted");
  if (auto && auto.toLowerCase() !== "no") return "an automatic reply";
  if (/\b(bulk|list|junk)\b/i.test(header(payload, "Precedence"))) return "bulk mail";
  if (header(payload, "List-Id") || header(payload, "List-Unsubscribe")) return "a mailing list";
  if (header(payload, "X-Autoreply") || header(payload, "X-Autorespond")) return "an automatic reply";
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|calendar-notification)[@+.]/i.test(from)) return "a no-reply address";
  if (flat(payload).some((p) => /text\/calendar|application\/ics/i.test(p.mimeType ?? ""))) return "a calendar invitation";
  return null;
}

let labels: { answered: string; notAnswered: string } | null = null;

/** Her two labels, made the first time. */
async function ensureLabels(google: GoogleClient) {
  if (labels) return labels;
  const { labels: all = [] } = await google.request<{ labels?: { id: string; name: string }[] }>(`${GMAIL}/labels`);
  const find = async (name: string) =>
    all.find((l) => l.name === name)?.id ??
    (await google.request<{ id: string }>(`${GMAIL}/labels`, { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }) })).id;
  labels = { answered: await find("Ava/Answered"), notAnswered: await find("Ava/Not answered") };
  return labels;
}

const recent = new Map<string, number[]>();
/** Room for one more answer to this sender within the hour — counted as it is taken. */
function room(email: string, now: number): boolean {
  const times = (recent.get(email) ?? []).filter((t) => now - t < 60 * 60_000);
  if (times.length >= PER_SENDER_HOUR) return false;
  recent.set(email, [...times, now]);
  return true;
}

let running = false;

/** One look at her inbox. Called once a minute; a look still going is not doubled. */
export async function answerInbox(google: GoogleClient, log: (m: string) => void = console.log): Promise<void> {
  if (running) return;
  if (process.env.AVA_ANSWER_EMAIL === "off") return noteStatus("email", { state: "off", at: Date.now() });
  if (!granted(google.current, EMAIL_SCOPES)) {
    return noteStatus("email", { state: "reconnect", at: Date.now(), detail: "Connect Ava's Google again to let her read and answer her email." });
  }
  running = true;
  try {
    const now = Date.now();
    // Only mail from after she started answering: never a backlog.
    const startKey = redisOrMongoKey("between:email:since");
    let since = Number(await startKey.read());
    if (!since) {
      since = now;
      await startKey.write(String(since));
    }
    const { answered, notAnswered } = await ensureLabels(google);
    const q = "in:inbox is:unread -from:me newer_than:3d -category:promotions -category:social -category:forums";
    const { messages = [] } = await google.request<{ messages?: { id: string }[] }>(
      `${GMAIL}/messages?${new URLSearchParams({ q, maxResults: "15" })}`,
    );
    let last: { to: string; client: string } | undefined;
    for (const { id } of messages.reverse()) {
      const msg = await google.request<Message>(`${GMAIL}/messages/${id}?format=full`);
      if (msg.labelIds?.some((l) => l === answered || l === notAnswered)) continue;
      if (Number(msg.internalDate ?? 0) < since) continue;
      const mark = (label: string, read: boolean) =>
        google.request(`${GMAIL}/messages/${id}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [label], ...(read ? { removeLabelIds: ["UNREAD"] } : {}) }),
        });
      const from = addressOf(header(msg.payload, "From"));
      const subject = header(msg.payload, "Subject");
      const why = machine(msg.payload, from.email);
      if (why) {
        log(`[inbox] not answered — ${why}: ${from.email} “${subject}”`);
        await mark(notAnswered, false);
        continue;
      }
      const client = await clientOfSender(from.email);
      if (!client) {
        log(`[inbox] not answered — not one of her clients' people: ${from.email} “${subject}”`);
        await mark(notAnswered, false);
        continue;
      }
      if (!room(from.email, now)) {
        log(`[inbox] not answered — ${PER_SENDER_HOUR} answers to ${from.email} this hour already`);
        await mark(notAnswered, false);
        continue;
      }
      // The thread so far, hers included, oldest first.
      const thread = await google.request<{ messages?: Message[] }>(`${GMAIL}/threads/${msg.threadId}?format=full`).catch(() => ({ messages: [msg] }));
      const conversation: Said[] = (thread.messages ?? [msg])
        .filter((m) => Number(m.internalDate ?? 0) <= Number(msg.internalDate ?? 0))
        .map((m) => {
          const who = addressOf(header(m.payload, "From"));
          return { from: who.name ? `${who.name} <${who.email}>` : who.email, text: bodyText(m.payload), mine: m.labelIds?.includes("SENT") };
        })
        .filter((m) => m.text);
      if (!conversation.length) {
        await mark(notAnswered, false);
        continue;
      }
      let text: string;
      try {
        text = await answerMessage({ client, channel: "email", sender: from, subject, conversation });
      } catch (e) {
        log(`[inbox] could not answer ${from.email}: ${e instanceof Error ? e.message : e}`);
        await mark(notAnswered, false);
        continue;
      }
      const messageId = header(msg.payload, "Message-ID") || header(msg.payload, "Message-Id");
      await sendReply(google, {
        to: from.name ? `${from.name} <${from.email}>` : from.email,
        subject: /^re:/i.test(subject) ? subject : `Re: ${subject || "your message"}`,
        body: text,
        threadId: msg.threadId,
        inReplyTo: messageId,
        references: [header(msg.payload, "References"), messageId].filter(Boolean).join(" "),
      });
      await mark(answered, true);
      last = { to: from.email, client: client.name };
      log(`[inbox] answered ${from.email} for ${client.name}: “${subject}”`);
    }
    await noteStatus("email", { state: "on", at: Date.now(), answered: last });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`[inbox] ${detail}`);
    await noteStatus("email", { state: "error", at: Date.now(), detail });
  } finally {
    running = false;
  }
}
