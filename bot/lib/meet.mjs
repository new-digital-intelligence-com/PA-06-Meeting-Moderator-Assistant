// Ava attending one meeting, in person: her own Chrome, her voice as the microphone (and
// in avatar mode her face as the camera), the meeting's own captions as her ears. What
// differs between Google Meet and Teams lives in platforms.mjs.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import * as app from "./app.mjs";
import { BRAIN, DISPLAY_NAME, FACE, MODE, RECORD, STATE_DIR, platformArgs, profileFor, requireChrome, root } from "./config.mjs";
import { DELEGATE, EFFORT, WEB, connectLive } from "./live.mjs";
import { speech } from "./voice.mjs";
import { PEOPLE, keepEvidence, platformOf } from "./platforms.mjs";
import { CHAT_ASK, detectLanguage, langOf, possessive } from "./language.mjs";

/** The heartbeat. Somebody pausing cuts it short — see `wake`. */
const TICK_MS = 1200;
/** How long she stays once everybody else has left: a minute, for a dropped connection. */
const ALONE_MS = 60_000;
/**
 * Nobody has said anything for this long: her GPT-Live session — billed every second it is
 * open, silence included — is closed, and opened again the moment somebody speaks.
 */
const HUSH_MS = Number(process.env.AVA_HUSH_SECONDS || 180) * 1000;
/**
 * Nobody has said anything for this long: she leaves. Whatever is still in the call is not
 * a conversation — a notetaker bot she did not recognise kept her in an empty meeting for
 * over an hour, one-on-one with Fireflies.
 */
const SILENT_LEAVE_MS = Number(process.env.AVA_SILENT_LEAVE_MINUTES || 10) * 60_000;
/** How long after the start time she waits for anybody to turn up. */
const NOBODY_MS = 5 * 60_000;
/**
 * In a group she speaks only in a conversation somebody drew her into by saying her name: it
 * is open for this long after the name ("Ava, about the pilot… what did we agree?"), and —
 * as with a person — after each answer of hers until FOLLOW_UP_MS after her last words, so
 * follow-ups need no name. Then she waits for her name again. What GPT-Live says outside a
 * conversation is never played. (Counted from the name alone, a follow-up after a long
 * answer came too late and went unanswered.)
 */
const NAME_WINDOW_MS = 30_000;
const FOLLOW_UP_MS = 30_000;
/** Her name as people say it and as captions and transcripts write it. */
const NAMES = [...new Set([DISPLAY_NAME.toLowerCase(), "ava", "eva", "ewa", "éva", "إيفا", "ايفا", "آفا", "أفا"])];
const NAME_RE = new RegExp(
  `(?:^|[^\\p{L}])(?:${NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[^\\p{L}])`,
  "giu",
);
/** How many times her name is in a piece of text. */
const namesIn = (text) => (String(text ?? "").match(NAME_RE) ?? []).length;
/** Somebody stopped talking for this long: what they said is looked up in the client's documents. */
const LOOKAHEAD_PAUSE_MS = 350;
/** The most tiles left in the call that "only silent strangers are left" is judged on. */
const SILENT_OTHERS_MAX = 2;

/**
 * Which of the tiles in `others` (each as its lines) belong to somebody who has spoken. The
 * captions name a speaker as the tile does; matched loosely, both ways ("Ricardo" and
 * "Ricardo Silva (Host)"), so that a tile is taken for a speaker's whenever it might be —
 * missing one would have her leave people in the middle of a meeting.
 */
function spokeHere(others, speakers) {
  const names = [...speakers].map((s) => s.trim().toLowerCase()).filter(Boolean);
  const same = (line, name) => line === name || (name.length >= 3 && line.includes(name)) || (line.length >= 3 && name.includes(line));
  return others.filter((lines) => lines.some((l) => names.some((n) => same(l.toLowerCase(), n))));
}

/** The name on a tile: its longest line that is not one of Meet's icon names ("mic_off"). */
const tileName = (lines) => [...lines].filter((l) => !l.includes("_")).sort((a, b) => b.length - a.length)[0] ?? lines[0] ?? "?";
/** The same, when the page cannot tell whether she is alone: never longer than this. */
const NOBODY_CAP_MS = 15 * 60_000;
/** Checks in a row (about 2.5 s) that find her alone before her face is put to rest. */
const ALONE_CHECKS = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LANGUAGE_NAME = { en: "English", de: "German", ar: "Arabic" };
/** Notetaker bots: what they "say" is not somebody in the room. */
const BOT = new RegExp(PEOPLE.bots, "i");

/**
 * Whose assistant she is in this meeting: the client's in a client's meeting — there she
 * is theirs, and NDI is not hers to mention — NDI's in NDI's own.
 */
const ownerOf = (meeting) => meeting.client?.name?.trim() || "NDI";

/**
 * What GPT-Live is told at the start of a session: who she is, the briefing, and the
 * policies OpenAI's Live prompting guide asks for — backchannels, interruptions, and
 * what to hand over to Claude.
 */
function liveInstructions(meeting, lang, product, emailed) {
  const language = LANGUAGE_NAME[lang];
  const owner = ownerOf(meeting);
  return [
    "# Role",
    `You are ${DISPLAY_NAME}, ${possessive(owner)} meeting assistant, taking part in a live ${product} meeting as one of the participants — a colleague on the call, not a phone agent. You hear the meeting's sound; several people may be in it, and silent notes like "[Helmi is speaking]" tell you who is talking. You are taking notes${emailed ? ": after the meeting a summary with the actions is emailed to the participants" : ""}.`,
    ...(owner === "NDI"
      ? []
      : [`Here you are ${possessive(owner)} own assistant: whenever you say who you are, you are ${possessive(owner)} meeting assistant. Never mention NDI.`]),
    "",
    "# This meeting",
    `Title: ${meeting.title || "Meeting"}`,
    "What you were told beforehand:",
    (meeting.context?.trim() || "(nothing — you were given no briefing)").slice(0, 30_000),
    "",
    "# Personality and speech",
    "Warm, calm and to the point. Plain spoken language, usually one to three short sentences; no lists, no reading out of links. Use people's names when you answer them. Lead with the useful bit — no 'great question'.",
    "",
    "# Language",
    `Speak ${language}${lang === "ar" ? " — clear Modern Standard Arabic, following the register people use with you" : ""}. If somebody speaks to you in English, German or Arabic, answer in that language.`,
    "People speaking Arabic may use a dialect — Tunisian, Maghrebi, Egyptian, Levantine — and mix in French or English words. Understand it as it is, and answer in clear Modern Standard Arabic.",
    "",
    "# When to speak",
    "- One-on-one (you and one other person): everything they say is said to you. Talk with them naturally — answer, react, engage with what they bring up.",
    `- A group: speak when somebody says your name (${DISPLAY_NAME}; it may sound like Eva) to you. From then on you are in a conversation with them: answer their follow-up questions without waiting for your name again, for as long as the exchange goes on — until about 30 seconds after your last answer with nobody talking to you. Then stay silent until somebody says your name again. Outside such a conversation: not for a question put to the room, not to greet somebody who joins, not to agree or react — keep listening while people talk to each other. Anything you say in a group outside a conversation you were drawn into is not heard by anybody.`,
    "- You will be told when the meeting changes between one-on-one and a group.",
    "- Greet people once. Confirm an instruction once, then act on it. If they give you a role — interviewer, facilitator, timekeeper — play it fully, keep track of where it stands, and move it on yourself.",
    "",
    "# Backchannel policy",
    "One-on-one, an occasional short 'mm-hm' or 'right' while they talk is fine.",
    "In a group, make no listening sounds and no acknowledgements at all — no 'mm-hm', 'hmm', 'okay', 'yeah', 'right' — and never speak while somebody else is speaking. In a group your only words are real answers, when you are addressed.",
    "",
    "# Interruption policy",
    "The moment somebody else starts talking while you speak, stop — mid-sentence if need be — and listen. Do not finish your sentence first, and do not repeat it afterwards unless they ask; respond to what they said.",
    "",
    "# Delegation policy",
    `Backend tools: your backend has the full transcript of this meeting, the actions noted so far, your working notes${meeting.client ? ", the client's documents" : ""}${WEB ? " and the web" : ""}. It is slow — many seconds — so use it only when you must.`,
    "Speed matters more than anything: people wait for you in a live meeting. Begin your answer within a second or two; never make them wait for something you already know.",
    "Delegate to the backend only when:",
    "- somebody asks for a full recap of this meeting, or the full list of its actions so far (what was said in the last few minutes you heard yourself: answer it at once);",
    "- somebody asks you to note down or remember an action, a decision or a task — say 'Noted' at once, with their name, and hand it over: do not wait for it;",
    `- the answer needs facts about this company, these people or this project that are not in what you were told above${meeting.client ? " or in passages from their documents in your notes" : ""};`,
    ...(WEB ? ["- somebody asks about something current — news, prices, weather, a recent release;"] : []),
    "- a calculation with several numbers.",
    "Do not delegate to the backend when:",
    "- the answer is in what you were told beforehand — your brief, its Last time, the same meeting's last times, Who's who, what you know about the client, the invite: you know it. Answer from it at once. Never hand over a recap of your briefing, of the agenda, or of an earlier meeting you were told about;",
    "- somebody asks for your view, an opinion, advice, an explanation, a comparison or general knowledge — answer it yourself, right away, in one to three sentences, as a knowledgeable colleague would;",
    "- somebody greets you, thanks you, or asks you to repeat or clarify what you just said;",
    ...(meeting.client
      ? [`- passages from ${meeting.client.name}'s documents in your notes ("[From ${meeting.client.name}'s documents …]", looked up as they finished asking) already answer it — answer from them at once.`]
      : []),
    "Never say 'one moment', 'just a moment', 'one second', 'hold on', 'wait', 'let me check', 'let me see' or 'let me look' — they only make people wait. When you hand something over, first say in one sentence what you already know about it, if anything; otherwise stay quiet until the answer comes, then give it at once. Never guess what the backend will find. If somebody asks again before it comes back, say briefly what you know.",
    "",
    "# Facts",
    "Facts about this company, these people or this project come only from what you were told, what was said, or your backend; otherwise say you don't know. Never invent a decision, a commitment or a deadline.",
  ].join("\n");
}

/**
 * What GPT-Live's OpenAI backend is told: it answers what she hands over, and the meeting
 * itself it reads with our tools rather than guessing.
 */
function backendInstructions(meeting, lang) {
  const client = meeting.client?.name;
  return [
    `You are the backend of ${DISPLAY_NAME}, ${possessive(ownerOf(meeting))} meeting assistant, who is taking part in a live meeting by voice${client ? ` for ${client}` : ""}. Her voice model hands you what needs thought, the meeting's record${client ? `, ${client}'s documents` : ""}${WEB ? " or the web" : ""}; your answer is spoken aloud by her, in her own words.`,
    "",
    `Meeting: ${meeting.title || "Meeting"}`,
    "What she was told beforehand:",
    (meeting.context?.trim() || "(nothing — no briefing)").slice(0, 30_000),
    "",
    "How to answer — quickly: people are waiting in a live meeting, so use as few tools as you can.",
    "- A question of opinion, advice, explanation or general knowledge: answer it from your own knowledge at once, with no tools.",
    "- Anything about this meeting — what was said, agreed or decided, a recap, the actions so far, who said what — call meeting_record first and answer only from it. Never invent a decision, a commitment or a deadline.",
    "- Asked to note down an action, a decision or a task: call note_action, then confirm in a few words.",
    ...(client
      ? [`- Facts about ${client} — their products, prices, people, projects, policies, numbers — that the briefing does not settle: call search_knowledge first, with a short query in the language of their documents, and answer from what it finds. If it finds nothing that answers it, say you don't have that.`]
      : []),
    `- Current facts — news, prices, a recent release: ${WEB ? "search the web, once" : "you cannot look them up, so say so"}. Facts about this company, these people or this project come only from the briefing${client ? ", their documents" : ""} and the record; if they are not there, say so.`,
    `- Answer in ${LANGUAGE_NAME[lang]} unless the request is in another language, then in that one.`,
    "- Short and speakable: the answer itself in one to three sentences. No lists, no markdown, no links; say numbers the way they are spoken.",
    ...(client ? [`- Here she is ${possessive(client)} own meeting assistant: never mention NDI.`] : []),
  ].join("\n");
}

/** Her backend's tools: the meeting as the app has it, and noting an action. */
const BACKEND_TOOLS = [
  {
    type: "function",
    name: "meeting_record",
    description: "The meeting so far: the transcript from live captions (speaker names included), the actions noted and her working notes.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "note_action",
    description: "Write down an action, a decision or a task somebody asked her to note. It goes into the meeting notes.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The action, phrased as a task." },
        owner: { type: "string", description: "Who owns it, if named." },
        due: { type: "string", description: "Plain-language due date, if given." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

/** For a client's meeting: their documents, searched by meaning. Which client is the app's call, not the model's. */
const SEARCH_TOOL = {
  type: "function",
  name: "search_knowledge",
  description: "Search the documents the client gave her — their company, products, prices, people, projects — for passages about something. Returns the closest passages with the document each comes from.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for, in a few words." } },
    required: ["query"],
    additionalProperties: false,
  },
};

/** Whether a piece of her voice has any sound in it — Live may stream silence between turns. */
function voiced(b64) {
  const buf = Buffer.from(b64, "base64");
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    // About -32 dBFS: speech is well above it; the near-silence Live streams between turns
    // is not — counting that kept one "reply" open for a whole call.
    if (s > 800 || s < -800) return true;
  }
  return false;
}

/**
 * A few seconds of her face at rest, filmed from the live avatar the first time, and
 * shown whenever the live face is not connected. Kept per avatar, and this avatar's is
 * used when there is one; otherwise the newest kept — when Anam cannot be reached at all
 * the avatar is not even known, and a black tile is what the room saw instead.
 */
const idleClipFile = (avatarId) => path.join(STATE_DIR, `idle-${String(avatarId).replace(/[^\w-]/g, "")}.json`);
function readIdleClip(avatarId) {
  const files = avatarId ? [idleClipFile(avatarId)] : [];
  try {
    files.push(
      ...fs
        .readdirSync(STATE_DIR)
        .filter((f) => /^idle-.+\.json$/.test(f))
        .map((f) => path.join(STATE_DIR, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs),
    );
  } catch {
    /* no state folder yet */
  }
  for (const file of files) {
    try {
      const frames = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(frames) && frames.length) return frames;
    } catch {
      /* missing or unreadable: try the next */
    }
  }
  return undefined;
}

/**
 * Attends one meeting from start to finish, then writes and sends the notes.
 *
 * @param {{ meetingUrl: string, title?: string, context?: string, recipients?: string[], startsAt?: number, client?: { id: string, name: string, meetingId: string } | null }} meeting
 *   `startsAt`: when the meeting is due to start — she may be early, and waits for people from then.
 *   `client`: the client she attends for — their documents become searchable to her.
 * @param {{ log?: (m: string) => void, briefed?: boolean, seat?: number }} options `briefed`: sent from the
 *   client's page, whose briefing is already on the server and must not be overwritten.
 *   `seat`: which of her seats — its own Chrome profile, and its own meeting on the site.
 */
export async function attend(meeting, { log = console.log, briefed = false, seat = 1 } = {}) {
  // Everything this meeting tells the site is about this seat, and this meeting in it.
  const api = app.seat(seat);
  const platform = platformOf(meeting.meetingUrl);
  if (!platform) throw new Error(`Not a Google Meet or Teams link: ${meeting.meetingUrl}`);
  // English, German or Arabic: her captions, her voice, what she types in the chat.
  // With GPT-Live it follows what people actually speak, from what she hears (below).
  let lang = langOf(meeting.language);
  // Nobody's email shows in Teams, or in Meet: with no invite guests or addresses from the
  // site, she asks in the meeting chat — otherwise the notes go to nobody.
  // Only meetings she is invited to on her calendar have their notes emailed — to the
  // invite's guests. Those she is sent to from a client's page are not: their notes are filed
  // there. An invite with nobody on it but her, she asks in the chat instead.
  // And none whose call has Fireflies in it: it sends everybody its own notes (the site files
  // hers without emailing them), so she neither promises a summary nor asks for addresses.
  let firefliesHere = false;
  const emailsNotes = () => !briefed && !firefliesHere;
  const askForEmails = () => emailsNotes() && !meeting.recipients?.length;

  // 1 — brief her, and tell the server this is a real meeting she is attending in person.
  // A calendar meeting is new in this seat; one a page sent her to is already there.
  if (briefed) api.meetingId = meeting.id ?? null;
  else {
    await api.start({
      title: meeting.title || "Meeting",
      meetingUrl: meeting.meetingUrl,
      context: meeting.context || "",
      recipients: meeting.recipients || [],
      joinAt: null,
      language: lang,
      // Whose meeting: whose documents she searches, and where her notes are filed.
      client: meeting.client ?? null,
    });
  }
  await api.attend(briefed ? "dispatch" : "calendar");
  log(`  ${briefed ? "sent from a client's page" : "briefed"}: ${meeting.title || meeting.meetingUrl} (${platform.name}, ${lang})`);

  // Her face for this meeting, asked for before her browser opens: with every Anam account
  // out of minutes she joins as in voice mode — camera off, the meeting showing her profile
  // photo — and her voice works as always. Anam failing for another reason: she joins with
  // her camera, and the face keeps trying (her page gives up after three tries in a row).
  let mode = MODE;
  let firstFace = null;
  if (MODE === "avatar") {
    try {
      firstFace = await app.anamSession();
    } catch (e) {
      if (e.message === app.NO_FACE) {
        mode = "voice";
        log("  no Anam account has minutes left — she joins with her voice only, camera off");
      } else {
        log(`  no face to start with (${e.message}) — she will speak without it until it connects`);
      }
    }
  }

  // 2 — her browser.
  const context = await chromium.launchPersistentContext(profileFor(seat), {
    executablePath: requireChrome(),
    // Visible, not headless: Meet degrades headless browsers, and Google is far more
    // willing to keep a real-looking Chrome signed in.
    headless: false,
    // Her face connects to Anam from inside Meet's page, which Meet's content security
    // policy would otherwise block.
    bypassCSP: true,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--disable-blink-features=AutomationControlled",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      // A window that is minimised or covered would otherwise have its timers and
      // rendering throttled — and her face would freeze mid-sentence.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--no-default-browser-check",
      ...platformArgs(),
    ],
  });
  for (const origin of platform.origins) await context.grantPermissions(["camera", "microphone"], { origin });

  // 3 — her ears. Her own words come back as captions too ("You" in Meet, her name in
  // Teams): never an input.
  const heard = [];
  let heardCount = 0;
  let lastHeardAt = null;
  let speaking = false;
  let wake = () => {};
  /** Words heard so far in each caption block, to tell new speech from Meet tidying up. */
  const wordsIn = new Map();
  /** New words heard in total — what counts as somebody talking. */
  let wordsHeard = 0;
  let wordsWhenSheStarted = 0;
  let pauseTimer = null;
  /** How many people are in the call, her included — two means everything is said to her. */
  let people = null;
  let warmedAt = 0;
  /**
   * Her voice session and face are closed because nobody else is here. Rule: neither is
   * open while she is the only one in the meeting — bots do not count.
   */
  let resting = false;
  /** Her GPT-Live session is closed because nobody has said anything for a while. */
  let hushed = false;
  /**
   * The names on the tiles and in the captions agree in this meeting: a tile has been
   * matched to somebody who spoke. Until then, who has spoken says nothing about who is left.
   */
  let namesAgree = false;

  // GPT-Live (AVA_BRAIN=live): OpenAI's model hears the meeting and holds the conversation.
  const live = BRAIN === "live";
  let rt = null;
  /** "one-on-one" or "group", as last told to her. */
  let rtRoom = null;
  let rtExpiresAt = 0;
  let rtChain = Promise.resolve();
  let rtGreeted = false;
  let rtFailures = 0;
  /** No key, or it keeps failing: she stays quiet rather than retry all meeting. */
  let rtGaveUp = false;
  let rtLastSpeaker = "";
  /** Her voice: the reply being played, and when it last had sound in it. */
  let rtTurn = 0;
  let rtInTurn = false;
  let rtVoicedAt = 0;
  /** When GPT-Live last heard somebody (its own transcript): speech even if captions fail. */
  let rtHeardAt = 0;
  let rtTurnEnd = null;
  /** What the room said, as she heard it — for what she hands over to Claude. */
  let rtHeard = "";
  /** How much she has heard in all, and at what point the language was last checked. */
  let rtHeardTotal = 0;
  let langCheckedAt = 0;
  let langVote = { lang: null, n: 0 };
  let langSwitchedAt = 0;
  /** Her lines as GPT-Live transcribes them — reported to the app one per heartbeat. */
  const said = [];
  /** When somebody last said her name — in the captions or in what GPT-Live heard. */
  let nameAt = 0;
  /** Her name seen so far in each caption block (Meet rewrites a block as it goes): only a new one counts. */
  const namesSeen = new Map();
  /** Until when she may speak in a group without being named: her hello, an answer she is fetching. */
  let openUntil = 0;
  /**
   * The rest of a reply being thrown away, up to its first pause, and why: "talked over"
   * (somebody cut in — her page stopped her) or "unnamed" (a group, and nobody said her name).
   */
  let rtDrop = null;
  let rtDropAt = 0;
  /** When replies nobody named her for were kept quiet: their lines are not hers in the notes. */
  const quietSpans = [];
  let quietToldAt = 0;
  /** When she was last told, as a silent note, that somebody had just said her name. */
  let namedToldAt = 0;
  /** The conversation by caption block, to brief a new session after a reconnect. */
  const recent = new Map();
  /** Who has spoken lately, from the captions: two voices make a group. */
  const voices = new Map();

  /** One-on-one or a group: two people in the call and one voice lately, or more. */
  const roomNow = () => {
    const since = Date.now() - 10 * 60_000;
    const lately = [...voices.values()].filter((at) => at >= since).length;
    return (people ?? 2) <= 2 && lately <= 1 ? "one-on-one" : "group";
  };
  /** In a group: a conversation she was drawn into by her name is still going on. */
  const inConversation = () => Date.now() - nameAt <= NAME_WINDOW_MS || Date.now() < openUntil;
  /**
   * Somebody said her name: the conversation opens, and GPT-Live is told at once — a silent
   * note, so it answers as soon as they finish instead of weighing whether it was meant.
   */
  const heardName = (by) => {
    nameAt = Date.now();
    if (rt && roomNow() === "group" && Date.now() - namedToldAt > 8000) {
      namedToldAt = Date.now();
      rt.think(`[${by ? `${by} just said your name` : "Somebody just said your name"} — they are talking to you: answer as soon as they finish.]`);
    }
  };

  await context.exposeBinding("__avaLog", (_src, m) => log(`  [meet] ${m}`));
  await context.exposeBinding("__avaHeard", (_src, speaker, text, blockId) => {
    // A notetaker's captions are nobody talking: they must not bring her in, or her face.
    if (!text || platform.isSelf(speaker) || BOT.test(speaker)) return;
    heardCount++;
    lastHeardAt = Date.now();
    // Meet rewrites a caption as the sentence goes on. Only the latest version of each
    // caption block is worth sending; the server replaces the line in place by this id.
    const id = blockId || `m${heardCount}`;
    const line = { id, speaker, text, at: Date.now() };
    const i = heard.findIndex((h) => h.id === id);
    if (i >= 0) heard[i] = line;
    else heard.push(line);

    const words = text.trim().split(/\s+/).length;
    wordsHeard += Math.max(0, words - (wordsIn.get(id) ?? 0));
    wordsIn.set(id, Math.max(words, wordsIn.get(id) ?? 0));

    voices.set(speaker, Date.now());
    // Her name, said to her: in a group, what lets her speak.
    const named = namesIn(text);
    if (named > (namesSeen.get(id) ?? 0)) heardName(speaker);
    namesSeen.set(id, Math.max(named, namesSeen.get(id) ?? 0));
    if (namesSeen.size > 300) namesSeen.delete(namesSeen.keys().next().value);
    if (live) {
      recent.set(id, `${speaker}: ${text}`);
      if (recent.size > 80) recent.delete(recent.keys().next().value);
      // Somebody spoke while her voice session was closed for the silence: open it again,
      // with what they are saying in its recap.
      if (hushed && !resting && !over) {
        hushed = false;
        log("  somebody spoke — GPT-Live back");
        startLive(true);
      }
      // Sound carries no names; the captions do.
      if (rt && speaker !== rtLastSpeaker) {
        rtLastSpeaker = speaker;
        rt.think(`[${speaker} is speaking]`);
      }
    }

    // Somebody talked over her: stop, like a person would. Not for Meet correcting a
    // caption from a moment ago, which used to cut her off at her first word. (GPT-Live
    // hears interruptions for itself.)
    if (!live && speaking && wordsHeard - wordsWhenSheStarted >= 3) {
      void page.evaluate(() => window.__ava?.interrupt()).catch(() => {});
      speaking = false;
    }
    // A pause is the end of their turn: take it the moment it happens, not on the next
    // heartbeat.
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => wake(), 1100);

    // One-on-one, she answers everything — so have her face connecting while they are
    // still talking, and it is there by the time she replies.
    if (mode === "avatar" && !resting && (people === null || people <= 2) && Date.now() - warmedAt > 3000) {
      warmedAt = Date.now();
      void page.evaluate(() => window.__ava?.warm()).catch(() => {});
    }
  });

  // Her face asks for a new session each time it connects: after resting, and ahead of
  // Anam's time limit.
  let avatarId = null;
  await context.exposeBinding("__avaAnamToken", async () => {
    const s = await app.anamSession();
    avatarId = s.avatarId;
    return s.sessionToken;
  });
  // Anam refused her face for being out of minutes: the next account takes over, if any.
  await context.exposeBinding("__avaAnamUsedUp", () => {
    const next = app.anamUsedUp();
    log(next ? `  that Anam account is out of minutes — her face moves to account ${next}` : "  every Anam account is out of minutes — she carries on with her voice");
    return next;
  });
  // The meeting's sound, from her page, straight on to OpenAI — only with somebody there.
  await context.exposeBinding("__avaHear", (_src, b64) => {
    if (rt && !alone) rt.appendAudio(b64);
  });
  // Somebody talked over her: her page has stopped her voice and her lips; what is still
  // arriving of that reply is thrown away too.
  await context.exposeBinding("__avaCut", () => {
    rtDrop = "talked over";
    rtDropAt = Date.now();
  });
  // No Anam account can give her a face any more in this meeting: her camera goes off, so
  // the room sees her profile photo rather than a face whose lips never move. Her voice is
  // unchanged.
  await context.exposeBinding("__avaFaceGone", async (_src, why) => {
    log(`  no face for this meeting: ${why}`);
    if (platform.cameraOff) await platform.cameraOff(page, log).catch((e) => log(`  could not turn her camera off: ${e.message}`));
  });
  await context.exposeBinding("__avaIdleClip", (_src, frames) => {
    if (!avatarId || !Array.isArray(frames)) return;
    try {
      fs.writeFileSync(idleClipFile(avatarId), JSON.stringify(frames));
      log("  kept her idle clip for next time");
    } catch (e) {
      log(`  could not keep her idle clip: ${e.message}`);
    }
  });
  if (RECORD) {
    // A test call's recording of her voice (inject/record.ts), in pieces, made a WAV at the end.
    const dir = path.join(STATE_DIR, "recordings");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await context.exposeBinding("__avaRecording", (_src, kind, part, base64, last, rate) => {
      fs.mkdirSync(dir, { recursive: true });
      const pcmFile = path.join(dir, `${stamp}-${kind}.pcm`);
      if (part === 0) fs.writeFileSync(pcmFile, Buffer.alloc(0));
      fs.appendFileSync(pcmFile, Buffer.from(base64, "base64"));
      if (!last) return;
      const data = fs.readFileSync(pcmFile);
      const head = Buffer.alloc(44);
      head.write("RIFF", 0);
      head.writeUInt32LE(36 + data.length, 4);
      head.write("WAVEfmt ", 8);
      head.writeUInt32LE(16, 16);
      head.writeUInt16LE(1, 20);
      head.writeUInt16LE(1, 22);
      head.writeUInt32LE(rate, 24);
      head.writeUInt32LE(rate * 2, 28);
      head.writeUInt16LE(2, 32);
      head.writeUInt16LE(16, 34);
      head.write("data", 36);
      head.writeUInt32LE(data.length, 40);
      const wav = pcmFile.replace(/\.pcm$/, ".wav");
      fs.writeFileSync(wav, Buffer.concat([head, data]));
      fs.rmSync(pcmFile, { force: true });
      log(`  recording kept: recordings/${path.basename(wav)}`);
    });
  }
  await context.addInitScript({
    content: `window.__AVA_MODE = ${JSON.stringify(mode)}; window.__AVA_FACE = ${JSON.stringify({ ...FACE, name: DISPLAY_NAME, pcmRate: BRAIN === "live" ? FACE.pcmRate : 16000, record: RECORD })};`,
  });
  await context.addInitScript({ path: path.join(root, "dist", "ava.js") });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(platform.url(meeting.meetingUrl), { waitUntil: "domcontentloaded" });

  // 4 — her voice (and face, in avatar mode). Meet is already asking for devices; it
  // waits until these are up.
  let startWith = {};
  if (mode === "avatar") {
    if (firstFace) avatarId = firstFace.avatarId;
    // The face connects when somebody else is there: minutes spent on an empty room are
    // minutes billed for nothing.
    startWith = { token: firstFace?.sessionToken, idleClip: readIdleClip(firstFace?.avatarId), faceLater: true };
  }
  // Started on whichever page she is on, and again if it navigates: Teams' launcher loads
  // a new page, whose fresh copy of her script would otherwise leave Teams waiting for a
  // microphone that never comes.
  let announcedVoice = false;
  const ensureStarted = async () => {
    const started = await page.evaluate(() => Boolean(window.__ava?.started?.())).catch(() => true);
    if (started) return;
    await page.evaluate((o) => window.__ava?.start(o), startWith).catch(() => {});
    // The first Anam token is used up by the first start; later ones fetch their own.
    startWith = { ...startWith, token: undefined };
    if (!announcedVoice) {
      announcedVoice = true;
      log(mode === "avatar" ? "  her voice is up, and her face" : "  her voice is up (voice mode, no camera)");
    }
  };
  // Meet asks for devices on the first page. Teams only on its pre-join page, and starting
  // her on the launcher before that would spend a face session on a page about to vanish.
  if (platform.id === "meet") await ensureStarted();

  // 5 — walk in.
  try {
    await platform.join(page, log, mode, { ready: ensureStarted });
  } catch (e) {
    await page.evaluate(() => window.__ava?.end?.()).catch(() => {});
    await context.close().catch(() => {});
    // Nobody let her in, or the page was not what we expected: close the meeting so the
    // site does not show her as in it.
    await api.stop().catch(() => {});
    throw e;
  }
  await platform.captionsOn(page, log);
  if (lang !== "en") await platform.setLanguage(page, log, lang).catch((e) => log(`  could not change the caption language: ${e.message}`));
  // Meet's own voice processing (Studio sound, Adaptive audio) off: it is on again in
  // every new meeting, and it gave her synthetic voice an echo.
  if (platform.cleanAudio) await platform.cleanAudio(page, log);
  log("  in the meeting");

  // 6 — the conversation.
  let pending = null;
  /** A reply she held back because somebody carried on talking; the server re-queues it. */
  let dropped = null;
  let aloneSince = null;
  /** Whether anybody else has been in the call — until then, being alone is just early. */
  let sawOthers = false;
  /** When somebody else was first there: silence is counted from then at the earliest. */
  let sawOthersAt = 0;
  /** Nobody else ever arrived: there is nothing to write up. */
  let nobodyCame = false;
  /** Email addresses typed in the meeting chat — every one seen, and those not yet sent on. */
  const chatEmails = new Set();
  const newEmails = [];
  const seenBots = new Set();
  /** Whether she is the only one in the call right now, and for how many checks in a row. */
  let alone = false;
  let aloneChecks = 0;
  /** Checks in a row that found somebody else — two before anything reopens. */
  let presentChecks = 0;
  /** Checks in a row that found no hang-up button: one alone is Teams hiding its toolbar. */
  let outOfCall = 0;
  const inCallAt = Date.now();
  let snapshotTaken = false;
  /** Teams: since when nobody but her has been on screen, and whether the page was kept then. */
  let emptySince = null;
  let emptySnapshot = false;
  let over = false;
  let lastReason = null;
  let faceState = mode === "avatar" ? "down" : "voice";
  /** Ended from the site, which then writes and sends the notes itself. */
  let endedElsewhere = false;
  /** Why she left, for the meeting's history. */
  let leftBecause = null;

  const finish = async (why) => {
    if (over) return;
    over = true;
    leftBecause = why;
    log(`  leaving: ${why}`);
    rt?.close();
    rt = null;
  };

  const tellRoom = () => {
    const room = roomNow();
    if (!rt || room === rtRoom) return;
    rtRoom = room;
    rt.instruct(
      room === "one-on-one"
        ? "The meeting is now one-on-one: just you and one other person. Everything they say is said to you — talk with them naturally."
        : `The meeting is now a group${people ? ` of ${people - 1} people besides you` : ""}. Speak when somebody says your name (${DISPLAY_NAME}, or Eva) to you, and then to their follow-ups while that exchange goes on, without waiting for your name again; once about 30 seconds pass after your last answer with nobody talking to you, wait for your name again. Otherwise stay silent — no greetings, listening sounds or acknowledgements ('mm-hm', 'okay', 'yeah', 'right').`,
    );
    log(room === "one-on-one" ? "  one-on-one: she talks with them" : "  a group: she answers when asked");
  };

  /** Whether she may begin a reply now: one-on-one always; in a group only in a conversation. */
  const mayAnswer = () => roomNow() !== "group" || inConversation();

  /**
   * Her voice, as GPT-Live makes it: played at once, the silence between turns skipped. In a
   * group a reply outside a conversation she was drawn into is not played at all — GPT-Live
   * still said "mm-hm", "right" and "hi" to a room that never asked — and a reply somebody
   * talked over is dropped from where her page stopped it. Either way up to its first pause.
   */
  const playLive = (b64) => {
    const now = Date.now();
    const sound = voiced(b64);
    if (rtDrop) {
      if (now - rtDropAt < 700) {
        if (sound) {
          rtDropAt = now;
          if (rtDrop === "unnamed" && quietSpans.length) quietSpans[quietSpans.length - 1].to = now;
        }
        return;
      }
      // A pause: what comes next is a new reply.
      rtDrop = null;
      rtInTurn = false;
    }
    if (!sound && (!rtInTurn || now - rtVoicedAt > 700)) return;
    if (sound) rtVoicedAt = now;
    if (!rtInTurn) {
      if (!mayAnswer()) {
        rtDrop = "unnamed";
        rtDropAt = now;
        quietSpans.push({ from: now, to: now });
        if (quietSpans.length > 20) quietSpans.shift();
        // Once a minute at most, she learns that it went unheard, and why.
        if (rt && now - quietToldAt > 60_000) {
          quietToldAt = now;
          rt.think("[Nobody heard that: in this group you speak only when somebody says your name. Stay silent until they do.]");
        }
        return;
      }
      rtInTurn = true;
      rtTurn++;
      // Her face, for what she is about to say (it connects in about a second and a half).
      if (mode === "avatar") void page.evaluate(() => window.__ava?.warm()).catch(() => {});
    }
    // She is answering: follow-ups need no name until FOLLOW_UP_MS after her last words.
    if (sound) openUntil = Math.max(openUntil, now + FOLLOW_UP_MS);
    const turn = `t${rtTurn}`;
    rtChain = rtChain.then(() => page.evaluate(([a, t]) => window.__ava?.feed(a, t), [b64, turn])).catch(() => {});
    clearTimeout(rtTurnEnd);
    rtTurnEnd = setTimeout(() => {
      rtInTurn = false;
      rtChain = rtChain.then(() => page.evaluate(() => window.__ava?.feedDone())).catch(() => {});
    }, 800);
  };

  /**
   * The client's documents, looked up the moment somebody stops asking — not only once she
   * has handed it over, seconds later: what answers it is in her notes before she replies,
   * so she can answer at once (OpenAI's "speculative lookup"). In a group only when she was
   * named; one-on-one whatever is said to her. Only passages close to it are passed on.
   */
  let askText = "";
  let askTimer = null;
  let lookedUpAt = 0;
  let lookedUp = "";
  const lookUp = async () => {
    // What they have been saying — the last two or three sentences heard — not only the last
    // fragment: "…flow itself as a" alone found nothing, and she handed the question over.
    const said = askText;
    askText = "";
    const query = rtHeard
      .slice(-320)
      .replace(NAME_RE, " ")
      .replace(/\s+/g, " ")
      .replace(/^\S*\s/, "")
      .replace(/^[\s,.;:!?،]+/, "")
      .trim();
    if (!rt || over || said.trim().split(/\s+/).length < 2 || query.split(" ").length < 4 || query === lookedUp) return;
    if (roomNow() === "group" && !inConversation()) return;
    if (Date.now() - lookedUpAt < 2500) return;
    lookedUpAt = Date.now();
    lookedUp = query;
    try {
      const { results, found, best } = await api.knowledgeAhead(query);
      const took = ((Date.now() - lookedUpAt) / 1000).toFixed(1);
      const score = Number(best ?? 0).toFixed(2);
      if (!found) {
        log(`  looked ahead in their documents: nothing close (best ${score}, ${took} s) for "…${query.slice(-60)}"`);
        return;
      }
      // GPT-Live takes at most 500 tokens a note ("Context append text must not exceed 500
      // tokens" refused the whole look-up in a call, so she handed the question over and
      // was 30 s answering): the passages go in pieces of 1,000 characters — under 500
      // tokens in any of her languages — four at most, the closest first.
      const pieces = (String(results).match(/[\s\S]{1,1000}/g) ?? []).slice(0, 4);
      pieces.forEach((piece, i) =>
        rt?.think(
          i === 0
            ? `[From ${meeting.client.name}'s documents and earlier meetings, about what was just said — if this answers it, answer from it now, in your own words, without handing it over:]\n${piece}`
            : `[…continued:]\n${piece}`,
        ),
      );
      log(`  looked ahead in their documents: ${found} passage${found === 1 ? "" : "s"} (best ${score}, ${took} s) for "…${query.slice(-60)}"`);
    } catch (e) {
      log(`  looking ahead in their documents failed: ${e.message}`);
    }
  };
  const lookAhead = (piece) => {
    if (!meeting.client) return;
    askText = (askText + piece).slice(-600);
    clearTimeout(askTimer);
    askTimer = setTimeout(() => void lookUp(), LOOKAHEAD_PAUSE_MS);
  };

  /** GPT-Live handed something over: Claude answers from the whole meeting. */
  const answerDelegation = async (id) => {
    const asked = rtHeard.slice(-1500);
    log(`  she asks her memory: …${asked.slice(-120).trim()}`);
    try {
      const { say } = await api.ask(asked);
      if (!rt) return;
      // The answer to what she was asked: hers to say, named or not.
      openUntil = Math.max(openUntil, Date.now() + FOLLOW_UP_MS);
      if (say) rt.say(say, id);
      else rt.think("Nothing in the meeting or the briefing answers this.", id);
    } catch (e) {
      log(`  her memory did not answer: ${e.message}`);
      openUntil = Math.max(openUntil, Date.now() + FOLLOW_UP_MS);
      rt?.think("The backend could not answer just now. Say you could not check it.", id);
    }
  };

  /**
   * Opens her GPT-Live session: when somebody arrives, when somebody is back after she
   * was alone, and again when it drops or runs out — with the conversation so far.
   */
  const startLive = (resume = false) => {
    if (rtGaveUp || resting) return;
    const openedAt = Date.now();
    const recap = [...recent.values()].join("\n").slice(-16_000);
    rtRoom = null;
    rtExpiresAt = 0;
    try {
      rt = openLive(resume, recap, openedAt);
    } catch (e) {
      rtGaveUp = true;
      log(`  GPT-Live could not start (${e.message}) — she stays quiet`);
      return;
    }
    void page.evaluate(() => window.__ava?.listen(true)).catch(() => {});
    if (!rtGreeted) {
      rtGreeted = true;
      // Her hello is hers to say: nobody names her before she has introduced herself.
      openUntil = Date.now() + 20_000;
      // Joined well after the start — late, or back after dropping out: no full introduction
      // in the middle of a meeting, only a word that she is (back) here.
      const underWay = meeting.startsAt && Date.now() - meeting.startsAt > 3 * 60_000;
      rt.say(
        underWay
          ? `You have just joined a meeting that is already under way (you may have dropped out and come back). Say only, in ${LANGUAGE_NAME[lang]} and in a few words, that you are here — for example "${DISPLAY_NAME} here, back with you" — then listen. Do not introduce yourself at length, and do not interrupt anybody: say it at the first pause.`
          : `You have just joined. Introduce yourself to the room now, briefly, in ${LANGUAGE_NAME[lang]}: you are ${DISPLAY_NAME}, ${possessive(ownerOf(meeting))} meeting assistant; you will follow along and take notes${emailsNotes() ? " and send everyone a summary with the actions afterwards" : ""}${
              askForEmails() ? ", and anyone who wants the notes can type their email in the meeting chat" : ""
            }. In a group, say that people can ask you anything by saying your name.`,
      );
    }
    log(`  GPT-Live is her ears and voice${resume ? " again" : ""}; ${DELEGATE === "claude" ? "Claude" : `${DELEGATE} (${EFFORT} effort${WEB ? "" : ", no web search"})`} does the thinking`);
  };

  const openLive = (resume, recap, openedAt) => {
    const session = connectLive({
      instructions: liveInstructions(meeting, lang, platform.name, emailsNotes()),
      // What she hands over: to Claude through the app, or to an OpenAI model OpenAI runs.
      delegation:
        DELEGATE === "claude"
          ? { type: "client" }
          : {
              type: "responses",
              responses: {
                model: DELEGATE,
                instructions: backendInstructions(meeting, lang),
                reasoning: { effort: EFFORT },
                text: { verbosity: "low" },
                tools: [...(WEB ? [{ type: "web_search" }] : []), ...BACKEND_TOOLS, ...(meeting.client ? [SEARCH_TOOL] : [])],
                tool_choice: "auto",
                parallel_tool_calls: false,
              },
            },
      onFunctionCall: async (name, args) => {
        if (name === "meeting_record") return (await api.record()).record;
        if (name === "note_action") {
          await api.record(args);
          log(`  noted: ${args.text}`);
          return "Noted — it will be in the meeting notes.";
        }
        if (name === "search_knowledge") {
          log(`  looking up: ${args.query}`);
          return api.knowledge(args.query);
        }
        return "Unknown tool.";
      },
      history: resume && recap ? `The meeting so far, from its captions (your session was reconnected; carry on from here):\n${recap}` : null,
      log,
      onStarted: (expiresAt) => {
        rtExpiresAt = expiresAt;
        rtFailures = 0;
        tellRoom();
      },
      onAudio: playLive,
      onHeard: (piece) => {
        // Her name, as GPT-Live hears it — sooner than the captions write it. Only a new one:
        // the end of what came before, joined to this piece, catches a name cut in two.
        const before = rtHeard.slice(-16);
        if (namesIn(before + piece) > namesIn(before)) heardName(rtLastSpeaker || null);
        rtHeard = (rtHeard + piece).slice(-4000);
        rtHeardTotal += piece.length;
        if (piece.trim()) rtHeardAt = Date.now();
        lookAhead(piece);
      },
      onSaid: (text, at) => {
        // A reply kept quiet because nobody named her: never heard, so not hers in the notes.
        if (quietSpans.some((s) => at >= s.from - 1500 && at <= s.to + 1500)) {
          log(`  (kept quiet — nobody said her name) ${text}`);
          return;
        }
        log(`  ▸ ${text}`);
        recent.set(`said:${at}`, `${DISPLAY_NAME}: ${text}`);
        said.push({ key: `live:${at.toString(36)}:${said.length}`, text, at });
      },
      onDelegation: (id, target) => {
        if (target === "client") void answerDelegation(id);
        else log(`  she hands it to ${DELEGATE}`);
        // What she handed over is coming back to be said: the conversation waits for it.
        openUntil = Math.max(openUntil, Date.now() + 60_000);
      },
      // Her backend's answer is ready: she says it, named or not.
      onAnswered: () => {
        openUntil = Math.max(openUntil, Date.now() + FOLLOW_UP_MS);
      },
      onClose: (why, byUs) => {
        // A session she replaced or closed herself: nothing to do.
        if (rt !== session) return;
        rt = null;
        if (byUs || over || alone) return;
        rtFailures = Date.now() - openedAt < 15_000 ? rtFailures + 1 : 0;
        if (rtFailures >= 3) {
          rtGaveUp = true;
          log(`  GPT-Live keeps closing (${why}) — she stays quiet; check OPENAI_API_KEY`);
          return;
        }
        log(`  GPT-Live session ended (${why}) — reconnecting`);
        setTimeout(() => {
          if (!over && !alone && !rt) startLive(true);
        }, 1000);
      },
    });
    return session;
  };

  /** Her session is closed while nobody is there to talk to: it is billed by the minute. */
  const stopLive = (why) => {
    if (!rt) return;
    rt.close();
    rt = null;
    void page.evaluate(() => window.__ava?.listen(false)).catch(() => {});
    log(`  GPT-Live closed — ${why}`);
  };
  process.once("SIGINT", () => void finish("stopped by you"));

  while (!over) {
    await ensureStarted();
    const lines = heard.splice(0);
    const delivered = live ? said.shift() ?? null : pending;
    if (!live) pending = null;

    try {
      const wordsBefore = wordsHeard;
      const out = await api.tick({
        lines,
        idle: !speaking,
        delivered: delivered?.key,
        deliveredText: delivered?.text,
        deliveredAt: delivered?.at,
        dropped,
        face: resting ? "resting — nobody else here" : speaking ? "speaking" : faceState,
        // Her GPT-Live session, so the site shows it is closed when nobody is here.
        voice: live
          ? rt
            ? `GPT-Live open (${lang})`
            : resting
              ? "closed — nobody else here"
              : sawOthers
                ? "closed"
                : "not opened — nobody else here yet"
          : "ElevenLabs",
        captions: {
          socket: true,
          received: heardCount,
          secondsSinceLast: lastHeardAt ? Math.round((Date.now() - lastHeardAt) / 100) / 10 : null,
        },
        people,
        // Nobody else here yet: she holds her hello until somebody is.
        // Nobody else here — yet, or any more: nothing to say to an empty room.
        waiting: !sawOthers || alone,
        // Addresses given in the meeting chat since the last tick.
        emails: newEmails.splice(0),
        // GPT-Live speaks for her: the app keeps the transcript but says nothing.
        listenOnly: live,
      });

      // Why she is quiet, whenever that changes — "she stopped talking" should be
      // answerable from this log alone.
      if (out.reason && out.reason !== lastReason && !/mid-sentence|still speaking/.test(out.reason)) {
        log(`  · ${out.reason}`);
      }
      if (out.reason) lastReason = out.reason;

      dropped = null;

      // They carried on talking while she was deciding: what she was about to say may
      // answer something they have already moved past. She holds it back, and the server
      // puts what it answered back in her queue, for the next pause with what was said
      // since. Answers to her get more leeway than remarks she volunteers, and are held
      // back once at most — a question put to her has to get its answer eventually.
      const newWords = wordsHeard - wordsBefore;
      const tolerance = out.kind === "volunteer" ? 4 : (out.attempt ?? 0) >= 1 ? Number.POSITIVE_INFINITY : 8;
      if (out.say && out.key && newWords >= tolerance) {
        log(`  (held back — they kept talking; she answers at the next pause) ${out.say}`);
        dropped = out.key;
        out.say = null;
      }

      // Ended from the site: leave the call. Without this her Chrome stayed in
      // the meeting after you had ended it, then sent the notes again when it finally left.
      // "gone": her seat on the site holds another meeting now — this one is over for her.
      if (out.status && out.status !== "live") {
        endedElsewhere = true;
        await finish(
          out.status === "gone"
            ? "her seat on the site has moved on to another meeting"
            : `the meeting was ended from the site${out.endedBy ? ` by ${out.endedBy}` : ""} (${out.status})`,
        );
        break;
      }

      if (out.say && !speaking) {
        speaking = true;
        rtVoicedAt = Date.now();
        wordsWhenSheStarted = wordsHeard;
        const { say, key } = out;
        const at = Date.now();
        log(`  ▸ ${say}`);
        // Not awaited: the loop keeps listening while she talks, which is what lets
        // somebody interrupt her.
        // Avatar mode sends raw audio, which is what her face lip-syncs to.
        const spoken = speech(say, mode === "avatar" ? "pcm_16000" : undefined, lang).then((audio) =>
          page.evaluate((a) => window.__ava.play(a), audio),
        );
        void spoken
          .then((ok) => {
            if (ok && key) pending = { key, text: say, at };
            else log("  (could not say it)");
          })
          .catch((e) => log(`  (could not say it: ${e.message})`))
          .finally(() => {
            speaking = false;
            wake();
          });
      }
    } catch (e) {
      if (delivered) {
        if (live) said.unshift(delivered);
        else pending = delivered;
      }
      log(`  tick failed: ${e.message}`);
    }

    // Has the meeting ended, or has everybody gone?
    const state = await page
      .evaluate(platform.state, PEOPLE)
      .catch(() => ({ inCall: false, ended: false, alone: false, people: null, face: null }));
    if (state.face) faceState = state.face;
    // Other notetakers in the call are not people: say once which ones she is not counting.
    for (const b of state.bots ?? []) {
      if (seenBots.has(b)) continue;
      seenBots.add(b);
      log(`  not counting ${b} — a notetaker, not a person`);
      // The site needs to know too: with Fireflies in the call her notes are not emailed.
      if (/fireflies/i.test(b) && !firefliesHere) {
        firefliesHere = true;
        log("  Fireflies is here — it sends its own notes; hers will be filed, not emailed");
      }
      void api.update({ notetakers: [...seenBots] }).catch(() => {});
    }
    if (state.people !== people && state.people) {
      const how = [
        `${state.tiles ?? "?"} on screen`,
        state.badge > (state.tiles ?? 0) ? `${state.badge} by the people button` : "",
        state.bots?.length ? `${state.bots.length} notetaker${state.bots.length > 1 ? "s" : ""} not counted` : "",
      ].filter(Boolean);
      log(`  ${state.people} in the call (${how.join(", ")})`);
    } else if (people && !state.people && state.inCall) {
      log(`  cannot tell how many are in the call (${state.tiles ?? 0} on screen, people button ${state.badge || "—"})`);
    }
    people = state.people;
    tellRoom();

    // The language they actually speak, from what GPT-Live hears: the captions — and so
    // the transcript and the notes — follow it. Twice in a row, and not more than every
    // half minute, so one borrowed phrase does not flip the captions.
    if (live && rtHeardTotal - langCheckedAt >= 120) {
      langCheckedAt = rtHeardTotal;
      const spoken = detectLanguage(rtHeard.slice(-300));
      if (spoken === lang) langVote = { lang: null, n: 0 };
      else {
        langVote = langVote.lang === spoken ? { lang: spoken, n: langVote.n + 1 } : { lang: spoken, n: 1 };
        if (langVote.n >= 2 && Date.now() - langSwitchedAt > 30_000) {
          langSwitchedAt = Date.now();
          langVote = { lang: null, n: 0 };
          lang = spoken;
          log(`  they are speaking ${LANGUAGE_NAME[spoken]} — the captions follow`);
          await platform.setLanguage(page, log, spoken).catch((e) => log(`  could not change the caption language: ${e.message}`));
          await api.update({ language: spoken }).catch(() => {});
        }
      }
    }

    // Live sessions run out after a while: renew ahead of it, in a quiet moment, rather
    // than be cut off mid-sentence.
    if (rt && rtExpiresAt && Date.now() > rtExpiresAt - 60_000 && Date.now() - rtVoicedAt > 3000 && Date.now() - (lastHeardAt ?? 0) > 2000) {
      stopLive("renewing before it runs out");
      startLive(true);
    }

    // Teams is new to her: a snapshot of the page once she is settled in, to check what
    // she can see — captions, the people count — against what she reads from it.
    if (platform.id === "teams" && !snapshotTaken && Date.now() - inCallAt > 20_000) {
      snapshotTaken = true;
      await keepEvidence(page, "teams-in-call", log);
    }

    outOfCall = state.inCall ? 0 : outOfCall + 1;
    if (state.ended || outOfCall >= 3) {
      if (platform.id === "teams") await keepEvidence(page, "teams-ended", log);
      await finish(state.ended ? "the meeting ended" : "she is no longer in the call");
      break;
    }
    // Somebody else is here: say hello, and bring her face up for them.
    if (!sawOthers && ((state.people ?? 0) >= 2 || heardCount > 0)) {
      sawOthers = true;
      sawOthersAt = Date.now();
      log("  somebody is here");
      if (live && !rt) startLive();
      if (mode === "avatar") void page.evaluate(() => window.__ava?.warm()).catch(() => {});
      if (platform.askForEmails && askForEmails()) {
        await platform.askForEmails(
          page,
          log,
          CHAT_ASK[lang](DISPLAY_NAME, ownerOf(meeting)),
        );
      }
      wake();
    }

    // Email addresses people typed in the meeting chat: they get the notes too.
    if (platform.chatEmails) {
      const found = await page.evaluate(platform.chatEmails).catch(() => []);
      for (const email of found) {
        if (chatEmails.has(email)) continue;
        chatEmails.add(email);
        newEmails.push(email);
        log(`  the notes will also go to ${email}`);
      }
    }

    // How she knows she is alone: the page's own count of people in the call is one —
    // her — or it says so in words ("You're the only one here", "Waiting for others to
    // join"). See `state` in platforms.mjs for each product.
    const aloneNow = state.alone || state.people === 1;
    aloneChecks = aloneNow ? aloneChecks + 1 : 0;
    presentChecks = aloneNow ? 0 : presentChecks + 1;
    alone = aloneNow;

    // Her voice session and her face are billed by the minute: both close as soon as the
    // room is empty, and reopen when somebody is back — seen twice in a row, so a tile
    // lingering after somebody left does not bring them back for nothing.
    if (sawOthers) {
      if (!resting && aloneChecks >= ALONE_CHECKS) {
        resting = true;
        log("  nobody else here — her voice session and face close");
        if (live) stopLive("nobody else here");
        if (mode === "avatar") void page.evaluate(() => window.__ava?.rest?.()).catch(() => {});
      } else if (resting && presentChecks >= ALONE_CHECKS) {
        resting = false;
        log("  somebody is back");
        if (live && !rt && !over && !hushed) startLive(true);
        if (mode === "avatar") void page.evaluate(() => window.__ava?.warm()).catch(() => {});
      }
    }

    // Silence: nobody — her included — has said anything for a while. GPT-Live is closed
    // (it reopens when somebody speaks), and after longer she leaves.
    if (sawOthers && !aloneNow && !over) {
      const quietFor = Date.now() - Math.max(lastHeardAt ?? 0, rtVoicedAt, rtHeardAt, sawOthersAt);
      // Everybody who has spoken has gone, and what is left has never said a word — a
      // notetaker she does not know by name, most likely (Fireflies kept her in an empty
      // meeting for over an hour). As good as alone: she leaves after a minute of silence.
      // Only with every tile on screen and at most two left, and once tiles and captions
      // have been seen to name people alike.
      const others = state.others ?? [];
      const speakersHere = spokeHere(others, voices.keys());
      if (speakersHere.length) namesAgree = true;
      if (
        namesAgree &&
        others.length &&
        others.length <= SILENT_OTHERS_MAX &&
        !speakersHere.length &&
        !(state.badge > state.tiles) &&
        quietFor > ALONE_MS
      ) {
        await finish(`everybody who spoke has left — ${others.map(tileName).join(", ")} never said a word`);
        break;
      }
      if (live && rt && !hushed && quietFor > HUSH_MS) {
        hushed = true;
        stopLive(`nobody has said anything for ${Math.round(quietFor / 60_000)} min — back when somebody speaks`);
      }
      if (quietFor > SILENT_LEAVE_MS) {
        await finish(`nobody has said anything for ${Math.round(quietFor / 60_000)} minutes`);
        break;
      }
    }

    // Teams can go on counting somebody who has left on its People button. Nobody else on
    // screen — her own tile still there — and not a word from anybody for a minute: she is
    // alone, whatever the button says. The page is kept the first time, to see what it shows.
    if (platform.id === "teams" && sawOthers && state.inCall) {
      const noOtherTile = !(state.others ?? []).length;
      if (noOtherTile && !emptySnapshot) {
        emptySnapshot = true;
        log(`  Teams: nobody else on screen (${state.tiles ?? 0} tiles, people button ${state.badge || "—"})`);
        await keepEvidence(page, "teams-nobody-else", log);
      }
      emptySince = noOtherTile && (state.tiles ?? 0) > 0 ? (emptySince ?? Date.now()) : null;
      if (
        emptySince &&
        !aloneNow &&
        (state.badge ?? 0) <= 2 + (state.bots?.length ?? 0) &&
        Date.now() - emptySince > ALONE_MS &&
        Math.max(lastHeardAt ?? 0, rtHeardAt) < emptySince
      ) {
        await finish("everybody else left — nobody else on screen, and not a word for a minute");
        break;
      }
    }

    // Leaving an empty room: five minutes from the start time if nobody turned up (she
    // may have come early; people join late); one minute once everybody has gone. Her
    // voice session and face are closed on the way out either way.
    if (!sawOthers) {
      const deadline = Math.max(inCallAt, meeting.startsAt ?? 0) + NOBODY_MS;
      if ((aloneNow && Date.now() > deadline) || Date.now() - inCallAt > NOBODY_CAP_MS) {
        nobodyCame = true;
        await finish("nobody came");
        break;
      }
    } else if (aloneNow) {
      aloneSince ??= Date.now();
      if (Date.now() - aloneSince > ALONE_MS) {
        await finish("everybody else left");
        break;
      }
    } else {
      aloneSince = null;
    }

    await Promise.race([sleep(TICK_MS), new Promise((r) => (wake = r))]);
  }

  // 7 — after: leave, then the notes.
  // Her face first: a session left for Anam to time out is billed until it does.
  await page.evaluate(() => window.__ava?.end?.()).catch(() => {});
  await platform.leave(page).catch(() => {});
  await context.close().catch(() => {});

  // The site is already writing the notes when it ended the meeting. Writing
  // them here as well, a second later, would race it and mail the guests twice.
  if (endedElsewhere) {
    log("  the site is writing the notes");
    return;
  }

  await api.stop(leftBecause).catch((e) => log(`  could not close the meeting: ${e.message}`));
  if (nobodyCame) {
    log("  nobody came — no notes to send");
    return;
  }
  try {
    const r = await api.sendNotes();
    log(
      r.delivered?.sent
        ? `  notes sent to ${r.followUp?.to}`
        : r.notEmailed
          ? r.why
            ? `  notes written, not emailed — ${r.why}`
            : "  notes written — filed on the client's page, not emailed"
          : "  notes written — nobody to send them to",
    );
  } catch (e) {
    log(`  notes not sent: ${e.message}`);
  }
}
