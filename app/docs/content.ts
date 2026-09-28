/**
 * The parts of /docs that change with nearly every piece of work: where things stand,
 * and what changed. Update this file in the same commit as the change it describes —
 * newest changelog entry first, and `UPDATED` set to its date.
 */

import type { Tone } from "./ui";

export const UPDATED = "2026-09-28";

/** Where things stand right now. */
export const STATUS: { label: string; value: string; tone: Tone }[] = [
  { label: "Mode", value: "Avatar — Anam face on her ElevenLabs voice", tone: "emerald" },
  { label: "Anam", value: "New account, fresh minutes — face live, tested in her container", tone: "emerald" },
  { label: "Teams", value: "Built — waiting for its first real call", tone: "sky" },
  { label: "Runner", value: "AWS EC2 server (2 vCPU, 4 GB), always on", tone: "emerald" },
];

export type Change = {
  date: string;
  title: string;
  points: string[];
  /** Short commit hashes, for anybody who wants the detail. */
  commits: string[];
  tone?: Tone;
};

export const CHANGELOG: Change[] = [
  {
    date: "2026-09-28",
    title: "She runs on a server now",
    points: [
      "Her container moved from a PC to an AWS EC2 server (Ubuntu 24.04, 2 vCPU, 4 GB), with her Google sign-in carried over — no new sign-in needed. Docker starts at boot and she restarts by herself.",
      "Her screen is online over HTTPS — Caddy in front with a Let's Encrypt certificate, her screen's own password behind it — and plain HTTP forwards to it. The server has 96 GB of disk and 4 GB of swap.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-28",
    title: "Teams: the notes go to the people in the meeting",
    points: [
      "The notes of a Teams call went only to whoever sent her from the control room — not to the people in it. That fallback is gone.",
      "Teams shows her nobody's email, so she asks in the meeting chat (and in her hello) and adds every address typed there to who gets the notes. Guests and Outlook users alike.",
      "Tested on the page saved from a real Teams call: she types into the chat box and picks up the addresses people type.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-28",
    title: "She keeps the thread, and stops confirming every fragment",
    points: [
      "Working notes: she keeps a short running note of any role or task she is given and where it stands, and reads it every turn. In a replay of the interview she lost, she now tracks the plan and answers “where are we?” from it.",
      "She sees about the last twenty minutes of the conversation instead of the last thirty caption lines — in Teams, barely a minute.",
      "Two different people speaking makes a call a group, whatever the page's count says (Teams had not shown the third person's tile, so she answered everything everybody said).",
      "She waits two seconds when a sentence trails off unfinished, confirms instructions once, greets once, and says nothing to “ok” or “yeah”.",
      "Teams: the People number is read from its button directly.",
    ],
    commits: ["08b8c32"],
    tone: "emerald",
  },
  {
    date: "2026-09-28",
    title: "Other notetakers do not count as people",
    points: [
      "When counting who is in the call she reads each participant's name and skips notetaker bots — Fireflies, Otter, Read.ai, Fathom, tl;dv and the like — so a bot left behind no longer keeps her, face on, in an empty meeting.",
      "Tested on the page saved from a real Teams call, and on a Meet page: with Fireflies present and everybody else gone, she counts herself alone. AVA_IGNORE_PARTICIPANTS adds more names.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-28",
    title: "A designed notes email; she leaves empty rooms",
    points: [
      "The notes now arrive as an NDI-branded email: actions first with owners and due dates, then the summary and files, with the plain text alongside.",
      "Nobody turns up: she leaves five minutes after the start time, and sends no notes. Everybody leaves: she waits five minutes in case they come back, then goes.",
      "Her face session closes within seconds of the room emptying, and comes back when somebody returns.",
      "She says hello, and connects her face, only once somebody else is there — waiting in an empty room costs no Anam minutes.",
      "Teams: people are counted from their tiles, as her snapshot of a real call showed.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-28",
    title: "Settings tidied; the site survives a missing Redis URL",
    points: [
      "The app's own settings now hold only what it uses: her face (Anam) and voice (ElevenLabs) are configured in her container.",
      "With KV_REST_API_URL deleted, every page that reads the meeting failed and her container could not reach the site. The address is now worked out from KV_URL, which the Upstash integration also sets.",
    ],
    commits: [],
    tone: "amber",
  },
  {
    date: "2026-09-28",
    title: "First Teams call: fixes",
    points: [
      "She joined Teams as a guest, was admitted, switched on live captions and said hello — the join works.",
      "Her tile was black: the Anam key on Vercel was refused, and the new avatar had no resting clip yet. She now shows her last resting clip, or a card with her name, and the key is cleaned of stray spaces and quotes.",
      "The end of a call must be seen three checks in a row, so Teams hiding its toolbar cannot make her leave.",
      "She keeps a snapshot of the Teams page 20 seconds in and when she leaves, to check her captions and people count against it.",
      "Sent with nobody listed for the notes, they now go to whoever sent her.",
      "Her container now asks Anam for face sessions itself (ANAM_API_KEY and ANAM_AVATAR_ID in bot/.env), so her face no longer depends on a key in the app's settings.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-28",
    title: "Smarter in group calls, and she leaves when everybody else has",
    points: [
      "Everything unanswered waits in a queue, so a question put to her is not lost when somebody else talks straight after it.",
      "In a group, Claude judges each pause: was any of it meant for her — a misheard name, “the assistant”, “can you note that”, a question to the room she can answer? Then she answers, even on quiet. Otherwise she volunteers as her activity level allows.",
      "An answer she has to hold back because somebody kept talking comes back at the next pause instead of vanishing.",
      "Captions mishear: she works out what was meant instead of asking people to repeat, and no longer corrects anyone who calls her “Eva”.",
      "She leaves 20 seconds after everybody else has (was 3 minutes), and closes her face session on every way out. Alone before anybody has arrived, she waits up to 15 minutes.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-28",
    title: "New Anam account",
    points: [
      "Her face moves to a new Anam account and avatar; tested: connects in about 2.4 s and lip-syncs to her ElevenLabs voice.",
      "Her face now needs only ANAM_API_KEY and ANAM_AVATAR_ID — no Anam voice, since she speaks with ElevenLabs.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-28",
    title: "Back in avatar mode; face sessions closed on the way out",
    points: [
      "She runs with her Anam face again. Until the Anam plan is upgraded (Free is 30/30 minutes) the face cannot connect, so she talks over her resting clip.",
      "When a meeting ends she now closes the Anam session herself before leaving, instead of leaving Anam to notice — no minutes billed after she has gone.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-28",
    title: "Microsoft Teams, sent from the control room",
    points: [
      "Paste a Teams link in the control room and press Send: her container picks it up within about ten seconds, opens it in her Chrome as a guest named Ava, and waits in the lobby to be admitted.",
      "She listens through Teams' live captions and talks with the same voice; the notes go to the recipients typed in the control room.",
      "Google Meet is unchanged: invites on her calendar, straight in as herself.",
      "Not yet tried on a real Teams call — the first one will show whether Teams' buttons and captions are where she expects.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-27",
    title: "These docs",
    points: ["This page: every module and feature in one place, kept up to date as the project changes."],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-27",
    title: "Avatar paused, voice only",
    points: [
      "Anam's Free plan ran out of minutes for the month, so the face could not reconnect after its session ended. Her voice carried on, as designed.",
      "Once Anam refuses for lack of minutes she stops retrying for the rest of the meeting, instead of making each answer wait up to 3.5 s.",
      "She runs in voice mode until a face option is chosen.",
    ],
    commits: ["d31eec6"],
    tone: "amber",
  },
  {
    date: "2026-09-27",
    title: "Her face lip-syncs to her own voice, and survives Anam's session limit",
    points: [
      "Her voice is always ElevenLabs; Anam only moves the avatar's lips to it (audio passthrough). No face, she speaks anyway.",
      "The camera is a canvas she draws on: the live face while she is in conversation, a looping clip of her at rest otherwise. Meet never sees it drop.",
      "The session is renewed before the plan's limit while she is quiet, and rests after 45 quiet seconds to save minutes.",
    ],
    commits: ["78cdd80", "762c799"],
    tone: "violet",
  },
  {
    date: "2026-09-27",
    title: "She takes turns",
    points: [
      "One answer per thing somebody says, at the pause — not one per rewrite of the caption.",
      "In a one-on-one call everything is said to her, so she answers without being named.",
      "A reply the person has already talked past is dropped; Meet tidying a caption no longer cuts her off.",
      "Her log says why she is quiet whenever that changes.",
    ],
    commits: ["3a08187"],
    tone: "emerald",
  },
  {
    date: "2026-09-27",
    title: "Voice-only mode, clean captions, and she answers to “Eva”",
    points: [
      "Voice mode: ElevenLabs straight into her microphone, nothing that can drop mid-meeting.",
      "Each Meet caption block keeps an id, so a sentence Meet rewrites stays one line in the transcript.",
      "Captions often hear “Ava” as “Eva”; both count. General-knowledge questions get real answers.",
    ],
    commits: ["708cadb"],
    tone: "sky",
  },
  {
    date: "2026-09-27",
    title: "Ava in person, on a server",
    points: [
      "Her own signed-in Chrome and her own Google account: invite ava@ like anybody else and she walks in at the start time.",
      "Runs as one Docker container with a virtual screen you can watch over the web.",
      "Her meetings' notes go out from her own Gmail, once.",
    ],
    commits: ["694def1", "283c969", "5df2452", "b8d494f", "8585837"],
    tone: "sky",
  },
  {
    date: "2026-09-19",
    title: "Interruptible, and talks like a person",
    points: ["She stops when somebody talks over her, keeps taking notes throughout, and speaks in plain conversational sentences."],
    commits: ["81543e6"],
  },
  {
    date: "2026-09-18",
    title: "From notetaker to participant",
    points: [
      "Captions were being thrown away; now she hears everything, and the “active” setting really changes how forward she is.",
      "A briefing replaced the agenda and clock; Anam replaced Simli + ElevenLabs for the (Recall-era) face.",
      "First version: control room, Recall bot, tick loop, notes and follow-up email.",
    ],
    commits: ["32c80e8", "7a30437", "290acf1", "a234d52", "6d0d12e", "0ceb21d", "af05983", "34f2813"],
  },
];
