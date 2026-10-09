/**
 * Google Chat, as herself: she answers in her one-to-one chats, and in the spaces and group
 * chats she is in when somebody @mentions her — every few seconds, brought by her runner's
 * check for meetings to join (/api/ava/dispatch), in the message's thread, with the
 * sender's client's knowledge (lib/answers.ts).
 *
 * Chat says who wrote only by an id: NDI's directory turns it into an address, and an address
 * that is nobody she works for gets no answer — in a one-to-one chat, one line saying so.
 * Only messages from after she started answering; never her own, nor another bot's.
 */
import { answerMessage, clientOfSender, noteStatus, type Said } from "./answers";
import { granted, type GoogleClient } from "./google";
import { redisOrMongoKey } from "./store";

const CHAT = "https://chat.googleapis.com/v1";
const SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages.readonly",
  "https://www.googleapis.com/auth/chat.messages.create",
  "https://www.googleapis.com/auth/directory.readonly",
];
/** At most this many answers to one person in an hour. */
const PER_SENDER_HOUR = 30;

type Space = { name: string; spaceType?: string; displayName?: string; lastActiveTime?: string; createTime?: string };
type ChatUser = { name?: string; type?: string };
type Annotation = { type?: string; startIndex?: number; length?: number; userMention?: { user?: ChatUser } };
type ChatMessage = { name: string; sender?: ChatUser; createTime?: string; text?: string; thread?: { name?: string }; annotations?: Annotation[] };
/** Since when she answers, and the time of the last message seen in each space. */
type Seen = { since: number; spaces: Record<string, number> };

const iso = (ms: number) => new Date(ms).toISOString();

/** Her own Chat id — users/<her Google account id>, the same as her sign-in's "sub". */
let me: string | null = null;
async function herId(google: GoogleClient): Promise<string> {
  if (me) return me;
  const info = await google.request<{ sub?: string }>("https://openidconnect.googleapis.com/v1/userinfo");
  if (!info.sub) throw new Error("Google did not say who she is (userinfo has no sub)");
  me = `users/${info.sub}`;
  return me;
}

/** Who wrote: their address, from NDI's directory — null for anybody outside it. */
const emails = new Map<string, string | null>();
async function emailOf(google: GoogleClient, user: string): Promise<string | null> {
  if (emails.has(user)) return emails.get(user)!;
  const id = user.replace(/^users\//, "");
  const person = await google
    .request<{ emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[] }>(
      `https://people.googleapis.com/v1/people/${encodeURIComponent(id)}?personFields=emailAddresses&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`,
    )
    .catch(() => null);
  const list = person?.emailAddresses ?? [];
  const email = (list.find((e) => e.metadata?.primary) ?? list[0])?.value?.toLowerCase() ?? null;
  emails.set(user, email);
  return email;
}

/** The words of a message without the @mention of her that brought it. */
export function withoutMention(m: ChatMessage, her: string): string {
  let text = m.text ?? "";
  const mentions = (m.annotations ?? [])
    .filter((a) => a.type === "USER_MENTION" && a.userMention?.user?.name === her && typeof a.startIndex === "number")
    .sort((a, b) => b.startIndex! - a.startIndex!);
  for (const a of mentions) text = text.slice(0, a.startIndex!) + text.slice(a.startIndex! + (a.length ?? 0));
  return text.replace(/\s{2,}/g, " ").trim();
}

const mentions = (m: ChatMessage, her: string) =>
  (m.annotations ?? []).some((a) => a.type === "USER_MENTION" && a.userMention?.user?.name === her);

const recent = new Map<string, number[]>();
function room(who: string, now: number): boolean {
  const times = (recent.get(who) ?? []).filter((t) => now - t < 60 * 60_000);
  if (times.length >= PER_SENDER_HOUR) return false;
  recent.set(who, [...times, now]);
  return true;
}

/** One-to-one chats already told she cannot help their writer. */
const toldStranger = new Set<string>();

/** The conversation the message is part of: its thread in a space, the last messages of a one-to-one chat. */
async function conversationOf(google: GoogleClient, space: Space, m: ChatMessage, her: string, nameOf: (u: string) => Promise<string>): Promise<Said[]> {
  const direct = space.spaceType === "DIRECT_MESSAGE";
  const filter = [
    `createTime > "${iso(Date.parse(m.createTime ?? "") - 6 * 60 * 60_000)}"`,
    ...(!direct && m.thread?.name ? [`thread.name = ${m.thread.name}`] : []),
  ].join(" AND ");
  const { messages = [] } = await google
    .request<{ messages?: ChatMessage[] }>(`${CHAT}/${space.name}/messages?${new URLSearchParams({ filter, orderBy: "createTime desc", pageSize: "12" })}`)
    .catch(() => ({ messages: [m] }));
  const upTo = Date.parse(m.createTime ?? "");
  const said: Said[] = [];
  for (const x of messages.filter((x) => Date.parse(x.createTime ?? "") <= upTo).reverse()) {
    const mine = x.sender?.name === her;
    const text = mine ? (x.text ?? "") : withoutMention(x, her);
    if (text.trim()) said.push({ from: mine ? "Ava" : await nameOf(x.sender?.name ?? ""), text, mine });
  }
  return said.length ? said : [{ from: await nameOf(m.sender?.name ?? ""), text: withoutMention(m, her) }];
}

async function reply(google: GoogleClient, space: Space, m: ChatMessage, text: string) {
  await google.request(`${CHAT}/${space.name}/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`, {
    method: "POST",
    body: JSON.stringify({ text, ...(m.thread?.name ? { thread: { name: m.thread.name } } : {}) }),
  });
}

let running = false;

/** One look at her chats. Called every few seconds; a look still going is not doubled. */
export async function answerChats(google: GoogleClient, log: (m: string) => void = console.log): Promise<void> {
  if (running) return;
  if (process.env.AVA_ANSWER_CHAT === "off") return noteStatus("chat", { state: "off", at: Date.now() });
  if (!granted(google.current, SCOPES)) {
    return noteStatus("chat", { state: "reconnect", at: Date.now(), detail: "Connect Ava's Google again to let her answer in Google Chat." });
  }
  running = true;
  const key = redisOrMongoKey("between:chat:seen");
  try {
    const now = Date.now();
    const seen: Seen = JSON.parse((await key.read()) ?? "null") ?? { since: now, spaces: {} };
    const her = await herId(google);
    const nameOf = async (u: string) => (await emailOf(google, u)) ?? "Someone";

    const spaces: Space[] = [];
    let pageToken = "";
    for (let page = 0; page < 5; page++) {
      const r = await google.request<{ spaces?: Space[]; nextPageToken?: string }>(
        `${CHAT}/spaces?${new URLSearchParams({ pageSize: "100", ...(pageToken ? { pageToken } : {}) })}`,
      );
      spaces.push(...(r.spaces ?? []));
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }

    let answered: { to: string; client: string } | undefined;
    for (const space of spaces) {
      const from = seen.spaces[space.name] ?? seen.since;
      const active = Date.parse(space.lastActiveTime ?? "");
      if (Number.isFinite(active) && active <= from) continue;
      const { messages = [] } = await google.request<{ messages?: ChatMessage[] }>(
        `${CHAT}/${space.name}/messages?${new URLSearchParams({ filter: `createTime > "${iso(from)}"`, orderBy: "createTime asc", pageSize: "25" })}`,
      );
      const direct = space.spaceType === "DIRECT_MESSAGE";
      for (const m of messages) {
        const at = Date.parse(m.createTime ?? "");
        if (Number.isFinite(at)) seen.spaces[space.name] = Math.max(seen.spaces[space.name] ?? from, at);
        if (m.sender?.name === her || m.sender?.type === "BOT") continue;
        // In a space or a group chat, only what is said to her.
        if (!direct && !mentions(m, her)) continue;
        const email = m.sender?.name ? await emailOf(google, m.sender.name) : null;
        const client = email ? await clientOfSender(email) : null;
        if (!client) {
          log(`[chat] not answered — not one of her clients' people: ${email ?? m.sender?.name ?? "?"} in ${space.displayName || space.name}`);
          if (direct && !toldStranger.has(space.name)) {
            toldStranger.add(space.name);
            await reply(google, space, m, "Hi — I'm Ava, a meeting assistant. I can only help the people of the companies I work for, so I can't answer here.").catch(() => undefined);
          }
          continue;
        }
        if (!room(email!, now)) {
          log(`[chat] not answered — ${PER_SENDER_HOUR} answers to ${email} this hour already`);
          continue;
        }
        try {
          const conversation = await conversationOf(google, space, m, her, nameOf);
          const text = await answerMessage({ client, channel: "chat", sender: { email: email! }, conversation });
          await reply(google, space, m, text);
          answered = { to: email!, client: client.name };
          log(`[chat] answered ${email} for ${client.name} in ${direct ? "a one-to-one chat" : space.displayName || space.name}`);
        } catch (e) {
          log(`[chat] could not answer ${email}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    await key.write(JSON.stringify(seen));
    await noteStatus("chat", { state: "on", at: Date.now(), answered });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`[chat] ${detail}`);
    await noteStatus("chat", { state: "error", at: Date.now(), detail });
  } finally {
    running = false;
  }
}
