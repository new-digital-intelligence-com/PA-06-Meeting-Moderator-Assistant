import type { Metadata } from "next";
import Link from "next/link";
import Nav from "./Nav";
import { CHANGELOG, STATUS, UPDATED } from "./content";
import { C, Callout, Card, Chip, CodeBlock, Decision, Dot, FileRow, Section, Stat, Steps, Table } from "./ui";

/**
 * /docs — what Ava is, how each part works, and how to run her.
 *
 * Keep it true: when a feature changes, change the section that describes it, and add
 * a line to the changelog in ./content.ts in the same commit.
 */

export const metadata: Metadata = {
  title: "Docs — Ava, Meeting Moderator",
  description: "How Ava works: the meeting flow, when she talks, her voice and face, the notes, every module, and how to run her.",
};

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "flow", label: "A meeting, start to finish" },
  { id: "architecture", label: "How it’s built" },
  { id: "talking", label: "When she talks" },
  { id: "voice", label: "Voice and face" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "languages", label: "Languages" },
  { id: "notes", label: "Notes and follow-up" },
  { id: "brain", label: "Modules: the brain" },
  { id: "runner", label: "Modules: the runner" },
  { id: "api", label: "API routes" },
  { id: "config", label: "Configuration" },
  { id: "operate", label: "Running her" },
  { id: "limits", label: "Limits and costs" },
  { id: "changelog", label: "Changelog" },
];

const fmt = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export default function Docs() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm text-white/45 hover:text-white/80">
          ← Control room
        </Link>
        <p className="text-xs text-white/35">Updated {fmt(UPDATED)}</p>
      </header>

      <div className="mt-6 lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-12">
        {/* On phones the aside dissolves, so its strip can stick for the whole page. */}
        <aside className="contents lg:block">
          <Nav sections={SECTIONS} />
        </aside>

        <main className="min-w-0">
          {/* ── overview ─────────────────────────────────────────────────── */}
          <section id="overview" className="scroll-mt-24 pt-6 lg:pt-0">
            <Chip tone="sky">Docs</Chip>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Ava, the meeting participant</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-white/60">
              Ava joins your <strong className="font-semibold text-white/85">Google Meet</strong> as a normal member, with her own
              Google account. Invite her like anybody else: she turns up at the start time, listens, answers and joins in out
              loud, takes notes, and emails the write-up to the guests when it ends. She can also be sent into a{" "}
              <strong className="font-semibold text-white/85">Microsoft Teams</strong> meeting from the control room.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {STATUS.map((s) => (
                <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
                    <Dot tone={s.tone} /> {s.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-white/75">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Card tone="sky" kicker="Before" title="Reads her briefing">
                The invite’s description is what she knows about the meeting; its guests are who gets the notes.
              </Card>
              <Card tone="emerald" kicker="During" title="Talks like a participant">
                Answers when named, answers everything in a one-on-one, and adds something useful in a group.
              </Card>
              <Card tone="violet" kicker="After" title="Sends the notes">
                A write-up with decisions and actions, from her own Gmail, once.
              </Card>
            </div>
          </section>

          <div className="mt-12 space-y-4">
            {/* ── flow ─────────────────────────────────────────────────── */}
            <Section
              id="flow"
              eyebrow="The flow"
              title="A meeting, start to finish"
              intro="Nothing to click during a meeting. It starts from a calendar invite — or from the control room, where you paste any Meet or Teams link and press Send."
            >
              <Steps
                items={[
                  {
                    title: "You invite ava@new-digital-intelligence.com",
                    body: "From Google Calendar, like any guest. Write what the meeting is about in the description: that is her briefing.",
                    tone: "sky",
                  },
                  {
                    title: "Her runner notices",
                    body: (
                      <>
                        It reads her calendar every 60 seconds. Declined meetings, all-day entries and anything without a Meet link
                        are ignored. It opens the meeting a minute before the start (<C>AVA_JOIN_EARLY_SECONDS</C>).
                      </>
                    ),
                    tone: "sky",
                  },
                  {
                    title: "She walks in as herself",
                    body: "A real Chrome, signed in as Ava, presses “Join now”. She is invited and in the organisation, so there is no knocking. Meet asks the browser for a microphone and gets her voice.",
                    tone: "emerald",
                  },
                  {
                    title: "She introduces herself",
                    body: "Once somebody else is there — not to an empty room. One fixed line: who she is, that she is taking notes. Scripted, so it cannot fail or ramble.",
                    tone: "emerald",
                  },
                  {
                    title: "She listens",
                    body: "Meet’s own live captions, with real speaker names, are her ears. Each caption goes to the brain.",
                    tone: "emerald",
                  },
                  {
                    title: "She takes her turn",
                    body: (
                      <>
                        When somebody pauses, the brain decides whether and what to answer (see{" "}
                        <a href="#talking" className="text-sky-300 underline decoration-sky-400/40">When she talks</a>). The reply is
                        spoken with her ElevenLabs voice.
                      </>
                    ),
                    tone: "emerald",
                  },
                  {
                    title: "She leaves",
                    body: "When the meeting ends, when she is removed, five minutes after everybody else has left, five minutes after the start time if nobody turned up, or when it is ended from the control room. She knows she is alone from the names on the meeting's own participant tiles — other notetaker bots (Fireflies, Otter, Read.ai…) do not count as people — and from its “you're the only one here”. Her face session is closed on the way out.",
                    tone: "violet",
                  },
                  {
                    title: "The notes go out",
                    body: "The transcript is written up — summary, decisions, actions with owners — and emailed to the guests from her own Gmail. Once per meeting.",
                    tone: "violet",
                  },
                ]}
              />
            </Section>

            {/* ── architecture ─────────────────────────────────────────── */}
            <Section
              id="architecture"
              eyebrow="Architecture"
              title="How it’s built"
              intro="Two parts that talk over HTTPS: a brain that decides and remembers, and a body that is in the meeting."
            >
              <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <Card tone="slate" kicker="Where it happens" title="Google Meet & Calendar" className="h-full">
                  <ul className="space-y-1">
                    <li>Her calendar: the invites</li>
                    <li>The call itself</li>
                    <li>Live captions with speaker names</li>
                  </ul>
                </Card>
                <div className="flex items-center justify-center text-base text-white/35 lg:flex-col">
                  <span className="lg:hidden">↓ ↑</span>
                  <span className="hidden lg:block">⇄</span>
                </div>
                <Card tone="sky" kicker="The body · bot/" title="Runner container" className="h-full">
                  <ul className="space-y-1">
                    <li>Chrome signed in as Ava, on a virtual screen</li>
                    <li>Reads captions, speaks into her mic</li>
                    <li>Watches her calendar, joins, leaves</li>
                    <li>Calls ElevenLabs for her voice</li>
                  </ul>
                </Card>
                <div className="flex items-center justify-center text-base text-white/35 lg:flex-col">
                  <span className="lg:hidden">↓ ↑</span>
                  <span className="hidden lg:block">⇄</span>
                </div>
                <Card tone="emerald" kicker="The brain · Vercel" title="Next.js web app" className="h-full">
                  <ul className="space-y-1">
                    <li>Decides when and what she says</li>
                    <li>Keeps the transcript and actions</li>
                    <li>Writes and sends the notes</li>
                    <li>Holds her Google access, encrypted</li>
                  </ul>
                </Card>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat value="Claude" label="Haiku 4.5 live · Sonnet 5 for the write-up" />
                <Stat value="ElevenLabs" label="Her voice · Flash v2.5" />
                <Stat value="Upstash Redis" label="The meeting state" />
                <Stat value="Google APIs" label="Calendar, Gmail, Drive" />
                <Stat value="Anam" label="Her face · Cara, lip-synced" />
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Callout tone="sky" title="The runner never decides anything">
                  It sends what it heard to <C>/api/moderator/tick</C> every 1.2 seconds (sooner when somebody pauses) and says
                  whatever comes back. Swapping the body — Recall bot then, her own Chrome now — did not need a second brain.
                </Callout>
                <Callout tone="emerald" title="Only the runner may act as her">
                  Reading her calendar, marking her as attending and mailing as her need the shared <C>AVA_RUNNER_KEY</C>. A
                  stranger who finds the URL gets none of that.
                </Callout>
              </div>
            </Section>

            {/* ── talking ──────────────────────────────────────────────── */}
            <Section
              id="talking"
              eyebrow="Turn-taking"
              title="When she talks"
              intro="She works in turns, like a person on a call. Everything said that she has not dealt with waits in a queue; at each pause she deals with all of it, once. Every heartbeat runs down this list."
            >
              <div>
                <Decision ask="Is she already speaking?" yes="Wait. Nothing new until she finishes." tone="slate" />
                <Decision ask="Has she introduced herself yet?" yes="Say the opening line." tone="emerald" />
                <Decision
                  ask="Is her queue empty?"
                  note="Meet rewrites captions as a sentence goes on, so a line only counts as new again once it grows by more than that. Anything unanswered for a minute has passed."
                  yes="Keep listening."
                  tone="slate"
                />
                <Decision
                  ask="Is somebody still talking?"
                  note="Less than a second since the last caption — two if the sentence trails off unfinished. The queue keeps: a question put to her while others talk on is answered at the next pause."
                  yes="Wait for the pause."
                  tone="slate"
                />
                <Decision ask="Is her name anywhere in it — “Ava”, “Eva”, “Iva”…?" yes="Answer them." tone="emerald" />
                <Decision
                  ask="Is it just her and one other person?"
                  note="Two different people speaking makes it a group, whatever the page shows. Otherwise the people in the call."
                  yes="Answer — everything is said to her."
                  tone="emerald"
                />
                <Decision
                  last
                  ask="A group, and no name: Claude judges it"
                  note="Was any of it meant for her — a misheard name, “the assistant”, “can you note that”, a question to the room she can answer? Then she answers, whatever the setting. If not, she may volunteer: active after 8 s, balanced after 30 s and only when it matters, quiet never; 3 s after a question to the room."
                  yes="Answer, add something useful, or stay quiet."
                  tone="sky"
                />
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                <Card title="She can be interrupted">
                  Three new words from somebody else while she is talking and she stops, like a person would. Meet correcting an
                  old caption does not count.
                </Card>
                <Card title="Held back, never lost">
                  If somebody carries on talking while her reply is being prepared, she holds it back and answers at the next pause,
                  with what was said since. An answer to her is held back once at most.
                </Card>
                <Card title="What she knows">
                  General questions get a real answer from her own knowledge. Facts about this company, these people or this
                  project come only from the briefing and what was said — otherwise she says she does not know. Captions mishear:
                  she works out what was meant rather than asking people to repeat, and never corrects anyone on her name.
                </Card>
                <Card title="Her working notes">
                  She keeps a short note of any role or task she has been given — “interviewer: three questions each, then
                  evaluate; done Q1 Helmi, next Q1 Sami” — updates it as the meeting goes, and reads it every turn, with the last
                  twenty-odd minutes of the conversation. That is how she keeps the thread.
                </Card>
                <Card title="Why is she quiet?">
                  Every change of reason is logged by the runner (<C>· listening — nothing new…</C>) and stored with the meeting
                  as <C>lastDecision</C>.
                </Card>
              </div>
            </Section>

            {/* ── voice ────────────────────────────────────────────────── */}
            <Section
              id="voice"
              eyebrow="Presence"
              title="Voice and face"
              intro={
                <>
                  Set by <C>AVA_MODE</C> in the runner. Her voice is the same in both; avatar mode adds a face.
                </>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Card tone="emerald" kicker="Default" title="Voice mode">
                  <p>
                    She joins camera-off with her Google profile photo. Each reply is turned into speech by ElevenLabs and played
                    into a microphone track that exists only in her browser.
                  </p>
                  <p className="mt-2">One request per sentence, nothing held open — so nothing can drop mid-meeting.</p>
                </Card>
                <Card tone="violet" kicker="In use" title="Avatar mode">
                  <p>
                    Her camera is a canvas. While she is in conversation it shows her Anam face, lip-synced to the same
                    ElevenLabs audio. Otherwise it crossfades to a looping clip of her at rest, filmed once from the live face and
                    kept for later meetings.
                  </p>
                  <p className="mt-2">If the face is not there, she speaks anyway.</p>
                </Card>
              </div>

              <div className="mt-6">
                <Table
                  head={["Avatar detail", "How it works"]}
                  rows={[
                    ["Anam’s session limit", "Renewed while she is quiet, 30 s before the plan’s limit (ANAM_SESSION_SECONDS). The clip covers the ~1.5 s reconnect."],
                    ["Saving minutes", "The face rests after 45 quiet seconds (AVA_FACE_IDLE_SECONDS) and reconnects as soon as somebody talks to her."],
                    ["Lost mid-sentence", "She finishes the sentence without the face, from where it was cut."],
                    ["Out of minutes", "Anam refuses; she stops retrying for that meeting and carries on with her voice."],
                    ["No face at all", "Her last resting clip — or, before one exists, a card with her name. Never a black tile."],
                    ["Empty room", "The face connects only once somebody else is in the meeting, and is closed within seconds when everybody leaves; the camera shows her at rest, at no cost. It comes back the moment somebody returns."],
                    ["Meeting over", "She closes the face session herself before leaving, so Anam does not bill until it notices she has gone."],
                  ]}
                />
              </div>
            </Section>

            {/* ── teams ────────────────────────────────────────────────── */}
            <Section
              id="teams"
              eyebrow="Second platform"
              title="Microsoft Teams"
              intro="Teams meetings never reach her calendar, so she is sent from the control room. Everything after she is in — listening, talking, notes — is the same as in Meet."
            >
              <Steps
                items={[
                  {
                    title: "Paste the Teams link in the control room",
                    body: "With the briefing and anybody you already know should get the notes, then press Send (or set a time to book her for later).",
                    tone: "sky",
                  },
                  {
                    title: "Her container picks it up",
                    body: "It asks the app every 10 seconds whether she has been sent anywhere, and takes each meeting once.",
                    tone: "sky",
                  },
                  {
                    title: "She joins as a guest",
                    body: "No Microsoft account: “Continue on this browser”, name Ava, microphone on, Join now.",
                    tone: "emerald",
                  },
                  {
                    title: "Somebody admits her from the lobby",
                    body: "She waits up to 20 minutes. Teams shows her as a guest.",
                    tone: "amber",
                  },
                  {
                    title: "She asks for emails in the chat",
                    body: "Teams shows her nobody’s email address, so once somebody is there she posts in the meeting chat — and says in her hello — that anyone who wants the notes can type their email there. Every address typed in the chat is added to who gets the notes.",
                    tone: "sky",
                  },
                  {
                    title: "Live captions on, and she is in",
                    body: "More → Language and speech → Turn on live captions. From here it is the same brain as Meet.",
                    tone: "emerald",
                  },
                ]}
              />
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Callout tone="amber" title="Depends on the other company’s Teams settings">
                  Their IT can turn off guest joining or live captions. If they have, she cannot get in, or cannot hear.
                </Callout>
                <Callout tone="sky" title="What she saw">
                  She saves a screenshot and the page to her disk (<C>/data/debug-teams-*.png</C>) when a step fails, 20 seconds
                  into each call, and when she decides the call is over — Teams changes its pages without notice.
                </Callout>
              </div>
            </Section>

            {/* ── languages ────────────────────────────────────────────── */}
            <Section
              id="languages"
              eyebrow="English · Deutsch · العربية"
              title="Languages"
              intro="She works in English, German and Arabic — one language per meeting, because Meet and Teams caption a single spoken language, set in their caption settings."
            >
              <Table
                head={["Step", "How the language is used"]}
                rows={[
                  ["Choosing it", "In the control room (English / Deutsch / العربية). For calendar meetings, from the invite: “Language: German” decides; otherwise the language the invite is written in."],
                  ["Her ears", "She switches the meeting’s captions to that language as she joins — Meet’s “Meeting language”, Teams’ spoken language. Arabic uses Maghrebi captions unless AVA_ARABIC_CAPTIONS says otherwise."],
                  ["Her replies", "Claude answers in the meeting’s language (Modern Standard Arabic for Arabic), or in another if somebody clearly speaks to her in it."],
                  ["Her voice", "ElevenLabs Flash v2.5 is multilingual and is told which language it is reading; a voice of its own per language is optional."],
                  ["Her name", "Recognised in Arabic script too — آفا, إيفا."],
                  ["Hello and chat", "Her opening line and her Teams chat message are in the meeting’s language."],
                  ["The notes", "Written in the meeting’s language; the email’s labels and dates follow, right to left for Arabic."],
                ]}
              />
              <p className="mt-3 text-xs text-white/40">
                Switching language in the middle of a meeting is not something captions can follow; that would need a speech-to-speech model.
              </p>
            </Section>

            {/* ── notes ────────────────────────────────────────────────── */}
            <Section id="notes" eyebrow="Afterwards" title="Notes and follow-up">
              <div className="grid gap-4 md:grid-cols-3">
                <Card tone="sky" title="Actions and decisions">
                  When the meeting ends, the transcript is read for who committed to what, and by when (Haiku). Asked to “note
                  that down” during the meeting, she adds it straight away.
                </Card>
                <Card tone="violet" title="The write-up">
                  Summary, decisions, and actions with owners and dates, written from the whole transcript (Sonnet).
                </Card>
                <Card tone="emerald" title="Sent as her, once">
                  Her meetings’ notes go from Ava’s Gmail to the invite’s guests — not meeting rooms, not herself. A second “send”
                  for the same meeting is ignored; an edited resend is deliberate.
                </Card>
                <Card tone="slate" title="A designed email">
                  NDI-branded HTML — the actions first, each with its owner and due date, then the summary and any files — with the
                  plain text alongside for mail apps that do not show HTML. Built from the text you can edit, so edits show up too.
                  Nobody came, no email.
                </Card>
              </div>
            </Section>

            {/* ── brain modules ────────────────────────────────────────── */}
            <Section id="brain" eyebrow="Modules" title="The brain — web app" intro="Next.js on Vercel. The meeting lives in Redis, so every serverless instance sees the same one.">
              <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.02] px-5">
                <FileRow path="app/api/moderator/tick" tag={<Chip tone="emerald">the heart</Chip>}>
                  Takes what was heard, folds it into the transcript, and decides the one thing to say now — the turn-taking above.
                </FileRow>
                <FileRow path="lib/moderator.ts">
                  Everything that needs Claude: answering, deciding whether to chime in, pulling out actions, writing the follow-up.
                  Also her speaking style.
                </FileRow>
                <FileRow path="lib/script.ts">The lines she says without a model: the opening and the goodbye.</FileRow>
                <FileRow path="lib/meeting.ts">
                  The meeting: briefing, status, transcript, actions, pacing, cooldowns. Old stored shapes are migrated on read.
                </FileRow>
                <FileRow path="lib/store.ts">Where it is kept: Redis, MongoDB, or a local file in development.</FileRow>
                <FileRow path="lib/ava.ts">Her own Google access, stored encrypted on the server; the runner-key check.</FileRow>
                <FileRow path="lib/workspace.ts">Calendar (her invites), Gmail (drafts and sending), Drive (search and sharing).</FileRow>
                <FileRow path="lib/email.ts">The NDI-branded notes email, built from the plain-text notes.</FileRow>
                <FileRow path="lib/google.ts · lib/session.ts">Google OAuth and the encrypted session cookie for whoever uses the control room.</FileRow>
                <FileRow path="lib/anam.ts">Short-lived Anam tokens: a lip-sync-only face, or the older full persona.</FileRow>
                <FileRow path="lib/platform.ts">Which product a link is — Google Meet or Microsoft Teams.</FileRow>
                <FileRow path="app/api/ava/dispatch">
                  Where her runner asks “have I been sent anywhere?” — each meeting sent from the control room is taken once.
                </FileRow>
                <FileRow path="components/ControlRoom.tsx">
                  The page at <C>/</C>: brief her, send her to any Meet or Teams link (or book her for later), see the transcript
                  and actions live, end a meeting, edit and resend notes.
                </FileRow>
                <FileRow path="lib/recall.ts · app/bot · components/Stage.tsx" tag={<Chip>older path</Chip>}>
                  The Recall bot she used before she had her own Chrome. Still works; not the recommended way.
                </FileRow>
              </div>
            </Section>

            {/* ── runner modules ───────────────────────────────────────── */}
            <Section id="runner" eyebrow="Modules" title="The runner — bot/" intro="One Docker container: Node, Google Chrome, a virtual screen, and a web view of that screen.">
              <div className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/[0.02] px-5">
                <FileRow path="watch.mjs" tag={<Chip tone="sky">entry point</Chip>}>
                  On duty: checks she is signed in, reads her calendar every minute and the control room every 10 seconds, attends
                  each meeting, remembers which ones she already did.
                </FileRow>
                <FileRow path="lib/meet.mjs">
                  One meeting, on either platform: brief the brain, open Chrome, join, turn captions on, run the heartbeat, speak,
                  notice the end, leave, send the notes.
                </FileRow>
                <FileRow path="lib/platforms.mjs">
                  What differs between Google Meet and Teams: getting in, switching captions on, telling the call is over,
                  leaving.
                </FileRow>
                <FileRow path="inject/ava.ts">
                  Runs inside the Meet or Teams page before its own code: answers its request for a microphone (and camera) with
                  her, reads the captions, plays her voice, draws her face.
                </FileRow>
                <FileRow path="lib/voice.mjs">ElevenLabs text-to-speech: mp3 for voice mode, raw audio for the face to lip-sync to.</FileRow>
                <FileRow path="lib/account.mjs">Is she signed in to Google? If not, opens a sign-in window instead of joining as a stranger.</FileRow>
                <FileRow path="lib/app.mjs">
                  Every call to the brain, with her runner key — and her face sessions, straight from Anam when the key is set here.
                </FileRow>
                <FileRow path="lib/config.mjs">Settings: app address, mode, face limits, Chrome profile, where state is kept.</FileRow>
                <FileRow path="check.mjs · login.mjs · join.mjs">
                  Tools: test her voice and face on a pre-join screen without joining, sign her in, join one link by hand.
                </FileRow>
                <FileRow path="Dockerfile · start.sh · docker-compose.yml">
                  The container: Chrome, virtual screen, password-protected web view of it, and a disk at <C>/data</C> for her
                  profile.
                </FileRow>
              </div>
            </Section>

            {/* ── api ──────────────────────────────────────────────────── */}
            <Section id="api" eyebrow="Reference" title="API routes">
              <Table
                head={["Route", "Called by", "Does"]}
                rows={[
                  [<C key="r">POST /api/moderator/tick</C>, "Runner", "What was heard in; what to say out"],
                  [<C key="r">GET /api/ava/upcoming</C>, "Runner (key)", "Her invites for the next hours"],
                  [<C key="r">POST /api/ava/dispatch</C>, "Runner (key)", "Take a meeting sent from the control room"],
                  [<C key="r">GET · PUT · DELETE /api/meeting</C>, "Runner, control room", "Read, brief or clear the meeting"],
                  [<C key="r">POST /api/meeting/control</C>, "Runner, control room", "attend · dispatch · stop · rehearse"],
                  [<C key="r">POST · PUT /api/meeting/followup</C>, "Runner, control room", "Write the notes; send or re-send them"],
                  [<C key="r">POST · PUT /api/moderator/notes</C>, "Recall stage", "Pull actions from new transcript as it goes; edit them"],
                  [<C key="r">POST /api/anam</C>, "Runner", "A short-lived token for her face"],
                  [<C key="r">GET /api/auth/google</C>, "You", "Connect Google (?as=ava for her account)"],
                  [<C key="r">/api/calendar · /api/drive</C>, "Control room", "Your meetings; find and share files"],
                  [<C key="r">POST /api/meeting/start</C>, "Control room", "Send the Recall bot (older path)"],
                ]}
              />
            </Section>

            {/* ── config ───────────────────────────────────────────────── */}
            <Section id="config" eyebrow="Reference" title="Configuration" intro="Names only — values live in Vercel and in bot/.env, never in the repo.">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-3 text-sm font-semibold text-white/80">Web app (Vercel)</h3>
                  <Table
                    head={["Variable", "For"]}
                    rows={[
                      [<C key="v">ANTHROPIC_API_KEY</C>, "Claude"],
                      [<C key="v">ANTHROPIC_MODEL_FAST · _WRITER</C>, "Override the live and write-up models"],
                      [<C key="v">KV_REST_API_TOKEN · KV_REST_API_URL</C>, "Redis for the meeting state — required; the URL is worked out from KV_URL if missing"],
                      [<C key="v">GOOGLE_CLIENT_ID · _SECRET · _REDIRECT_URI</C>, "Google sign-in"],
                      [<C key="v">SESSION_SECRET</C>, "Encrypts sessions and her stored access"],
                      [<C key="v">AVA_RUNNER_KEY</C>, "Shared with the runner"],
                      [<C key="v">AVA_EMAIL</C>, "Her address; any other is refused"],
                      [<C key="v">AVA_ALIASES</C>, "Other spellings of her name (default Eva, Iva, Eeva, Ayva, Avah)"],
                      [<C key="v">BOT_NAME</C>, "Her name"],
                      [<C key="v">RECALL_API_KEY · RECALL_REGION</C>, "Only the Send button on a Google Meet link (the older Recall bot)"],
                    ]}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="mb-3 text-sm font-semibold text-white/80">Runner (bot/.env)</h3>
                  <Table
                    head={["Variable", "For"]}
                    rows={[
                      [<C key="v">AVA_APP_URL</C>, "The brain’s address"],
                      [<C key="v">AVA_RUNNER_KEY</C>, "Same value as the app"],
                      [<C key="v">AVA_ADMIN_PASSWORD</C>, "The web view of her screen"],
                      [<C key="v">AVA_MODE</C>, "voice or avatar"],
                      [<C key="v">AVA_DISPLAY_NAME</C>, "Her name as a Teams guest (Ava)"],
                      [<C key="v">ELEVENLABS_VOICE_ID_DE · _AR</C>, "Optional: a voice of her own per language"],
                      [<C key="v">AVA_ARABIC_CAPTIONS</C>, "Which Arabic Meet listens for (Maghrebi)"],
                      [<C key="v">ELEVENLABS_API_KEY · _VOICE_ID</C>, "Her voice"],
                      [<C key="v">AVA_JOIN_EARLY_SECONDS</C>, "How early she opens a meeting (60)"],
                      [<C key="v">ANAM_SESSION_SECONDS</C>, "Your Anam plan’s session limit (180)"],
                      [<C key="v">AVA_FACE_IDLE_SECONDS</C>, "Quiet seconds before the face rests (45)"],
                      [<C key="v">ANAM_API_KEY · ANAM_AVATAR_ID</C>, "Her face — she asks Anam herself (else the app does)"],
                      [<C key="v">AVA_SCREEN_PORT</C>, "Port for the web view (8080)"],
                      [<C key="v">AVA_IGNORE_PARTICIPANTS</C>, "More bot names not to count as people, comma-separated"],
                    ]}
                  />
                </div>
              </div>
            </Section>

            {/* ── operate ──────────────────────────────────────────────── */}
            <Section id="operate" eyebrow="Operations" title="Running her" intro={<>From the <C>bot/</C> folder, on the machine that runs the container.</>}>
              <div className="grid gap-4 lg:grid-cols-2">
                <CodeBlock title="start, stop, watch">{`docker compose up -d --build   # build and start (after a code change)
docker compose start           # start again
docker compose stop            # stop — she will not join meetings
docker compose logs -f         # follow what she is doing`}</CodeBlock>
                <CodeBlock title="her screen">{`# online, over HTTPS (COMPOSE_PROFILES=public)
https://<AVA_SCREEN_HOST>          user: ava

# or privately, through an SSH tunnel
ssh -L 8080:localhost:8080 ubuntu@<server>
http://localhost:8080/vnc.html`}</CodeBlock>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <Card title="Signed out?">She stops and opens a Google sign-in window. Sign her in on her screen and close it.</Card>
                <Card title="Test without a meeting">
                  <C>npm run check -- &lt;Meet or Teams link&gt;</C> goes as far as the pre-join screen, speaks a line, and never
                  joins.
                </Card>
                <Card title="Switch to the face">
                  Set <C>AVA_MODE=avatar</C> in <C>bot/.env</C>, then <C>docker compose up -d</C>.
                </Card>
              </div>
            </Section>

            {/* ── limits ───────────────────────────────────────────────── */}
            <Section id="limits" eyebrow="Know before you rely on it" title="Limits and costs">
              <Table
                head={["", "Limit", "Cost"]}
                rows={[
                  ["ElevenLabs", "Free plan about 10,000 credits a month — roughly 130 replies", "Starter about $5 a month"],
                  ["Anam (face)", "Free: 3-minute sessions, 30 minutes a month", "Starter $12 · Explorer $49 · Growth $299 a month"],
                  ["Claude", "—", "A few cents a meeting"],
                  ["Meet captions", "As good as Google’s captions; English", "Free"],
                  ["Teams", "Guest only: waits in the lobby; needs the organiser’s company to allow guests and captions", "Free"],
                  ["Runner", "One meeting at a time", "A small VPS, about €5–25 a month"],
                ]}
              />
              <p className="mt-3 text-xs text-white/35">Prices as last checked; providers change them.</p>
            </Section>

            {/* ── changelog ────────────────────────────────────────────── */}
            <Section id="changelog" eyebrow="History" title="Changelog">
              <ol className="space-y-4">
                {CHANGELOG.map((c) => (
                  <li key={`${c.date}-${c.title}`} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={c.tone ?? "slate"}>{fmt(c.date)}</Chip>
                      <h3 className="font-semibold text-white">{c.title}</h3>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-sm leading-6 text-white/60">
                      {c.points.map((p) => (
                        <li key={p} className="flex gap-2">
                          <span className="mt-2.5 size-1 shrink-0 rounded-full bg-white/30" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                    {c.commits.length ? (
                      <p className="mt-3 font-mono text-xs text-white/30">{c.commits.join(" · ")}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </Section>
          </div>
        </main>
      </div>
    </div>
  );
}
