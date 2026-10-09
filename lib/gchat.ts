/**
 * Google Chat, as herself: she answers in her one-to-one chats, and in the spaces and group
 * chats she is in when somebody @mentions her — every few seconds, brought by her runner's
 * check for meetings to join (/api/ava/dispatch), in the message's thread, with the
 * sender's client's knowledge (lib/answers.ts).
 *
 * Chat says who wrote only by an id: NDI's directory — read whole, once an hour — turns it into
 * an address, and an address that is nobody she works for gets no answer — in a one-to-one
 * chat, one line saying so. A directory that cannot be read stops the look, to be retried:
 * nobody is taken for a stranger for it.
 * Only messages from after she started answering; never her own, nor another bot's.
 *
 * Somebody's first one-to-one chat with her is a message request until it is accepted in
 * Google Chat, signed in as her — no API accepts one. Till then Google shows her its messages
 * but refuses her answer, and even the chat itself (spaces.get): such a chat waits, its
 * messages kept and no answer written, looked at again once a minute and listed in the
 * control room. Once it is accepted she answers its last message.
 */
import { answerMessage, clientOfSender, noteStatus, type Said } from "./answers";
import { CHAT_SCOPES, granted, type GoogleClient } from "./google";
import { redisOrMongoKey } from "./store";

const CHAT = "https://chat.googleapis.com/v1";
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

/**
 * NDI's directory: everybody's Google id → their address, read whole — once an hour, or
 * sooner for somebody it does not know yet (a newcomer). The People API's listDirectoryPeople:
 * Chat's users/<id> is the directory's people/<id>.
 */
let directory: { at: number; byId: Map<string, string> } | null = null;
async function readDirectory(google: GoogleClient): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const r = await google.request<{
      people?: { resourceName?: string; emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[] }[];
      nextPageToken?: string;
    }>(
      `https://people.googleapis.com/v1/people:listDirectoryPeople?${new URLSearchParams({
        readMask: "emailAddresses",
        sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
        pageSize: "1000",
        ...(pageToken ? { pageToken } : {}),
      })}`,
    );
    for (const p of r.people ?? []) {
      const list = p.emailAddresses ?? [];
      const email = (list.find((e) => e.metadata?.primary) ?? list[0])?.value?.toLowerCase();
      if (p.resourceName && email) byId.set(p.resourceName.replace(/^people\//, ""), email);
    }
    if (!r.nextPageToken) break;
    pageToken = r.nextPageToken;
  }
  directory = { at: Date.now(), byId };
  return byId;
}

/** NDI's directory, read again when an hour old. Throws when it cannot be read. */
async function theDirectory(google: GoogleClient): Promise<Map<string, string>> {
  return directory && Date.now() - directory.at < 60 * 60_000 ? directory.byId : readDirectory(google);
}

/** Who wrote: their address, from NDI's directory — null for anybody outside it. */
async function emailOf(google: GoogleClient, user: string): Promise<string | null> {
  const id = user.replace(/^users\//, "");
  const known = (await theDirectory(google)).get(id);
  if (known) return known;
  // Somebody new since it was read: once more, if it is more than five minutes old.
  if (directory && Date.now() - directory.at > 5 * 60_000) return (await readDirectory(google).catch(() => directory!.byId)).get(id) ?? null;
  return null;
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

/** One-to-one chats she is in, and those still a message request: who wrote, since when, last looked at. */
const accepted = new Set<string>();
const requests = new Map<string, { from: string; since: number; checked: number }>();

/** Whether she is in a one-to-one chat — not in one Google refuses even to show her. */
async function isAccepted(google: GoogleClient, space: string): Promise<boolean> {
  if (accepted.has(space)) return true;
  const res = await fetch(`${CHAT}/${space}`, { headers: { Authorization: `Bearer ${await google.token()}` } });
  if (res.ok) {
    accepted.add(space);
    return true;
  }
  if (res.status === 403 || res.status === 404) return false;
  throw new Error(`Google Chat would not show her ${space} (${res.status})`);
}

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

/**
 * Her message, as herself. A one-to-one chat has no threads to answer in: just the message
 * (naming one there, Google refused it as not found). In a space, in the message's thread —
 * and if Google will not have that, in the space itself, with both refusals in her log.
 */
async function reply(google: GoogleClient, space: Space, m: ChatMessage, text: string, log: (m: string) => void) {
  // Google's whole answer when it refuses — its status and reasons, not just its one line.
  const post = async (body: object, query = "") => {
    const res = await fetch(`${CHAT}/${space.name}/messages${query}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await google.token()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    log(`[chat] Google refused her message (${res.status}): ${(await res.text()).replace(/\s+/g, " ").slice(0, 900)}`);
    throw new Error(`Google Chat refused her message (${res.status})`);
  };
  if (space.spaceType === "DIRECT_MESSAGE" || !m.thread?.name) {
    await post({ text });
    return;
  }
  try {
    await post({ text, thread: { name: m.thread.name } }, "?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  } catch (e) {
    log(`[chat] could not answer in the thread (${e instanceof Error ? e.message : e}) — answering in the space`);
    await post({ text });
  }
}

let running = false;

/** One look at her chats. Called every few seconds; a look still going is not doubled. */
export async function answerChats(google: GoogleClient, log: (m: string) => void = console.log): Promise<void> {
  if (running) return;
  if (process.env.AVA_ANSWER_CHAT === "off") return noteStatus("chat", { state: "off", at: Date.now() });
  if (!granted(google.current, CHAT_SCOPES)) {
    return noteStatus("chat", { state: "reconnect", at: Date.now(), detail: "Connect Ava's Google again to let her answer in Google Chat." });
  }
  running = true;
  const key = redisOrMongoKey("between:chat:seen");
  try {
    const now = Date.now();
    const seen: Seen = JSON.parse((await key.read()) || "null") ?? { since: now, spaces: {} };
    const her = await herId(google);
    // Before any message: a directory that cannot be read stops this look, nothing answered.
    await theDirectory(google);
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
      // A message request, once a minute.
      const waiting = requests.get(space.name);
      if (waiting && now - waiting.checked < 60_000) continue;
      // A chat Google errs on is tried again next look; the others go on.
      try {
        const { messages = [] } = await google.request<{ messages?: ChatMessage[] }>(
          `${CHAT}/${space.name}/messages?${new URLSearchParams({ filter: `createTime > "${iso(from)}"`, orderBy: "createTime asc", pageSize: "25" })}`,
        );
        const direct = space.spaceType === "DIRECT_MESSAGE";
        const times = messages.map((m) => Date.parse(m.createTime ?? "")).filter(Number.isFinite);
        const mark = (m: ChatMessage) => {
          const at = Date.parse(m.createTime ?? "");
          if (Number.isFinite(at)) seen.spaces[space.name] = Math.max(seen.spaces[space.name] ?? from, at);
        };
        // Theirs — never her own, nor a bot's. In a one-to-one chat she answers the last, those
        // before it being its conversation; in a space or a group chat, each said to her.
        const theirs = messages.filter((m) => m.sender?.name !== her && m.sender?.type !== "BOT");
        let held = false;
        for (const m of direct ? theirs.slice(-1) : theirs.filter((x) => mentions(x, her))) {
          const email = m.sender?.name ? await emailOf(google, m.sender.name) : null;
          const client = email ? await clientOfSender(email) : null;
          if (client && direct && !(await isAccepted(google, space.name))) {
            if (!waiting) log(`[chat] not answered yet — ${email}'s first chat with her is a message request, to accept in Google Chat as her`);
            requests.set(space.name, { from: email!, since: waiting?.since ?? (Date.parse(m.createTime ?? "") || now), checked: now });
            held = true;
            break;
          }
          mark(m);
          if (!client) {
            log(`[chat] not answered — not one of her clients' people: ${email ?? m.sender?.name ?? "?"} in ${space.displayName || space.name}`);
            if (direct && !toldStranger.has(space.name)) {
              toldStranger.add(space.name);
              await reply(google, space, m, "Hi — I'm Ava, a meeting assistant. I can only help the people of the companies I work for, so I can't answer here.", log).catch(
                (e) => log(`[chat] could not tell a stranger: ${e instanceof Error ? e.message : e}`),
              );
            }
            continue;
          }
          if (requests.delete(space.name)) log(`[chat] ${email}'s message request was accepted`);
          if (!room(email!, now)) {
            log(`[chat] not answered — ${PER_SENDER_HOUR} answers to ${email} this hour already`);
            continue;
          }
          try {
            const conversation = await conversationOf(google, space, m, her, nameOf);
            const text = await answerMessage({ client, channel: "chat", sender: { email: email! }, conversation });
            await reply(google, space, m, text, log);
            answered = { to: email!, client: client.name };
            log(`[chat] answered ${email} for ${client.name} in ${direct ? "a one-to-one chat" : space.displayName || space.name}`);
          } catch (e) {
            log(`[chat] could not answer ${email}: ${e instanceof Error ? e.message : e}`);
          }
        }
        if (!held) seen.spaces[space.name] = Math.max(from, ...times);
      } catch (e) {
        log(`[chat] ${space.displayName || space.name}: ${e instanceof Error ? e.message : e} — tried again next look`);
      }
    }
    // A request whose chat is gone waits no more.
    for (const name of requests.keys()) if (!spaces.some((s) => s.name === name)) requests.delete(name);
    await key.write(JSON.stringify(seen));
    const waitingNow = [...requests.values()].map(({ from, since }) => ({ from, since }));
    await noteStatus("chat", { state: "on", at: Date.now(), answered, ...(waitingNow.length ? { requests: waitingNow } : {}) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`[chat] ${detail}`);
    await noteStatus("chat", { state: "error", at: Date.now(), detail });
  } finally {
    running = false;
  }
}
