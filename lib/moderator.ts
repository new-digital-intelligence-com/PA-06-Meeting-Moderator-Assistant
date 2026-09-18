/**
 * The half of the moderator that needs a model.
 *
 * Kept deliberately small. The agenda, the clock and the read-back are scripted in
 * `agenda.ts`; what is left here is the work no template can do — answering when
 * somebody talks to her, pulling actions out of the conversation, and writing the
 * follow-up afterwards.
 *
 * Every call here forces a tool so the reply comes back as a checked object rather
 * than prose we have to parse. In a live meeting a malformed JSON blob is a silence.
 */

import Anthropic from "@anthropic-ai/sdk";
import { transcriptText, type ActionItem, type Meeting, type TranscriptLine } from "./meeting";
import { timerView } from "./agenda";

/** Live replies must be quick — a slow answer lands after the moment has passed. */
const FAST = process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5";
/** The minutes are written once, off the clock, so quality wins over speed. */
const WRITER = process.env.ANTHROPIC_MODEL_WRITER ?? "claude-sonnet-5";

const client = () => new Anthropic();

export function botName() {
  return (process.env.BOT_NAME || "Ava").split("—")[0].trim();
}

/**
 * Is this line aimed at her? A word-boundary match on her name, not a substring —
 * otherwise "available" and "Avalon" summon her mid-sentence.
 *
 * Cheap on purpose: it runs on every line of the meeting, and the model only gets
 * involved once this says yes.
 */
export function isAddressed(text: string): boolean {
  const name = botName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${name}\\b`, "i").test(text);
}

function meetingBrief(m: Meeting): string {
  const t = timerView(m);
  const agenda = m.agenda
    .map((a, i) => `${i + 1}. ${a.title} (${a.minutes}m${a.owner ? `, ${a.owner}` : ""})${i === m.currentIndex ? "  ← open now" : ""}`)
    .join("\n");
  const actions = m.actions.length
    ? m.actions.map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.text}${a.due ? ` (by ${a.due})` : ""}`).join("\n")
    : "(none captured yet)";
  return [
    `Meeting: ${m.title}`,
    `Agenda:\n${agenda || "(no agenda)"}`,
    t.title
      ? `Open item: ${t.title} — ${Math.floor(t.elapsed / 60)}m elapsed of ${Math.floor(t.planned / 60)}m${t.overrunning ? ", OVER TIME" : ""}.`
      : "No agenda item is open.",
    `Actions so far:\n${actions}`,
  ].join("\n\n");
}

/* ------------------------------------------------------- answering out loud */

const REPLY_TOOL: Anthropic.Tool = {
  name: "reply",
  description: "Your spoken reply to the room, plus any bookkeeping it implies.",
  input_schema: {
    type: "object",
    properties: {
      say: {
        type: "string",
        description:
          "What to say out loud. One or two short sentences of plain speech — no markdown, lists, emoji or URLs. Empty string if the remark was not really for you and no answer is needed.",
      },
      add_actions: {
        type: "array",
        description: "Actions the speaker just asked you to record. Usually empty.",
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
      advance: {
        type: "boolean",
        description: "True only if you were explicitly asked to move on to the next agenda item.",
      },
    },
    required: ["say"],
  },
};

export type ModeratorReply = {
  say: string;
  add_actions?: { text: string; owner?: string; due?: string }[];
  advance?: boolean;
};

const REPLY_SYSTEM = [
  `You are ${botName()}, moderating a live video meeting. You are a participant in the call and your words are spoken aloud, immediately, to everyone.`,
  "",
  "Somebody just said your name. Answer them.",
  "",
  "- One or two short sentences. Spoken prose only: no markdown, no bullets, no URLs, no emoji.",
  "- You are the moderator, not the chair. Answer about the agenda, the time, the notes and the actions. Do not opine on the substance of their work or take sides in their decisions.",
  "- If you are asked to note something down, record it with add_actions and confirm in a few words.",
  "- If you are asked to move on, set advance and say one short line handing over.",
  "- If your name came up in passing and nothing was asked of you, return an empty say. Saying nothing is a valid and often correct answer — interrupting a meeting you were not asked into is the worst thing you can do.",
  "- Never invent an action, a decision or a deadline that was not said out loud.",
].join("\n");

export async function answerAddressed(
  m: Meeting,
  line: TranscriptLine,
  recent: TranscriptLine[],
): Promise<ModeratorReply> {
  const response = await client().messages.create({
    model: FAST,
    max_tokens: 500,
    system: [
      { type: "text", text: REPLY_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: meetingBrief(m) },
    ],
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: "reply" },
    messages: [
      {
        role: "user",
        content: [
          "The last minute of the meeting:",
          transcriptText(recent),
          "",
          `${line.speaker} just said, addressing you directly: "${line.text}"`,
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return { say: "" };
  return block.input as ModeratorReply;
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
            due: { type: "string", description: "Plain-language deadline if one was said. Omit otherwise — never guess one." },
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
  "- Do not repeat an action that is already in the captured list. Say nothing rather than duplicate it.",
  "- Half-formed intentions ('we should probably look at that sometime') are not actions.",
  "- Never invent an owner or a deadline. If it was not said, leave the field out.",
  "- Most stretches of most meetings contain no action at all. Returning two empty arrays is the common, correct outcome.",
  "- The transcript is live captions: it will contain mishearings. Do not turn a garbled phrase into a confident action.",
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
      { type: "text", text: `Already captured:\n${captured}` },
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
  description: "The minutes and the follow-up email.",
  input_schema: {
    type: "object",
    properties: {
      minutes: {
        type: "string",
        description:
          "The minutes as markdown: a short paragraph per agenda item covering what was discussed and settled. No preamble, no sign-off — this is the record, not a letter.",
      },
      subject: { type: "string", description: "Email subject line." },
      body: {
        type: "string",
        description:
          "The email as plain text. Short: a line of context, the actions as a numbered list with owners and dates, the attached files, and a one-line close. It goes to people who were in the room — do not recap the whole meeting at them.",
      },
    },
    required: ["minutes", "subject", "body"],
  },
};

export async function composeFollowUp(m: Meeting, senderName: string): Promise<{
  minutes: string;
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
    max_tokens: 3000,
    system: [
      {
        type: "text",
        text: [
          `You are ${botName()}, writing up a meeting you moderated. The email is sent from ${senderName}'s account, so write it as something they are happy to put their name to.`,
          "",
          "- Plain, direct business English. No filler, no 'I hope this finds you well', no exclamation marks.",
          "- The actions are the point of the email. Put them first and make them unmissable.",
          "- Include every file link exactly as given. Do not invent links.",
          "- The transcript is live captions and contains mishearings. Where something is garbled, write around it rather than repeating nonsense confidently.",
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
          `Meeting: ${m.title}`,
          `Agenda:\n${m.agenda.map((a, i) => `${i + 1}. ${a.title}`).join("\n") || "(none)"}`,
          `Actions captured:\n${actionList}`,
          `Files shared:\n${fileList}`,
          "",
          "Full transcript:",
          transcriptText(m.transcript).slice(0, 120_000),
        ].join("\n"),
      },
    ],
  });

  const block = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("The model did not return a follow-up.");
  return block.input as { minutes: string; subject: string; body: string };
}

/** Merge freshly found actions into the meeting, skipping ones we already have. */
export function mergeActions(existing: ActionItem[], found: { text: string; owner?: string; due?: string }[]): ActionItem[] {
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
      confirmed: false,
    });
  }
  return added;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
