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

/** Live replies must be quick — a slow answer lands after the moment has passed. */
const FAST = process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5";
/** The write-up happens once, off the clock, so quality wins over speed. */
const WRITER = process.env.ANTHROPIC_MODEL_WRITER ?? "claude-sonnet-5";

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
  const name = botName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${name}\\b`, "i").test(text);
}

/** The briefing, plus what has actually happened since. */
function brief(m: Meeting): string {
  const who = speakers(m);
  const actions = m.actions.length
    ? m.actions.map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.text}${a.due ? ` (by ${a.due})` : ""}`).join("\n")
    : "(none captured yet)";
  return [
    `Meeting: ${m.title}`,
    "",
    "What you were told before the meeting:",
    m.context.trim() || "(nothing — you were given no briefing)",
    "",
    who.length ? `People who have spoken so far: ${who.join(", ")}.` : "Nobody has spoken yet.",
    "",
    `Actions you have noted:\n${actions}`,
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
    },
    required: ["say"],
  },
};

export type ModeratorReply = {
  say: string;
  add_actions?: { text: string; owner?: string; due?: string }[];
};

function replySystem() {
  return [
    `You are ${botName()}, sitting in on a live video meeting as a participant. Your words are spoken aloud, immediately, to everyone in the room.`,
    "",
    "Somebody just said your name. Answer them.",
    "",
    "- One to three short sentences. Spoken prose only: no markdown, no bullets, no URLs, no emoji. Somebody has to listen to this, not read it.",
    "- Use the briefing and what has been said so far. If you were asked something the briefing and the conversation do not answer, say plainly that you do not know rather than inventing it.",
    "- If asked to note something down, record it with add_actions and confirm in a few words.",
    "- If asked what has been covered, or where things stand, summarise what was actually said — briefly.",
    "- If your name came up in passing and nothing was asked of you, return an empty say. Saying nothing is a valid and often correct answer; interrupting a meeting you were not invited into is the worst thing you can do.",
    "- Never invent a decision, a commitment or a deadline that was not said out loud.",
    "- You are a guest here, not the chair. Do not push people along or take sides in their decisions.",
  ].join("\n");
}

export async function answerAddressed(
  m: Meeting,
  line: TranscriptLine,
  recent: TranscriptLine[],
): Promise<ModeratorReply> {
  const response = await client().messages.create({
    model: FAST,
    max_tokens: 500,
    system: [
      { type: "text", text: replySystem(), cache_control: { type: "ephemeral" } },
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
          `${line.speaker} just said, addressing you directly: "${line.text}"`,
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  return block ? (block.input as ModeratorReply) : { say: "" };
}

/* ----------------------------------------------------- speaking up unasked */

const VOLUNTEER_TOOL: Anthropic.Tool = {
  name: "contribute",
  description: "Whether to say something now, and what.",
  input_schema: {
    type: "object",
    properties: {
      worth_saying: {
        type: "boolean",
        description:
          "True only if this would genuinely move the conversation on. False is the ordinary answer — most moments in most meetings do not need you.",
      },
      say: {
        type: "string",
        description: "What to say, if worth_saying. One or two short sentences of plain speech. Empty otherwise.",
      },
    },
    required: ["worth_saying", "say"],
  },
};

/**
 * Should she chime in?
 *
 * Called at the end of somebody's utterance — a natural turn boundary — when she has
 * not spoken for a while. The model decides, and the prompt is written to make "no" the
 * easy answer, because the failure mode that gets a bot thrown out of the next meeting
 * is not silence, it is noise.
 *
 * What survives the bar is narrow on purpose: something concrete from the briefing that
 * the room is missing, an open question nobody picked up, a fact being got wrong. Not
 * agreement, not encouragement, not summarising what everyone just heard.
 */
export async function considerSpeaking(
  m: Meeting,
  recent: TranscriptLine[],
  secondsSinceSheSpoke: number | null,
): Promise<{ worth_saying: boolean; say: string }> {
  if (!recent.length) return { worth_saying: false, say: "" };

  const system = [
    `You are ${botName()}, a participant in a live video meeting. You have a face and a voice and the others can see you. You were briefed beforehand and you are taking notes.`,
    "",
    "Nobody has addressed you. Decide whether to speak anyway.",
    "",
    "Say something when you can actually add to it:",
    "- The briefing holds something relevant that the room clearly does not have.",
    "- A question was asked out loud and nobody answered it, and you can.",
    "- Something was stated that contradicts the briefing, and it matters.",
    "- They are going round in circles and a short, concrete restatement would break it.",
    "- Something was committed to and you want to confirm you have noted it.",
    "",
    "Stay quiet — this is the ordinary case — when:",
    "- You would only be agreeing, encouraging, or repeating what was just said.",
    "- You have already made this point. Look at your own earlier lines in the transcript: if what you are about to say is something you have said, stay quiet. Saying it again more insistently is worse than not saying it.",
    "- The conversation is flowing and does not need you.",
    "- You would be summarising what everyone in the room just heard for themselves.",
    "- You would be pushing them along or managing them. You are a guest, not the chair.",
    "- You are not confident. A wrong interjection costs far more than a missed one.",
    "",
    "When you do speak: one or two short sentences, spoken prose, no markdown or lists.",
    "Never invent a fact, a decision or a deadline.",
    "Describe things as the briefing describes them. If the briefing says a document is ready to send, it has NOT been sent — do not say it has. Offering to do something and having done it are different, and a room will act on the difference.",
    secondsSinceSheSpoke !== null
      ? `You last spoke ${Math.round(secondsSinceSheSpoke)} seconds ago${m.lastSaid ? `, and what you said was: "${m.lastSaid}"` : ""}.`
      : "You have not spoken yet beyond introducing yourself.",
  ].join("\n");

  const response = await client().messages.create({
    model: FAST,
    max_tokens: 400,
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
      { type: "text", text: brief(m) },
    ],
    tools: [VOLUNTEER_TOOL],
    tool_choice: { type: "tool", name: "contribute" },
    messages: [
      { role: "user", content: `The last few minutes:\n${transcriptText(recent)}\n\nSay something, or stay quiet?` },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return { worth_saying: false, say: "" };
  const out = block.input as { worth_saying?: boolean; say?: string };
  return { worth_saying: Boolean(out.worth_saying) && Boolean(out.say?.trim()), say: out.say?.trim() ?? "" };
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
          "ONLY the opening of the email: one line of context, then the actions as a numbered list with owners and dates. Stop there. The notes and the file links are appended after this automatically — do not write them here, do not refer to them as being 'below', and do not add a sign-off.",
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
function assemble(parts: { body: string; summary: string }, files: { name: string; link: string }[]): string {
  const sections = [parts.body.trim(), "", "NOTES", "", parts.summary.trim()];
  if (files.length) {
    sections.push("", "FILES", "", ...files.map((f) => `${f.name}: ${f.link}`));
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
          "- Plain, direct business English. No filler, no 'I hope this finds you well', no exclamation marks.",
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
    body: assemble(written, m.files),
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
