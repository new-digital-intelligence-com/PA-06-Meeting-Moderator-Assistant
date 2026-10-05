/**
 * The half of her that needs a model.
 *
 * Three jobs: answer when somebody talks to her, pull actions out of the conversation
 * as it goes, and write the summary afterwards. Each one is given the briefing you
 * wrote before the meeting — that text is the only thing she knows about why these
 * people are in a room together, and it is what separates a useful answer from a
 * transcript parrot.
 *
 * Every call forces a tool so the reply comes back as a checked object rather than
 * prose we have to parse. In a live meeting a malformed JSON blob is a silence.
 */

import Anthropic from "@anthropic-ai/sdk";
import { speakers, transcriptText, type ActionItem, type Meeting, type TranscriptLine } from "./meeting";
import { LANGUAGES } from "./languages";

/** Live replies must be quick — a slow answer lands after the moment has passed. */
export const FAST = process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5";
/** The write-up happens once, off the clock, so quality wins over speed. */
export const WRITER = process.env.ANTHROPIC_MODEL_WRITER ?? "claude-sonnet-5";

const client = () => new Anthropic();

export function botName() {
  return (process.env.BOT_NAME || "Ava").split("—")[0].trim();
}

/**
 * Is this line aimed at her? A word-boundary match on her name, not a substring —
 * otherwise "available" and "Avalon" summon her mid-sentence.
 *
 * Cheap on purpose: it runs on every line of the meeting, and the model is only
 * involved once this says yes.
 */
export function isAddressed(text: string): boolean {
  // Captions routinely mishear "Ava" — "Eva" most of all; in a real meeting she was asked
  // a direct question as "Okay, Eva…" and never registered it. In a group the model also
  // recognises mishearings this list misses. AVA_ALIASES overrides the list.
  // Arabic captions write her name in Arabic script.
  const names = [botName(), ...(process.env.AVA_ALIASES ?? "Eva,Iva,Eeva,Ayva,Avah,آفا,أفا,افا,آڤا,ايفا,إيفا,إفا").split(",")]
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // \b only knows Latin letters, so the edges are "not a letter" in any script.
  return new RegExp(`(^|[^\\p{L}])(${names.join("|")})($|[^\\p{L}])`, "iu").test(text);
}

/**
 * How she sounds, shared by everything she says out loud.
 *
 * Worth being explicit about: a model asked for "one or two sentences" reliably returns
 * something that reads well and sounds like a press release. This is speech. Nobody can
 * re-read it, nobody can skim it, and the difference between "Our SOC 2 report was
 * renewed last month and is ready to send" and "Good news — we renewed the SOC 2 last
 * month, I can send it over now" is the difference between a service announcement and
 * somebody in the room.
 */
const VOICE = [
  "How you sound:",
  "- Talk, do not present. Contractions, plain words, the way somebody speaks in a meeting.",
  "- Use people's names when you are answering them. You can see who said what.",
  "- Lead with the useful bit. No throat-clearing, no 'great question', no restating what was asked.",
  "- Two sentences is usually plenty. One is often better.",
  "- No markdown, no lists, no URLs, no emoji — every word is read aloud.",
  "- Say numbers and dates the way you would speak them: 'about five working days', 'March', 'forty thousand a year'.",
  "- If you are offering to do something, say so as an offer, not as a thing already done.",
].join("\n");

/**
 * What she is actually hearing. Live captions mishear names and words, and she used to
 * correct people for calling her "Eva" and ask them to repeat anything with a misheard
 * word in it — both of which read as a machine, not a colleague.
 */
const HEARING = [
  "What you hear is live machine captions, not a clean transcript:",
  "- Words are often misheard. Your own name may come through as Eva, Iva, Ever, آفا, إيفا or similar — it is still you. Never correct anyone about your name.",
  "- When a sentence is garbled, work out what they most likely meant from the context and respond to that. Ask them to repeat only if you genuinely cannot tell.",
].join("\n");

const LISTENER = [
  "How to take part:",
  "- You do not have to answer everything. Say nothing (empty say) when they are setting something up in several parts and have not finished, when they are talking to somebody else, when it is only 'ok' or 'yeah' after you spoke, or when there is nothing worth adding.",
  "- Confirm an instruction once, briefly, then act on it. Never restate the same plan again in different words.",
  "- Greet people once. Do not thank or welcome them again.",
  "- If they give you a role — interviewer, facilitator, devil's advocate, timekeeper — play it fully and see it through: keep track of where it stands in your working notes, and move it on yourself.",
  "- Asked where things stand or what comes next, answer from your working notes — say where you are and take the next step (ask the next question, repeat the one still open).",
].join("\n");

/** The briefing, plus what has actually happened since. */
function brief(m: Meeting): string {
  const who = speakers(m);
  const actions = m.actions.length
    ? m.actions.map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.text}${a.due ? ` (by ${a.due})` : ""}`).join("\n")
    : "(none captured yet)";
  return [
    `Meeting: ${m.title}`,
    // The captions are in this language, and so is she: they switched them for her.
    `Language of this meeting: ${LANGUAGES[m.language].name}. Speak ${LANGUAGES[m.language].name} — natural, spoken ${LANGUAGES[m.language].name}${m.language === "ar" ? " (clear Modern Standard Arabic, following the register people use with you)" : ""} — unless somebody clearly speaks to you in another language, then answer in theirs.`,
    "",
    "What you were told before the meeting:",
    m.context.trim() || "(nothing — you were given no briefing)",
    "",
    who.length ? `People who have spoken so far: ${who.join(", ")}.` : "Nobody has spoken yet.",
    "",
    `Actions you have noted:\n${actions}`,
    "",
    // Her own running notes: a role she was given, a plan, where it stands. Without them
    // she lost an interview she was running once the instructions scrolled out of view.
    m.memory?.trim()
      ? `Your working notes for this meeting (you wrote these; keep them up to date):\n${m.memory.trim()}`
      : "Your working notes for this meeting: (none yet)",
  ].join("\n");
}

/* ------------------------------------------------------- answering out loud */

const REPLY_TOOL: Anthropic.Tool = {
  name: "reply",
  description: "What to say out loud, plus anything it implies you should write down.",
  input_schema: {
    type: "object",
    properties: {
      say: {
        type: "string",
        description:
          "Your spoken reply. One to three short sentences of plain speech — no markdown, lists, emoji or URLs. Empty string if the remark was not really for you and no answer is needed.",
      },
      add_actions: {
        type: "array",
        description: "Anything the speaker just asked you to note down. Usually empty.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The action, phrased as a task." },
            owner: { type: "string", description: "Who owns it, if named." },
            due: { type: "string", description: "Plain-language due date, if given." },
          },
          required: ["text"],
        },
      },
      memory: {
        type: "string",
        description:
          "Only when something changed: your working notes for this meeting, rewritten in full — any role or task you have been given, how it is meant to go, what is done, what comes next (e.g. 'Interviewer: 3 questions each to Helmi and Sami, different questions of equal difficulty, then evaluate both. Done: Q1 Helmi, Q1 Sami. Next: Q2 Helmi.'). Under 80 words. Empty if nothing changed.",
      },
    },
    required: ["say"],
  },
};

export type ModeratorReply = {
  say: string;
  add_actions?: { text: string; owner?: string; due?: string }[];
  /** Her working notes, rewritten, when they changed. */
  memory?: string;
};

/**
 * Why she is answering: her name was said, or it is just her and one other person — in
 * which case everything they say is said to her, and waiting to be named first is what
 * made her sit through a whole call in silence.
 */
export type Addressed = "named" | "one-on-one";

function replySystem(how: Addressed) {
  return [
    `You are ${botName()}, sitting in on a live video meeting as a participant. Your words are spoken aloud, immediately, to everyone in the room.`,
    "",
    how === "named"
      ? "Somebody just said your name. Answer them."
      : [
          "It is just you and one other person on this call, so whatever they say is said to you. Respond the way a person on a call would: answer what they ask, react to what they tell you, and when they lay out a topic, engage with it — a real thought, a key angle, or a good question that moves it on.",
          "Return an empty say for filler that needs no answer ('hmm', 'one sec', 'let me share my screen'), when they have plainly stopped mid-sentence, or when they are still setting something up and have not finished.",
        ].join("\n"),
    "",
    "- General questions — explain a concept, compare two approaches, what is hard about something, how something usually works — answer them properly from your own knowledge, the way a knowledgeable colleague would. Give a real answer with substance, not a hedge.",
    "- Specific facts about THIS company, these people, this project — dates, prices, numbers, names, decisions, what was agreed before — come only from the briefing and what has been said. If they are not there, say plainly that you do not know rather than inventing them.",
    "- If asked to note something down, record it with add_actions and confirm in a few words.",
    "- If asked what has been covered, or where things stand, summarise what was actually said — briefly.",
    ...(how === "named"
      ? [
          "- If your name came up in passing and nothing was asked of you, return an empty say. Saying nothing is a valid and often correct answer; interrupting a meeting you were not invited into is the worst thing you can do.",
        ]
      : []),
    "- Read your own earlier lines in the transcript. Never say the same thing twice.",
    "- Never invent a decision, a commitment or a deadline that was not said out loud.",
    "- Unless they have given you a role, you are a guest here, not the chair: do not push people along or take sides in their decisions.",
    "",
    LISTENER,
    "",
    HEARING,
    "",
    VOICE,
  ].join("\n");
}

export async function answerAddressed(
  m: Meeting,
  line: TranscriptLine,
  recent: TranscriptLine[],
  how: Addressed = "named",
): Promise<ModeratorReply> {
  const response = await client().messages.create({
    model: FAST,
    max_tokens: 500,
    system: [
      { type: "text", text: replySystem(how), cache_control: { type: "ephemeral" } },
      { type: "text", text: brief(m) },
    ],
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: "reply" },
    messages: [
      {
        role: "user",
        content: [
          "The last few minutes of the meeting:",
          transcriptText(recent),
          "",
          how === "named"
            ? `${line.speaker} just said, addressing you directly: "${line.text}"`
            : `${line.speaker} just said to you: "${line.text}"`,
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return block ? (block.input as ModeratorReply) : { say: "" };
}

/* ---------------------------------------------------------- group meetings */

const TURN_TOOL: Anthropic.Tool = {
  name: "turn",
  description: "Whether what was just said is meant for you, whether to speak now, and what to say.",
  input_schema: {
    type: "object",
    properties: {
      addressed: {
        type: "boolean",
        description: "True if any of what was just said is meant for you, directly or indirectly — see the guidance.",
      },
      respond: { type: "boolean", description: "True if you should speak now." },
      say: {
        type: "string",
        description: "What to say if respond is true: one to three short sentences of plain speech. Empty otherwise.",
      },
      add_actions: {
        type: "array",
        description: "Anything you were just asked to note down. Usually empty.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The action, phrased as a task." },
            owner: { type: "string", description: "Who owns it, if named." },
            due: { type: "string", description: "Plain-language due date, if given." },
          },
          required: ["text"],
        },
      },
      memory: {
        type: "string",
        description:
          "Only when something changed: your working notes for this meeting, rewritten in full — any role or task you have been given, how it is meant to go, what is done, what comes next (e.g. 'Interviewer: 3 questions each to Helmi and Sami, different questions of equal difficulty, then evaluate both. Done: Q1 Helmi, Q1 Sami. Next: Q2 Helmi.'). Under 80 words. Empty if nothing changed.",
      },
    },
    required: ["addressed", "respond", "say"],
  },
};

export type GroupTurn = ModeratorReply & { addressed: boolean; respond: boolean };

/**
 * A group call, at a pause: was any of that for her, and should she speak?
 *
 * One judgement rather than a name check followed by "should she chime in". Waiting for
 * her exact name is how she sat silent through a group call: captions mishear it, people
 * say "what does the assistant think" or ask the room something she can answer, and none
 * of that contains "Ava". Being spoken to — however it is done — always gets an answer,
 * whatever the activity level or cooldown; volunteering is what those govern.
 */
export async function groupTurn(
  m: Meeting,
  pending: TranscriptLine[],
  recent: TranscriptLine[],
  { mayVolunteer, secondsSinceSheSpoke }: { mayVolunteer: boolean; secondsSinceSheSpoke: number | null },
): Promise<GroupTurn> {
  const volunteering =
    m.activity === "quiet"
      ? ["You are set to quiet: never volunteer. Speak only when addressed."]
      : !mayVolunteer
        ? ["You spoke only moments ago, so do not volunteer now. Speak only if addressed."]
        : m.activity === "active"
          ? [
              "You are an engaged participant, not a fly on the wall. Volunteer when you have something substantive:",
              "- somebody lays out a topic or asks for thoughts: a real point, a key angle, or a sharp question;",
              "- the briefing holds something relevant that the room is missing;",
              "- something said contradicts the briefing, or is being got wrong;",
              "- they are discussing a general topic and you know something genuinely useful: a clear explanation, a key distinction, a common pitfall;",
              "- somebody committed to something and it is worth confirming you have it.",
              "Not when you would only be agreeing, encouraging or restating what everyone just heard, when somebody is mid-thought, or when you are guessing.",
            ]
          : [
              "Volunteer rarely, only when it clearly matters: the briefing holds something the room needs and does not have, a question to the room went unanswered and you can answer it, or something said contradicts the briefing.",
            ];

  const system = [
    `You are ${botName()}, an AI assistant taking part in a live video meeting with several people. You were briefed beforehand and you are taking notes. Whatever you say is spoken aloud to everyone.`,
    "",
    "At each pause, decide two things about what was just said.",
    "",
    "1. addressed: is any of it meant for you? Yes when:",
    "- they use your name, or something that is plainly your name misheard;",
    '- they mean you without naming you: "the assistant", "the AI", "our note-taker", or "what do you think" / "can you…" said straight after you spoke;',
    "- they ask the room something you can answer well (a fact, a definition, a quick explanation, what was said earlier, the actions so far) and nobody else has answered;",
    "- they ask for what is your job here: note this down, summarise, recap, remind us.",
    "The others talking among themselves about their own work is not addressed to you.",
    "",
    "2. respond: should you speak now?",
    "- Addressed: yes, answer it, unless it was only a passing mention that asks nothing of you.",
    "- Not addressed:",
    ...volunteering.map((l) => `  ${l}`),
    "",
    "When you answer:",
    "- General questions get a real answer from your own knowledge, the way a knowledgeable colleague would.",
    "- Facts about this company, these people or this project come only from the briefing and what has been said. If they are not there, say you do not know.",
    "- Read your own earlier lines in the transcript. Never say the same thing twice.",
    "- Never invent a decision, a commitment or a deadline. Unless they have given you a role, you are a guest, not the chair.",
    "",
    LISTENER,
    "",
    HEARING,
    "",
    VOICE,
    "",
    secondsSinceSheSpoke !== null
      ? `You last spoke ${Math.round(secondsSinceSheSpoke)} seconds ago.`
      : "You have not spoken yet beyond introducing yourself.",
  ].join("\n");

  const response = await client().messages.create({
    model: FAST,
    max_tokens: 500,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
      { type: "text", text: brief(m) },
    ],
    tools: [TURN_TOOL],
    tool_choice: { type: "tool", name: "turn" },
    messages: [
      {
        role: "user",
        content: [
          "The last few minutes of the meeting:",
          transcriptText(recent),
          "",
          "Said since you last responded (newest last):",
          transcriptText(pending),
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const out = (block?.input ?? {}) as Partial<GroupTurn>;
  const say = out.say?.trim() ?? "";
  return {
    addressed: Boolean(out.addressed),
    respond: Boolean(out.respond) && Boolean(say),
    say,
    add_actions: out.add_actions,
    memory: out.memory,
  };
}

/* ------------------------------------------ her thinking, for her Live voice */

/**
 * With AVA_BRAIN=live, OpenAI's GPT-Live is her ears and voice: it holds the conversation
 * itself, and hands over what needs her memory of the meeting — what was said or decided
 * earlier, the actions so far, something to note down, facts from the briefing. Claude
 * answers from the whole transcript and the briefing; GPT-Live says it.
 */
export async function answerForVoice(
  m: Meeting,
  recent: TranscriptLine[],
  asked: string,
  /** Passages from the client's documents that match what was asked, when she attends for one. */
  documents?: string,
): Promise<ModeratorReply> {
  const system = [
    `You are the thinking half of ${botName()}, an AI assistant taking part in a live video meeting. Her voice — a live speech model — holds the conversation, and has just handed you something that needs your knowledge of this meeting: what was said or decided earlier, a recap, the actions so far, something to note down, or facts from the briefing.`,
    "",
    "Give her what to say back: the answer itself, as she would say it out loud. She says it in her own words.",
    "- Facts about this company, these people or this project come only from the briefing, the transcript and the client's documents below. If they are not there, say so plainly.",
    "- Asked to note something down: record it with add_actions and confirm in a few words.",
    "- Asked for a recap or the actions: only what was actually said. Never invent a decision, a commitment or a deadline.",
    "- If what was handed over is not clear, give your best reading of what they want; an empty say only if there is truly nothing to answer.",
    "",
    HEARING,
    "",
    VOICE,
  ].join("\n");

  const response = await client().messages.create({
    model: FAST,
    max_tokens: 500,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
      { type: "text", text: brief(m) },
    ],
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: "reply" },
    messages: [
      {
        role: "user",
        content: [
          "The meeting so far (live captions):",
          transcriptText(recent) || "(nothing yet)",
          "",
          ...(documents ? [`From ${m.client?.name ?? "the client"}'s documents, the passages closest to what was asked:`, documents, ""] : []),
          "What her voice just heard, as it heard it:",
          asked.trim() || "(unclear)",
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return block ? (block.input as ModeratorReply) : { say: "" };
}

/* ------------------------------------------------------------- note-taking */

const NOTES_TOOL: Anthropic.Tool = {
  name: "notes",
  description: "Actions and decisions found in this stretch of the conversation.",
  input_schema: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        description:
          "Commitments somebody actually made out loud. An action needs a doer and a thing to do. Discussion, opinions and ideas nobody committed to are NOT actions. Usually this array is empty — that is fine and expected.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "The task, phrased as an instruction: 'send the revised deck to the client'." },
            owner: { type: "string", description: "The speaker name of whoever took it on. Omit if genuinely unclear." },
            due: { type: "string", description: "Plain-language deadline if one was said. Omit otherwise — never guess." },
          },
          required: ["text"],
        },
      },
      decisions: {
        type: "array",
        description: "Decisions the group settled on, one short sentence each. Empty if nothing was actually decided.",
        items: { type: "string" },
      },
    },
    required: ["actions", "decisions"],
  },
};

const NOTES_SYSTEM = [
  "You are the note-taker for a live meeting. You are given the newest stretch of transcript and the actions already captured.",
  "",
  "Extract only what was genuinely committed to or decided in THIS stretch.",
  "",
  "- Do not repeat an action already in the captured list. Say nothing rather than duplicate it.",
  "- Half-formed intentions ('we should probably look at that sometime') are not actions.",
  "- Never invent an owner or a deadline. If it was not said, leave the field out.",
  "- Most stretches of most meetings contain no action at all. Two empty arrays is the common, correct outcome.",
  "- The transcript is live captions and will contain mishearings. Do not turn a garbled phrase into a confident action.",
].join("\n");

export async function extractNotes(
  m: Meeting,
  fresh: TranscriptLine[],
): Promise<{ actions: { text: string; owner?: string; due?: string }[]; decisions: string[] }> {
  if (!fresh.length) return { actions: [], decisions: [] };

  const captured = m.actions.map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.text}`).join("\n") || "(none yet)";

  const response = await client().messages.create({
    model: FAST,
    max_tokens: 1000,
    system: [
      { type: "text", text: NOTES_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: `${brief(m)}\n\nAlready captured:\n${captured}` },
    ],
    tools: [NOTES_TOOL],
    tool_choice: { type: "tool", name: "notes" },
    messages: [{ role: "user", content: `New transcript:\n${transcriptText(fresh)}` }],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return { actions: [], decisions: [] };
  const out = block.input as { actions?: ModeratorReply["add_actions"]; decisions?: string[] };
  return { actions: out.actions ?? [], decisions: out.decisions ?? [] };
}

/* ------------------------------------------------------------- the write-up */

const FOLLOWUP_TOOL: Anthropic.Tool = {
  name: "follow_up",
  description: "The notes and the email that carries them.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "The notes as markdown: what was discussed, what was decided, and anything left open. Organised by topic, not by who spoke. This is the record — no greeting, no sign-off.",
      },
      subject: { type: "string", description: "Email subject line." },
      body: {
        type: "string",
        description:
          "ONLY the opening of the email: one line of context, then the actions as a numbered list, each written exactly as `1. Owner — what to do (by when)`, leaving out the owner or the date when nobody said one. Stop there. The notes and the file links are appended after this automatically — do not write them here, do not refer to them as being 'below', and do not add a sign-off.",
      },
    },
    required: ["summary", "subject", "body"],
  },
};

/**
 * Glues the email together from the parts.
 *
 * Assembled here rather than left to the model: asked for one long string it would
 * write "summary below" and then not write one, or repeat the notes it had already
 * put in the summary field. Deterministic joining means the email is complete every
 * time, whatever the model assumed.
 */
/** The plain-text section headings, per language. lib/email.ts reads them back. */
export const NOTE_HEADINGS = {
  en: { notes: "NOTES", files: "FILES" },
  de: { notes: "NOTIZEN", files: "DATEIEN" },
  ar: { notes: "الملاحظات", files: "الملفات" },
} as const;

function assemble(
  parts: { body: string; summary: string },
  files: { name: string; link: string }[],
  lang: keyof typeof NOTE_HEADINGS = "en",
): string {
  const h = NOTE_HEADINGS[lang];
  const sections = [parts.body.trim(), "", h.notes, "", parts.summary.trim()];
  if (files.length) {
    sections.push("", h.files, "", ...files.map((f) => `${f.name}: ${f.link}`));
  }
  return sections.join("\n");
}

export async function composeFollowUp(m: Meeting, senderName: string): Promise<{
  summary: string;
  subject: string;
  body: string;
}> {
  const actionList = m.actions.length
    ? m.actions.map((a, i) => `${i + 1}. ${a.owner ? `${a.owner} — ` : ""}${a.text}${a.due ? ` (by ${a.due})` : ""}`).join("\n")
    : "(no actions were captured)";
  const fileList = m.files.length
    ? m.files.map((f) => `- ${f.name}: ${f.link}`).join("\n")
    : "(no files were shared)";

  const response = await client().messages.create({
    model: WRITER,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text: [
          `You are ${botName()}, writing up a meeting you sat in on. The email is sent from ${senderName}'s account, so write something they are happy to put their name to.`,
          "",
          // Always English, whatever the meeting was held in: the team reads the notes in English.
          `- Write everything — subject, opening, actions, notes — in English${m.language !== "en" ? `, although the meeting was held in ${LANGUAGES[m.language].name}: translate what was said, and keep names, product names and quoted terms as they were` : ""}.`,
          "- Plain, direct business writing. No filler, no 'I hope this finds you well', no exclamation marks.",
          "- The actions are the point of the email. They go in `body`, first, and unmissable.",
          "- The notes go in `summary`: what was discussed and what was settled, organised by topic.",
          "- The two are joined for you. Do not repeat the notes in `body`, and do not promise anything 'below'.",
          "- Never invent a file link; they are appended from the record.",
          "- The transcript is live captions and contains mishearings. Where something is garbled, write around it rather than repeating nonsense confidently.",
          "- If the meeting was short or thin, the write-up should be short. Do not pad it.",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [FOLLOWUP_TOOL],
    tool_choice: { type: "tool", name: "follow_up" },
    messages: [
      {
        role: "user",
        content: [
          brief(m),
          "",
          `Actions captured:\n${actionList}`,
          `Files shared:\n${fileList}`,
          "",
          "Full transcript:",
          transcriptText(m.transcript).slice(0, 120_000) || "(nothing was transcribed)",
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("The model did not return a write-up.");
  const written = block.input as { summary: string; subject: string; body: string };
  return {
    summary: written.summary,
    subject: written.subject,
    body: assemble(written, m.files, "en"),
  };
}

/** Merge freshly found actions into the meeting, skipping ones we already have. */
export function mergeActions(
  existing: ActionItem[],
  found: { text: string; owner?: string; due?: string }[],
): ActionItem[] {
  const seen = new Set(existing.map((a) => normalise(a.text)));
  const added: ActionItem[] = [];
  for (const f of found) {
    const key = normalise(f.text);
    if (!f.text?.trim() || seen.has(key)) continue;
    seen.add(key);
    added.push({
      id: Math.random().toString(36).slice(2, 10),
      text: f.text.trim(),
      owner: f.owner?.trim() || undefined,
      due: f.due?.trim() || undefined,
    });
  }
  return added;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
