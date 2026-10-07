import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
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
  { id: "brains", label: "Two brains" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "languages", label: "Languages" },
  { id: "notes", label: "Notes and follow-up" },
  { id: "clients", label: "Clients and their knowledge" },
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
        <Link href="/" className="group flex items-center gap-2.5">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">Ava</span>
          <span className="text-sm text-slate-500 transition group-hover:text-slate-900">← back to the app</span>
        </Link>
        <p className="text-xs text-slate-400">Updated {fmt(UPDATED)}</p>
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
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Ava, the meeting participant</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
              Ava joins your <strong className="font-semibold text-slate-800">Google Meet</strong> as a normal member, with her own
              Google account. Invite her like anybody else: she turns up at the start time, listens, answers and joins in out
              loud, takes notes, and emails the write-up to the guests when it ends. To a{" "}
              <strong className="font-semibold text-slate-800">Microsoft Teams</strong> meeting she goes as a guest. A client can also
              send her into any Meet or Teams meeting right away, from their page. She hears
              and talks through <strong className="font-semibold text-slate-800">OpenAI GPT-Live</strong>, which listens while she
              speaks — so she answers almost at once, and can be interrupted like anybody else.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {STATUS.map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <Dot tone={s.tone} /> {s.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <Card tone="sky" kicker="Before" title="Reads her briefing">
                The invite’s description — and, for a client, their documents and the preparation they gave her — is what she
                knows about the meeting; its guests are who gets the notes.
              </Card>
              <Card tone="emerald" kicker="During" title="Talks like a participant">
                Converses in a one-on-one, answers when addressed in a group, and hands what needs thought, the web or the
                meeting’s record to a stronger model.
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
              intro="Nothing to click during a meeting. It starts from a calendar invite — or from a client's page: “Need Ava now?”, paste any Meet or Teams link, and she joins."
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
                        It reads her calendar every 60 seconds. Declined meetings, all-day entries and anything with neither a
                        Google Meet nor a Teams link (read from the invite’s description, where Outlook and Teams put it) are
                        ignored, and so is a meeting whose organiser is nobody’s client (see{" "}
                        <a href="#clients" className="text-blue-600 underline decoration-blue-300">Clients</a>). It opens the
                        meeting a minute before the start (<C>AVA_JOIN_EARLY_SECONDS</C>), with the app’s briefing for that client.
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
                    body: "Once somebody else is there — never to an empty room: that is when her GPT-Live session opens. Briefly, in her own words: who she is, that she takes notes and emails a summary. In a client’s meeting she is the client’s meeting assistant — “Hi, I’m Ava, Grand Automative’s meeting assistant” — and never mentions NDI; in NDI’s own, NDI’s.",
                    tone: "emerald",
                  },
                  {
                    title: "She listens",
                    body: "GPT-Live hears the meeting’s own sound, taken from the page — everybody but her. Meet’s live captions still run: their speaker names tell her who is talking, and they make the transcript the notes are written from.",
                    tone: "emerald",
                  },
                  {
                    title: "She takes her turn",
                    body: (
                      <>
                        GPT-Live holds the conversation itself, with no round trip through the app — so she answers almost at once,
                        and stops when talked over (see{" "}
                        <a href="#talking" className="text-blue-600 underline decoration-blue-300">When she talks</a>). What needs
                        thought, the web or the meeting’s record it hands to its backend, gpt-6-luna.
                      </>
                    ),
                    tone: "emerald",
                  },
                  {
                    title: "She leaves",
                    body: "When the meeting ends, when she is removed, one minute after everybody else has left, five minutes after the start time if nobody turned up, or when it is ended from the client's page. She knows she is alone from the meeting's own participant tiles — other notetaker bots (Fireflies, Otter, Read.ai…) do not count as people, and the chat button's unread count is never taken for a head count — and from its “you're the only one here”. In Teams, from its People button and its tiles: nobody else on screen and no count above one is alone (Teams can hide both when she is), and when the button goes on counting somebody who has left, a minute with nobody else on screen and not a word is too. A bot she does not know by name cannot keep her either (one kept her in an empty meeting for over an hour): once everybody who has spoken has gone and whoever is left — two at most — has not said a word for a minute, she leaves; and after ten minutes in which nobody has said anything, she leaves whoever is on screen. While she waits alone, nothing is open: her GPT-Live session and her face close within seconds of the room emptying.",
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
              intro="Three parts: a body that is in the meeting (her runner), a voice that holds the conversation (OpenAI GPT-Live), and a memory that keeps the meeting and writes the notes (the web app)."
            >
              <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <Card tone="slate" kicker="Where it happens" title="Google Meet & Calendar" className="h-full">
                  <ul className="space-y-1">
                    <li>Her calendar: the invites</li>
                    <li>The call itself</li>
                    <li>Live captions with speaker names</li>
                  </ul>
                </Card>
                <div className="flex items-center justify-center text-base text-slate-400 lg:flex-col">
                  <span className="lg:hidden">↓ ↑</span>
                  <span className="hidden lg:block">⇄</span>
                </div>
                <Card tone="sky" kicker="The body · bot/" title="Runner container" className="h-full">
                  <ul className="space-y-1">
                    <li>Chrome signed in as Ava, on a virtual screen</li>
                    <li>Streams the meeting’s sound to GPT-Live and plays her voice into her mic or face</li>
                    <li>Sends the captions to the app</li>
                    <li>Watches her calendar, joins, leaves</li>
                  </ul>
                </Card>
                <div className="flex items-center justify-center text-base text-slate-400 lg:flex-col">
                  <span className="lg:hidden">↓ ↑</span>
                  <span className="hidden lg:block">⇄</span>
                </div>
                <Card tone="emerald" kicker="The memory · Railway" title="Next.js web app" className="h-full">
                  <ul className="space-y-1">
                    <li>Keeps the transcript, actions and working notes</li>
                    <li>Gives GPT-Live’s backend the meeting’s record and the client’s documents</li>
                    <li>Writes and sends the notes (Claude)</li>
                    <li>Holds her Google access, encrypted</li>
                    <li>Clients’ pages: their documents, preparation, notes</li>
                  </ul>
                </Card>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat value="GPT-Live" label="Her ears and voice · gpt-live-1, voice gleam" />
                <Stat value="gpt-6-luna" label="GPT-Live’s backend · web search, the meeting’s record" />
                <Stat value="Claude" label="The notes · Haiku 4.5 and Sonnet 5" />
                <Stat value="Anam" label="Her face · lip-synced to her voice" />
                <Stat value="Railway Redis" label="The meeting state, beside the site" />
                <Stat value="Google APIs" label="Calendar, Gmail, Drive" />
                <Stat value="Supabase" label="Clients, their documents (pgvector), meetings and notes — schema pa-06" />
                <Stat value="OpenAI embeddings" label="Clients’ documents, searchable by meaning · text-embedding-3-small" />
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Callout tone="sky" title="The conversation does not go through the app">
                  Her runner holds one live connection to GPT-Live — the meeting’s sound out, her voice back — which is why she
                  answers almost at once. The app gets the captions every 1.2 seconds (<C>/api/moderator/tick</C>) for the
                  transcript and the notes, and serves the meeting’s record when GPT-Live’s backend asks for it.
                </Callout>
                <Callout tone="emerald" title="Only the runner may act as her">
                  Reading her calendar, marking her as attending and mailing as her need the shared <C>AVA_RUNNER_KEY</C>.
                  Everything else needs signing in — NDI, or a client’s invited people, each to their own page — except
                  signing in itself and these docs. A stranger who finds the URL gets none of it.
                </Callout>
              </div>
            </Section>

            {/* ── talking ──────────────────────────────────────────────── */}
            <Section
              id="talking"
              eyebrow="Turn-taking"
              title="When she talks"
              intro="GPT-Live takes turns the way a person does: it hears pauses, tone and people talking over her for itself. What we set is when she speaks up."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Card tone="emerald" title="One-on-one">
                  Everything said is said to her: she converses naturally, with the odd “mm-hm”.
                </Card>
                <Card tone="sky" title="A group">
                  She answers when addressed — by name (Ava, often heard as Eva) or as “the assistant” — or asked something she can
                  clearly answer; otherwise she listens. She is told each time the room turns from one to the other.
                </Card>
                <Card title="Interrupted">She stops when somebody talks over her, listens, and answers what they said.</Card>
                <Card title="Handing over">
                  Earlier decisions, a recap, the actions so far, something to note, current facts: she says “one moment” and her
                  backend answers — see <a href="#brains" className="text-blue-600 underline decoration-blue-300">Two brains</a>.
                </Card>
                <Card title="What she knows">
                  General questions get a real answer. Facts about this company, these people or this project come only from the
                  briefing, what was said, or her backend — otherwise she says she does not know.
                </Card>
                <Card title="Why is she quiet?">
                  The client’s page shows what she hears as she hears it, and how many are in the call. Her runner logs every line
                  she says (<C>▸</C>), every hand-over, and her voice session opening and closing — that client’s log alone, too.
                </Card>
              </div>

              <h3 className="mb-3 mt-10 text-sm font-semibold text-slate-700">With the Claude brain (AVA_BRAIN=claude)</h3>
              <p className="mb-4 text-sm leading-6 text-slate-500">
                The app decides instead, in turns: everything said that she has not dealt with waits in a queue, and at each pause
                she deals with all of it, once. Every heartbeat runs down this list.
              </p>
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
                  Set by <C>AVA_MODE</C> in the runner. Her voice is GPT-Live’s gleam in both (ElevenLabs with the Claude brain);
                  avatar mode adds a face.
                </>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Card tone="emerald" kicker="Default" title="Voice mode">
                  <p>
                    She joins camera-off with her Google profile photo. Her voice streams from GPT-Live straight into a microphone
                    track that exists only in her browser.
                  </p>
                  <p className="mt-2">Played the moment it arrives, a little ahead so a late piece does not click.</p>
                </Card>
                <Card tone="violet" kicker="In use" title="Avatar mode">
                  <p>
                    Her camera is a canvas. While she is in conversation it shows her Anam face, whose lips move to her voice: the
                    face is sent a copy (filtered to the 16 kHz it lip-syncs to), but what the meeting hears is GPT-Live’s own audio,
                    held back by the face’s measured lag so the lips match. Otherwise it crossfades to a looping clip of her at rest,
                    filmed once from the live face and kept for later meetings.
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
                    ["Out of minutes", "Anam refuses with its usage limit: that account rests 24 hours and her face reconnects straight away on the next of her Anam accounts (ANAM_API_KEY_2 … _5), with that account's own copy of the avatar. Her voice does not stop meanwhile."],
                    ["No account can give her a face", "Every account out of minutes before the meeting: she joins it as in voice mode — camera off, the meeting showing her profile photo — and her voice works as always. Lost during the meeting — every account out, or three tries in a row that fail — her camera is turned off in the call, and she carries on with her voice. The next meeting tries Anam again."],
                    ["Face reconnecting", "Her last resting clip — or, before one exists, a card with her name. Never a black tile."],
                    ["Empty room", "Nothing is open while she is the only one there — bots do not count. The face connects only once somebody else is in the meeting and closes within seconds of the room emptying, with her GPT-Live session; the camera shows her at rest, at no cost. Both reopen when somebody is back, seen twice in a row so a tile lingering after somebody left does not reopen them."],
                    ["Her voice, not the face’s", "The meeting hears GPT-Live’s audio straight, never the face’s copy — that copy had been cut to 16 kHz, through Anam and one more codec, and carried a noise on her voice. The face’s lag (sending a sound to it coming back out) is measured each reply, and her voice is held back by it so the lips match; without a face she is heard at once. AVA_FACE_AUDIO=anam hears the face’s copy instead."],
                    ["The face’s own sound", "Kept out of her microphone. (With AVA_FACE_AUDIO=anam it is let in only while she speaks through the face.) Its level when she is quiet is logged once per session: digital silence, around −105 dBFS."],
                    ["Meet’s own processing, off", "Meet turns on “Studio sound” (Gemini rebuilding a voice to sound studio-recorded) and “Adaptive audio” in every new meeting. On her already-synthetic voice they added an echo, so she switches both off as she joins."],
                    ["Clean audio for the face", "GPT-Live speaks at 24 kHz; the face lip-syncs at 16 kHz. The conversion filters out what is above 8 kHz first (a windowed-sinc low-pass), rather than letting it fold back as hiss. ANAM_PCM_RATE=24000 sends it untouched instead."],
                    ["Meeting over", "She closes the face session herself before leaving, so Anam does not bill until it notices she has gone."],
                  ]}
                />
              </div>
            </Section>

            {/* ── brains ───────────────────────────────────────────────── */}
            <Section
              id="brains"
              eyebrow="Presence"
              title="Two brains: GPT-Live, or Claude"
              intro={
                <>
                  Set by <C>AVA_BRAIN</C> in the runner, so both can be tried in real meetings. Either way the captions still
                  go to the app, which keeps the transcript and writes the notes.
                </>
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Card tone="violet" kicker="In use · live" title="OpenAI GPT-Live, full duplex">
                  <p>
                    GPT-Live hears the meeting&apos;s sound itself and holds the conversation over one live connection: it listens
                    while she speaks, takes turns, stops when talked over. Her voice streams in as it is made, straight to her
                    microphone or her face.
                  </p>
                  <p className="mt-2">
                    What needs thought, the web or her memory of the meeting it hands to its backend — gpt-6-luna, or Claude. The
                    app keeps her lines in the transcript and otherwise stays quiet.
                  </p>
                </Card>
                <Card tone="emerald" kicker="Fallback · claude" title="Captions → Claude → ElevenLabs">
                  <p>
                    She reads the meeting&apos;s captions, the app decides with Claude when to speak and what to say, and ElevenLabs
                    turns it into her voice — the list under <em>When she talks</em>.
                  </p>
                  <p className="mt-2">Hears only what the captions catch, and one step at a time: listen, think, speak.</p>
                </Card>
              </div>

              <div className="mt-6">
                <Table
                  head={["GPT-Live detail", "How it works"]}
                  rows={[
                    ["What she hears", "The other people’s audio, taken from the meeting page itself — never her own voice or her face’s."],
                    ["When it starts", "When somebody else is in the meeting; she introduces herself."],
                    ["Handed over", "What was said or decided earlier, a recap, the actions so far, something to note down, current facts, anything needing thought. By default to an OpenAI model that OpenAI runs (gpt-6-luna), with web search and two tools of ours: the meeting’s record and noting an action (/api/moderator/record). Or to Claude through the app (/api/moderator/ask). Either way what she notes goes into the meeting’s actions."],
                    ["One-on-one", "She talks with the person naturally, backchannels included."],
                    ["A group", "She responds when addressed — by name, or as “the assistant” — or asked something she can clearly answer; otherwise she listens. She is told each time the room changes."],
                    ["Who is speaking", "Sound carries no names, so the captions tell her who is talking."],
                    ["Empty room", "Never open while she is alone (it is billed by the minute): it opens when somebody else arrives, closes within seconds of the room emptying, and reopens with the conversation so far when somebody is back."],
                    ["Silence", "Billed while open, even when nobody talks. After three minutes in which nobody — her included — has said anything, the session closes (AVA_HUSH_SECONDS); the first words anybody says open it again, with the conversation so far. After ten minutes of silence she leaves (AVA_SILENT_LEAVE_MINUTES)."],
                    ["Time limit", "A session runs out after a while; she renews it in a quiet moment beforehand, and reconnects with the conversation so far if it drops. After three quick failures she stays quiet."],
                    ["Language", "Whichever of English, German or Arabic she is spoken to in, by herself; the captions follow what is spoken (see Languages). German is native quality in GPT-Live; Arabic is understood in dialect (Tunisian, Maghrebi, Egyptian…) and answered in Modern Standard Arabic, where it is strongest."],
                    ["Bots", "Notetakers (Fireflies, Otter, Read.ai…) are not counted as people and their captions are ignored: with only bots left she is alone, so her voice session and her face are closed."],
                  ]}
                />
              </div>
            </Section>

            {/* ── teams ────────────────────────────────────────────────── */}
            <Section
              id="teams"
              eyebrow="Second platform"
              title="Microsoft Teams"
              intro="Invite her from Outlook or Teams like anybody else — the meeting shows on the client's page and she answers the invite — or send her from the client's page. She goes as a guest. Everything after she is in — listening, talking, notes — is the same as in Meet."
            >
              <Steps
                items={[
                  {
                    title: "An invite, or “Need Ava now?”",
                    body: "Invited from Outlook or Teams: the app reads the join link from the invite’s description, where they put it (never their “Meeting options” link), and she goes at the start time. Or paste the Teams link on the client’s page, with a line about the meeting if you like, then Send Ava: she goes at once, for that client, with what she knows about them.",
                    tone: "sky",
                  },
                  {
                    title: "Her container picks it up",
                    body: "From her calendar every 60 seconds, as for Meet; from a page within 10 seconds, when it asks the app whether she has been sent anywhere. Each meeting once — with its client.",
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
                    title: "Live captions on, and she is in",
                    body: "More → Language and speech → Turn on live captions. From here it is the same brain as Meet.",
                    tone: "emerald",
                  },
                  {
                    title: "Everybody leaves, and so does she",
                    body: "A minute after the last person has gone, as in Meet — counted from the People button and the tiles on screen, which Teams can hide once she is alone.",
                    tone: "violet",
                  },
                ]}
              />
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Callout tone="amber" title="Depends on the other company’s Teams settings">
                  Their IT can turn off guest joining or live captions. If they have, she cannot get in, or cannot hear.
                </Callout>
                <Callout tone="sky" title="What she saw">
                  She saves a screenshot and the page to her disk (<C>/data/debug-teams-*.png</C>) when a step fails, 20 seconds
                  into each call, when nobody else is left on screen, and when she decides the call is over — Teams changes its
                  pages without notice.
                </Callout>
              </div>
            </Section>

            {/* ── languages ────────────────────────────────────────────── */}
            <Section
              id="languages"
              eyebrow="English · Deutsch · العربية"
              title="Languages"
              intro="English, German and Arabic. GPT-Live hears and answers any of them by itself. The captions — which name the speakers and make the transcript — take one language at a time, and follow what people actually speak. The notes are always in English."
            >
              <Table
                head={["Step", "How the language is used"]}
                rows={[
                  ["Where it starts", "Nothing to choose. Calendar meetings: from the invite — “Language: German” decides, otherwise the language it is written in. Sent from a client’s page: the language of what they wrote about it."],
                  ["Following the room", "When what she hears is clearly another of the three — twice in a row, and not more than every half minute — she switches the captions to it."],
                  ["The captions", "Meet’s “Meeting language”, Teams’ spoken language. Arabic uses Maghrebi captions unless AVA_ARABIC_CAPTIONS says otherwise."],
                  ["Her replies", "GPT-Live answers in the language she is spoken to in — Arabic dialects understood, answered in Modern Standard Arabic."],
                  ["Her voice", "GPT-Live’s gleam speaks all three. With the Claude brain, ElevenLabs Flash v2.5, told which language it is reading."],
                  ["Her name", "Recognised in Arabic script too — آفا, إيفا."],
                  ["Hello", "Her opening line is in the meeting’s language."],
                  ["The notes", "Always in English, whatever the meeting was held in: the write-up translates what was said, keeping names and quoted terms as they were."],
                ]}
              />
              <p className="mt-3 text-xs text-slate-500">
                A meeting that mixes languages keeps its captions in the one spoken most lately; GPT-Live itself follows every switch.
              </p>
            </Section>

            {/* ── notes ────────────────────────────────────────────────── */}
            <Section id="notes" eyebrow="Afterwards" title="Notes and follow-up">
              <div className="grid gap-4 md:grid-cols-3">
                <Card tone="sky" title="Actions and decisions">
                  When the meeting ends, the transcript is read for who committed to what, and by when (Haiku). Asked to “note
                  that down” during the meeting, her backend adds it straight away.
                </Card>
                <Card tone="violet" title="The write-up">
                  Summary, decisions, and actions with owners and dates, written from the whole transcript (Sonnet) — always in
                  English, translated if the meeting was held in German or Arabic.
                </Card>
                <Card tone="emerald" title="Calendar meetings: emailed to the guests">
                  A meeting she is invited to on her calendar: when it ends the notes go out from Ava’s Gmail to every guest on the
                  invite, with nothing to press. Not meeting rooms, not herself; once per meeting. (An invite with nobody on it but
                  her: she asks in the meeting chat for addresses.)
                </Card>
                <Card tone="amber" title="Sent from a client’s page: filed, not emailed">
                  A meeting she was sent to with “Need Ava now?” — a Meet or Teams link pasted there: the notes
                  are written and filed with the meeting on that client’s page (Past meetings), and she does not promise an email
                  in her hello. Meet and Teams show names, never addresses. To have them emailed, invite her on the calendar.
                </Card>
                <Card tone="slate" title="A designed email">
                  Designed HTML — the actions first, each with its owner and due date, then the summary and any files — with the
                  plain text alongside for mail apps that do not show HTML. Built from the text you can edit, so edits show up too.
                  A client’s meeting carries the client’s name where NDI’s would be, and she signs as their meeting assistant.
                  Nobody came, no email.
                </Card>
                <Card tone="sky" title="Kept for the client">
                  A client’s meeting: the notes are also filed with it, and the client reads them back on their page under
                  “Past 30 days”.
                </Card>
              </div>
            </Section>

            {/* ── clients ──────────────────────────────────────────────── */}
            <Section
              id="clients"
              eyebrow="One Ava, many companies"
              title="Clients and their knowledge"
              intro="Every client has the same Ava — the same face, voice and Google account. What differs is what she knows: NDI sets a client up, the client signs in, gives her their documents and prepares her for their meetings, and she walks into each of their meetings knowing it."
            >
              <Steps
                items={[
                  {
                    title: "NDI sets the client up (/admin)",
                    body: "Name; their company domain, if they have one — anybody at it signs in and can invite her without being added; and their super admin — the person who runs Ava for them, any address — with anyone else who can use her. She joins only the meetings one of them organises. Ava emails the super admin an invitation from her own Gmail; they bring in the rest.",
                    tone: "sky",
                  },
                  {
                    title: "The client signs in (/client)",
                    body: "With Google, for an address that is a Google account, or else a link by email — Outlook or anything — that works once for 15 minutes; no passwords. Only the people on the client’s list, and anybody at its company domain, get in; nobody signs up. Their Setup tab: their logo and name, their company domain (NDI sets it; their super admin asks for a change, which reaches Ava’s inbox), and who can use her — anybody on the list adds people (Ava emails them the invitation — never somebody at the company’s domain, who signs in directly); only the super admin changes addresses (theirs too), sends it again or removes them, and nobody of theirs removes the super admin. NDI can do all of it, to the super admin too.",
                    tone: "sky",
                  },
                  {
                    title: "They give her what she should know",
                    body: "Files from their computer (up to 4 MB), files from their Google Drive through Google’s own picker (bigger ones too), and links. She reads each one there and then, and rewrites “What Ava knows about <client>” from all of them.",
                    tone: "emerald",
                  },
                  {
                    title: "They invite her to a meeting",
                    body: "From their calendar, like a colleague. Within a minute it is on their page, marked Google Meet or Microsoft Teams, where they can prepare her: what it is for, the agenda, who is coming, what to avoid, notes, and documents for that meeting only — with their earlier meetings to look back on. Saving writes her brief, which they read back. A minute before it starts, the preparation locks.",
                    tone: "emerald",
                  },
                  {
                    title: "She walks in knowing it",
                    body: "Her instructions carry the client’s own “how she works for you”, her brief, the invite, and what she knows about them. For anything more specific she searches their documents mid-meeting.",
                    tone: "violet",
                  },
                  {
                    title: "The notes",
                    body: "Emailed to the guests as always, and filed with the meeting on the client’s page.",
                    tone: "violet",
                  },
                ]}
              />

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Card tone="emerald" title="Two clients at once">
                  She has seats — <C>AVA_SEATS</C> on her server, two by default — each its own Chrome, signed in as her: that
                  many meetings at the same time, for different clients. One at a time for each client: never two of one
                  client’s at once. On the site each seat keeps its own meeting, and every call from her server names its seat
                  and the meeting in it — what she hears, her searches through documents, the notes — so nothing of one client’s
                  meeting reaches another’s, and a late call from a meeting she has left is refused rather than landing in the
                  next one. Seat 2’s Chrome is a copy of seat 1’s profile, made when her server starts: she is signed in once.
                  The seats share the server’s processors and memory — two meetings at once halve what each gets.
                </Card>
                <Card tone="rose" title="Her answers to invites">
                  One meeting at a time for each client, and no more at once than she has seats. Every invite from an active
                  client gets an answer within a minute, which Google emails to the host: yes — or no when it would break either,
                  with the reason in the reply (“already booked at that time … if it moves to a time I’m free, I’ll accept” —
                  never what she is booked for). She keeps the meeting she already said yes to, then the one that has been at
                  that time longest — so somebody moving their meeting onto hers does not take her. Back to back is fine. A recurring
                  meeting gets one answer for the series, and a clashing occurrence its own no. She does not go to a meeting she
                  declined; it shows on the client’s page as declined, with why, and is accepted again by itself if it moves to a
                  free time or the other meeting goes. A no somebody else gave on her calendar stands. Invites she does not go to
                  anyway — nobody’s client, a paused client’s, no Meet or Teams link — are not answered.
                </Card>
                <Card tone="sky" title="Whose meeting is it?">
                  The organiser’s: somebody on a client’s list — its super admin or somebody added, from any address — or anybody at
                  its company domain. Never a guest, or anybody could put one client’s employee on an invite and have her for free.
                  The list comes first: somebody on one client’s list is that client’s, whatever their domain. So NDI’s own people
                  are on no client’s list (admins see every client anyway); NDI is a client too, with NDI’s domain
                  (<C>ADMIN_DOMAIN</C>). An invite from anybody else is skipped: she does not go, and admins see it under “Invites
                  she skipped”, with one click to make its organiser a new client’s super admin and their domain the client’s.
                </Card>
                <Card tone="amber" title="Every meeting’s history">
                  Kept per meeting, in <C>meeting_history</C>, and shown on the client’s page: the host’s changes read from her
                  calendar — invited, moved, renamed, description, guests, link, called off, back — each saved preparation (the
                  version itself, and what changed), documents added or removed, her brief, her joining and leaving (and why),
                  who ended it from the site, and the notes written and emailed. A past meeting opens on its notes — the email as
                  it went out — its preparation and its history; called-off meetings are listed apart.
                </Card>
                <Card tone="rose" title="Locked a minute before">
                  From a minute before a meeting starts, its preparation is what she walks in with: the page shows it read-only
                  (“View preparation”), and the server refuses any change to it — the preparation, her brief, the meeting’s
                  documents — whatever a page sends. A meeting is over the moment she leaves it — her notes still to come — or
                  when its time on the calendar is up, whichever comes first, and then it is under Past meetings. Nothing of a meeting is
                  deleted: its preparation, documents, brief, notes and history stay with it for good.
                </Card>
                <Card tone="violet" title="Earlier meetings">
                  Preparing a meeting, “Earlier meetings” lists every earlier one of that client — not only the last 30 days —
                  the same meeting first (its recurring series, or its title). Each opens on its notes, its preparation and its
                  history. “Give her these notes for this meeting” adds an earlier meeting’s notes and actions to this meeting’s
                  documents, so she knows what was decided last time.
                </Card>
                <Card tone="sky" title="Theirs, not NDI’s">
                  In a client’s meeting she is that client’s meeting assistant: she introduces herself as theirs, types it in the
                  Teams chat, signs the notes email with their name, and never mentions NDI. In NDI’s own meetings, NDI’s.
                </Card>
                <Card tone="emerald" title="Who sees what">
                  Admins — every address on <C>ADMIN_DOMAIN</C> — see every client, the control room and these docs. A client’s
                  people see their own page and nothing else; every request is checked against who may sign in for whom, at
                  that moment, so removing somebody locks them out at once. A paused client’s meetings are skipped and nobody
                  signs in for it; its preparation is kept. Its super admin is the address NDI set it up with: anybody on the list
                  adds people; only the super admin changes addresses — theirs too, and then signs in again with the new one —
                  invites people again or removes them (never themselves), and nobody of theirs removes the super admin. A changed
                  address keeps its place and role; the old one is locked out at once. NDI does all of it, to the super admin too,
                  and makes someone the super admin; a client left without one is told so. Pausing and removing a client are NDI’s.
                  Nobody can be on two clients’ lists or at another client’s domain — their meetings would move — nor anyone at NDI.
                  Somebody at a client’s own domain is not added, nor invited: they have access already and sign in directly. A company domain is NDI’s to set — on the New client form or the client’s page; their super admin asks for a change from their Setup tab, emailed to Ava’s inbox — and must be real — it receives email, looked up
                  in its DNS — not a shared provider like gmail.com, not NDI’s, and not another client’s.
                </Card>
                <Card tone="violet" title="Reading documents">
                  PDFs are read here; a scan with no text, and images, are read by Drive. Word, Excel and PowerPoint become Google
                  Docs, Sheets and Slides as they are stored, and are read as text (every tab of a sheet). Pages are fetched with
                  care: only public addresses, redirects checked, 8 MB at most; a site that leaves out its intermediate
                  certificate gets it filled in from where its own certificate says, as browsers do, and is still checked
                  against the usual roots. A link that could not be read says why on its row, with Try again. Up to 400,000 characters per document, 300
                  documents per client. Text written on their page is taken as it is, and up to 1,500 characters is its own
                  summary. Preview shows the kept copy (Google files as a PDF, up to 4.3 MB) or the text she read, joined
                  back from its passages.
                </Card>
                <Card tone="amber" title="Her homework">
                  Each document is summarised as it arrives (Haiku). From the summaries she writes “What Ava knows about
                  &lt;client&gt;” (Sonnet), again whenever documents are added or removed. Her brief for a meeting (Sonnet) is
                  written when they prepare her, and again in the 45 minutes before it starts if anything changed since.
                </Card>
                <Card tone="sky" title="Searching in the meeting">
                  Her backend calls <C>search_knowledge</C>; the app looks up the passages closest in meaning — from the
                  client’s documents and that meeting’s own. Which client is decided by the meeting she is in, never by what the
                  model asks for. With the Claude brain, the closest passages come with each question instead.
                </Card>
                <Card tone="slate" title="Where it is kept">
                  The files: NDI’s Drive, one folder per client inside <C>CLIENTS_DRIVE_FOLDER</C>, written by Ava’s account.
                  The passages, their vectors, summaries, briefs and notes: the team’s shared Supabase project, all of it in her
                  own schema, <C>pa-06</C>, reached through its Data API with the project’s secret key — from the server only.
                  OpenAI only turns passages into vectors — nothing is stored there. Each client’s logo: Cloudinary, under
                  <C>pa-06/clients/&lt;client id&gt;</C>, sent from the server and shown from its CDN at the size each page needs.
                </Card>
              </div>
            </Section>

            {/* ── brain modules ────────────────────────────────────────── */}
            <Section id="brain" eyebrow="Modules" title="The brain — web app" intro="Next.js on Railway — the [PA-06] group in the POCs project: the site, and its Redis beside it on Railway's private network, where the meeting lives. (It ran on Vercel until 7 October 2026; that project is deleted.)">
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-5">
                <FileRow path="app/api/moderator/tick" tag={<Chip tone="emerald">the heart</Chip>}>
                  Takes what was heard and folds it into the transcript, with her own lines and the state of her voice and face.
                  With the Claude brain it also decides the one thing to say now.
                </FileRow>
                <FileRow path="app/api/moderator/record · ask">
                  For GPT-Live’s backend: the meeting’s record and noting an action (gpt-6-luna), or a question answered by Claude.
                </FileRow>
                <FileRow path="lib/moderator.ts">
                  Everything that needs Claude: pulling out actions and writing the follow-up — and with the Claude brain,
                  answering and deciding whether to chime in. Also her speaking style.
                </FileRow>
                <FileRow path="lib/script.ts">The lines she says without a model: the opening and the goodbye.</FileRow>
                <FileRow path="lib/meeting.ts">
                  The meeting: briefing, status, transcript, actions, pacing, cooldowns. Old stored shapes are migrated on read.
                </FileRow>
                <FileRow path="lib/store.ts">Where it is kept — one meeting per seat, each under its own key and lock: Redis, MongoDB, or a local file in development.</FileRow>
                <FileRow path="lib/ava.ts">Her own Google access, stored encrypted on the server; the runner-key check.</FileRow>
                <FileRow path="lib/workspace.ts">Calendar (her invites), Gmail (drafts and sending), Drive (search and sharing).</FileRow>
                <FileRow path="lib/email.ts">The designed notes email — the client’s name in a client’s meeting, NDI’s otherwise — built from the plain-text notes.</FileRow>
                <FileRow path="lib/google.ts · lib/session.ts · lib/sessionLife.ts">Google OAuth — Ava’s own account, and signing in — and the encrypted session cookie, good for 30 days.</FileRow>
                <FileRow path="lib/anam.ts">Short-lived Anam tokens: a lip-sync-only face, or the older full persona.</FileRow>
                <FileRow path="lib/platform.ts">Which product a link is — Google Meet or Microsoft Teams — and the join link written in an invite.</FileRow>
                <FileRow path="app/api/ava/dispatch">
                  Where her runner asks “have I been sent anywhere?”, saying which of its seats are free — each meeting sent from a
                  client’s page is taken once, with its client, its seat and its id.
                </FileRow>
                <FileRow path="app/api/portal/live · components/portal/Live.tsx">
                  Her meeting on the client’s page, only when it is theirs: sending her now (“Need Ava now?” — a link and a line,
                  for that client, into a free seat; refused while she is in one of theirs, or every seat is taken), what she
                  hears and the actions as they come, telling her
                  something mid-meeting, ending it — after which the site writes the notes as her runner would.
                </FileRow>
                <FileRow path="components/ControlRoom.tsx">
                  The page at <C>/</C>: the three things she depends on, each said in words — her Google account, her server (and
                  what she is doing now in each seat, with each client’s page to follow it on), the meeting storage.
                </FileRow>
                <FileRow path="proxy.ts · lib/auth.ts · lib/seal.ts" tag={<Chip tone="emerald">the door</Chip>}>
                  Nothing opens without signing in — or the runner’s key — except signing in and these docs. Who is an admin, who
                  signs in for which client (checked again on every request), and the encryption of the session cookie. A
                  sign-in lasts 30 days: the date is kept inside the session too, so a copied cookie stops working then as well.
                </FileRow>
                <FileRow path="app/privacy">
                  The privacy notice — public, like these docs. Google asks for it before people outside NDI may sign in with
                  Google or use the Drive picker, and it says how Google data is used (only the files picked, Limited Use).
                </FileRow>
                <FileRow path="app/login · app/api/auth/login · email · email/verify · logout">
                  Signing in with Google (who you are, nothing more) or with a link by email: 15 minutes, once, stored only as a
                  hash, and used by a button — mail scanners open links, and would spend it.
                </FileRow>
                <FileRow path="lib/clients.ts">Clients, who can use her for them — the super admin and the people added — matching an organiser to a client, the invitation email.</FileRow>
                <FileRow path="lib/schedule.ts">
                  Her calendar copied into Postgres, each meeting given to a client by its organiser — or skipped. Preparation and
                  notes are kept on those rows; what the host changed since the last read goes into the meeting’s history. When a
                  meeting’s preparation is locked (with <C>lib/prepLock.ts</C>, which the page shares), and a client’s earlier
                  meetings.
                </FileRow>
                <FileRow path="lib/rsvp.ts">
                  Her answers to invites: one meeting at a time for each client, as many at once as she has seats — which she
                  keeps, what she says yes and no to, and the reply Google emails the host. Planned on every read of her
                  calendar, sent only from her runner’s.
                </FileRow>
                <FileRow path="lib/history.ts · components/portal/MeetingRecord.tsx">
                  Each meeting’s history, append-only — kept by whatever did it (the calendar read, the page, her runner), never
                  in its way — and the record a meeting opens on: notes, preparation, history.
                </FileRow>
                <FileRow path="lib/knowledge.ts · extract.ts · drive.ts · embed.ts">
                  Adding a document: keep it in Drive, read its text, cut it into overlapping passages, embed them, store them;
                  and the search she uses in a meeting.
                </FileRow>
                <FileRow path="lib/prepare.ts">Her homework: each document’s summary, the client’s digest, a meeting’s brief, the briefing she is handed.</FileRow>
                <FileRow path="components/portal · components/admin">
                  The client’s page, in tabs — meetings and preparation, what she knows (documents, links and text they write, each
                  with a preview, and her digest shown as a README), how she works for you, and Setup (portal/Setup.tsx: logo, name,
                  who can use her) — and NDI’s (the clients, each card with her log; invites she skipped). Admins open any client’s
                  page as the client sees it, under the whole of the same Setup.
                </FileRow>
                <FileRow path="lib/cloudinary.ts">
                  Clients’ logos: up to Cloudinary (signed with the secret, on the server), one per client under a fixed name so a
                  new one replaces the old, and taken down with the client. The pages ask Cloudinary for each at the size shown
                  (<C>CompanyLogo</C> in components/portal/ui.tsx); without one, the client’s initials.
                </FileRow>
                <FileRow path="lib/db.ts · db/schema.sql">
                  Her schema, <C>pa-06</C>, in the team’s shared Supabase project, through its Data API: the tables, and three
                  functions for what the API cannot say by itself — her passage search, copying her calendar in, the admin
                  counts. <C>db/schema.sql</C> is pasted once into the SQL editor and touches nothing outside <C>pa-06</C>{" "}
                  (beyond switching pgvector on if nobody has). Row security is on and the browser roles get nothing: only the
                  server’s secret key gets in.
                </FileRow>
                <FileRow path="lib/recall.ts · app/bot · components/Stage.tsx" tag={<Chip>retired</Chip>}>
                  The Recall bot she used before she had her own Chrome. Its stage is behind sign-in now, where Recall’s browser
                  cannot reach it, so this path no longer works.
                </FileRow>
              </div>
            </Section>

            {/* ── runner modules ───────────────────────────────────────── */}
            <Section id="runner" eyebrow="Modules" title="The runner — bot/" intro="One Docker container: Node, Google Chrome, a virtual screen, and a web view of that screen.">
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white px-5">
                <FileRow path="watch.mjs" tag={<Chip tone="sky">entry point</Chip>}>
                  On duty: checks she is signed in — in every seat — reads her calendar every minute and asks every 10 seconds
                  whether a client’s page sent her somewhere, attends each meeting in a free seat, side by side with the others —
                  with the app’s briefing for its client — and remembers which ones she already did. Each seat’s log lines are
                  marked with it ([1], [2]); <C>/data/.seats.json</C> says which seats are in a meeting now.
                </FileRow>
                <FileRow path="lib/account.mjs">
                  Her Google sign-in, per seat: checked by opening her account page; signed in by hand through the screen for seat
                  1, and the other seats’ profiles copied from it — again if Google signs one out.
                </FileRow>
                <FileRow path="lib/meet.mjs">
                  One meeting in one seat, on either platform: start it on the app, open that seat’s Chrome, join, turn captions on, open GPT-Live when somebody
                  is there and close it when nobody is, follow the spoken language, notice the end, leave, send the notes. For a
                  client’s meeting her backend also gets <C>search_knowledge</C>.
                </FileRow>
                <FileRow path="lib/platforms.mjs">
                  What differs between Google Meet and Teams: getting in, switching captions on, telling the call is over,
                  leaving.
                </FileRow>
                <FileRow path="inject/ava.ts">
                  Runs inside the Meet or Teams page before its own code: answers its request for a microphone (and camera) with
                  her, reads the captions, plays her voice, draws her face.
                </FileRow>
                <FileRow path="lib/voice.mjs">With the Claude brain: ElevenLabs text-to-speech, mp3 or raw audio for the face.</FileRow>
                <FileRow path="lib/live.mjs">
                  AVA_BRAIN=live: the connection to OpenAI GPT-Live — the meeting&apos;s sound out, her voice and what she hands
                  over back in.
                </FileRow>
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
                  [<C key="r">POST /api/moderator/ask</C>, "Runner (key)", "GPT-Live hands over a question; Claude answers from the meeting"],
                  [<C key="r">POST /api/moderator/record</C>, "Runner (key)", "The meeting so far for GPT-Live’s OpenAI backend; note an action"],
                  [<C key="r">POST /api/moderator/knowledge</C>, "Runner (key)", "search_knowledge: passages from the documents of the client whose meeting she is in"],
                  [<C key="r">GET /api/ava/upcoming</C>, "Runner (key)", "Her clients’ invites for the next hours, each with its briefing (every invite when no clients are set up) — not the ones she declined; this read also sends her answers to invites"],
                  [<C key="r">POST /api/ava/dispatch</C>, "Runner (key)", "Take a meeting sent from a client’s page, with its client"],
                  [<C key="r">GET · PUT · DELETE /api/meeting</C>, "Runner, admins", "Read, brief or clear the meeting"],
                  [<C key="r">POST /api/meeting/control</C>, "Runner, admins", "attend · stop · rehearse"],
                  [<C key="r">POST · PUT /api/meeting/followup</C>, "Runner (key), admins", "Write the notes; send or re-send them"],
                  [<C key="r">GET · POST /api/portal/live</C>, "Clients, admins", "Her meeting if it is theirs; send her now, tell her something, end it"],
                  [<C key="r">POST · PUT /api/moderator/notes</C>, "Recall stage", "Pull actions from new transcript as it goes; edit them"],
                  [<C key="r">POST /api/anam</C>, "Runner", "A short-lived token for her face"],
                  [<C key="r">GET /api/auth/google</C>, "Admins", "Connect Google (?as=ava for her account)"],
                  [<C key="r">/api/auth/login · email · email/verify · logout</C>, "Anyone", "Sign in with Google or an emailed link; sign out"],
                  [<C key="r">/api/admin/clients · [id]</C>, "Admins", "List clients and create one (with its invitations); delete one"],
                  [<C key="r">/api/portal/setup · people · logo</C>, "Clients, admins", "A client’s setup: name and logo; company domain (NDI); who can use her — add; change an address, invite again and remove (their super admin, or NDI — the super admin too); make someone super admin (NDI); pausing, NDI only"],
                  [<C key="r">POST /api/portal/domain-request</C>, "Clients’ super admins", "Ask NDI for another company domain: checked as NDI’s would be, then emailed to Ava’s inbox — one every 10 minutes"],
                  [<C key="r">GET /api/portal/workspace</C>, "Clients, admins", "A client’s page: instructions, digest, documents, meetings"],
                  [<C key="r">/api/portal/knowledge · [id]</C>, "Clients, admins", "Add a document (upload, Drive, link, text written on the page); read back what she took from one, or remove it"],
                  [<C key="r">GET /api/portal/knowledge/[id]/file</C>, "Clients, admins", "The kept copy of a document, for its preview"],
                  [<C key="r">/api/portal/meetings/[id]</C>, "Clients, admins", "One meeting with its documents and history; save its preparation (kept as a version) and write her brief — refused from a minute before it starts"],
                  [<C key="r">GET /api/portal/meetings/[id]/earlier</C>, "Clients, admins", "The client’s earlier meetings, the same meeting first — for a preparation to look back on"],
                  [<C key="r">POST /api/portal/digest · PATCH /api/portal/profile</C>, "Clients, admins", "Rewrite what she knows; how she works for them"],
                  [<C key="r">POST /api/meeting/start</C>, "Admins", "Send the Recall bot (older path, nothing calls it)"],
                ]}
              />
            </Section>

            {/* ── config ───────────────────────────────────────────────── */}
            <Section id="config" eyebrow="Reference" title="Configuration" intro="Names only — values live in Railway (the site's service) and in bot/.env, never in the repo.">
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Web app (Railway)</h3>
                  <Table
                    head={["Variable", "For"]}
                    rows={[
                      [<C key="v">ANTHROPIC_API_KEY</C>, "Claude"],
                      [<C key="v">ANTHROPIC_MODEL_FAST · _WRITER</C>, "Override the notes models (and the Claude brain's)"],
                      [<C key="v">REDIS_URL</C>, "Redis for the meeting state — Railway's, beside the site, on its private network"],
                      [<C key="v">KV_REST_API_TOKEN · KV_REST_API_URL</C>, "Or Redis over Upstash's web API: if set, used instead of REDIS_URL (not set on Railway); the URL is worked out from KV_URL if missing"],
                      [<C key="v">GOOGLE_CLIENT_ID · _SECRET · _REDIRECT_URI</C>, "One Google OAuth client (project ava-avatar) for Ava's own account, the site's sign-in and the Drive button"],
                      [<C key="v">SESSION_SECRET</C>, "Encrypts sessions and her stored access"],
                      [<C key="v">AVA_RUNNER_KEY</C>, "Shared with the runner"],
                      [<C key="v">AVA_EMAIL</C>, "Her address; any other is refused"],
                      [<C key="v">AVA_ALIASES</C>, "Other spellings of her name (default Eva, Iva, Eeva, Ayva, Avah)"],
                      [<C key="v">BOT_NAME</C>, "Her name"],
                      [<C key="v">SUPABASE_URL · SUPABASE_SCHEMA · SUPABASE_SERVICE_ROLE_KEY</C>, "Clients, documents, meetings — the team’s Supabase project, her schema (pa-06), and its secret key (server only)"],
                      [<C key="v">OPENAI_API_KEY · OPENAI_EMBEDDING_MODEL</C>, "Making clients’ documents searchable (text-embedding-3-small)"],
                      [<C key="v">CLIENTS_DRIVE_FOLDER</C>, "The Drive folder clients’ files are kept in; Ava must be its Editor"],
                      [<C key="v">CLOUDINARY_CLOUD_NAME · CLOUDINARY_API_KEY · CLOUDINARY_API_SECRET</C>, "Clients’ logos, on Cloudinary — or the one line CLOUDINARY_URL instead; the secret stays on the server"],
                      [<C key="v">ADMIN_DOMAIN</C>, "Who is an admin (new-digital-intelligence.com)"],
                      [<C key="v">GOOGLE_API_KEY</C>, "The Drive button's browser key (Google Picker API, this site only); its client and project number come from GOOGLE_CLIENT_ID"],
                      [<C key="v">APP_URL</C>, "The address in invitations and sign-in links"],
                      [<C key="v">RECALL_API_KEY · RECALL_REGION</C>, "The older Recall bot (retired)"],
                    ]}
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">Runner (bot/.env)</h3>
                  <Table
                    head={["Variable", "For"]}
                    rows={[
                      [<C key="v">AVA_APP_URL</C>, "The brain’s address"],
                      [<C key="v">AVA_RUNNER_KEY</C>, "Same value as the app"],
                      [<C key="v">AVA_ADMIN_PASSWORD</C>, "The web view of her screen and her live log"],
                      [<C key="v">AVA_BASIC_AUTH</C>, "Set: the screen and the live log open with no password (anyone with the address controls her Chrome)"],
                      [<C key="v">AVA_MODE</C>, "voice or avatar"],
                      [<C key="v">AVA_BRAIN</C>, "live (in use) or claude — who hears and speaks for her"],
                      [<C key="v">OPENAI_API_KEY</C>, "For AVA_BRAIN=live"],
                      [<C key="v">OPENAI_LIVE_MODEL · OPENAI_VOICE</C>, "Optional: gpt-live-1, gleam"],
                      [<C key="v">OPENAI_DELEGATION_MODEL · _EFFORT</C>, "Who answers what GPT-Live hands over — an OpenAI model or claude — and how hard it thinks (gpt-6-luna, low)"],
                      [<C key="v">AVA_DISPLAY_NAME</C>, "Her name as a Teams guest (Ava)"],
                      [<C key="v">ELEVENLABS_VOICE_ID_DE · _AR</C>, "Optional: a voice of her own per language"],
                      [<C key="v">AVA_ARABIC_CAPTIONS</C>, "Which Arabic Meet listens for (Maghrebi)"],
                      [<C key="v">ELEVENLABS_API_KEY · _VOICE_ID</C>, "Her voice"],
                      [<C key="v">AVA_JOIN_EARLY_SECONDS</C>, "How early she opens a meeting (60)"],
                      [<C key="v">AVA_SEATS</C>, "How many meetings at once — different clients’ (2). They share the server: 1 on a small one"],
                      [<C key="v">AVA_HUSH_SECONDS · AVA_SILENT_LEAVE_MINUTES</C>, "Silence: GPT-Live closes after (180 s), she leaves after (10 min)"],
                      [<C key="v">ANAM_SESSION_SECONDS</C>, "Your Anam plan’s session limit (180)"],
                      [<C key="v">AVA_FACE_IDLE_SECONDS</C>, "Quiet seconds before the face rests (45)"],
                      [<C key="v">ANAM_API_KEY · ANAM_AVATAR_ID</C>, "Her face — she asks Anam herself (else the app does). A persona ID works too: she uses its avatar"],
                      [<C key="v">ANAM_API_KEY_2 … _5 · ANAM_AVATAR_ID_2 … _5</C>, "More Anam accounts, used in order when one runs out of minutes. The avatar ID can be left out: she finds that account’s own avatar with the same name"],
                      [<C key="v">ANAM_PCM_RATE</C>, "The rate her voice is sent to the face at (16000; 24000 untouched)"],
                      [<C key="v">AVA_FACE_AUDIO</C>, "direct (default): the meeting hears GPT-Live’s audio, lips matched; anam: the face’s copy"],
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
docker compose logs -f         # follow what she is doing

# her log survives restarts: one file a day, two weeks kept
docker compose exec ava tail -200 /data/logs/$(date +%F).log
# and each client's meetings alone, the same way
docker compose exec ava ls /data/logs/clients/<client id>`}</CodeBlock>
                <CodeBlock title="her screen and live log">{`# online, over HTTPS (COMPOSE_PROFILES=public)
https://<AVA_SCREEN_HOST>                    her screen
https://<AVA_SCREEN_HOST>/logs               her log, live, as it is written
https://<AVA_SCREEN_HOST>/logs/clients       the clients she has a log for
https://<AVA_SCREEN_HOST>/logs/client/<id>   one client's meetings alone
                                  # linked from each client's card in /admin

# no password with AVA_BASIC_AUTH set; otherwise user ava,
# password AVA_ADMIN_PASSWORD

# or privately, through an SSH tunnel
ssh -L 8080:localhost:8080 ubuntu@<server>
http://localhost:8080/vnc.html`}</CodeBlock>
              </div>
              <div className="mt-4">
                <CodeBlock title="clients: once, in Supabase">{`SQL Editor → paste db/schema.sql → Run
                               # schema pa-06, its tables and functions,
                               # nothing else; NDI is client number one
Project Settings → Data API → Exposed schemas → add pa-06
# and SUPABASE_URL, SUPABASE_SCHEMA, SUPABASE_SERVICE_ROLE_KEY in the site's settings

# a schema made before logos needs only its logo line:
alter table "pa-06".clients add column if not exists logo_url text;
notify pgrst, 'reload schema';

# and, made before meetings had a history, its table — the
# meeting_history lines of db/schema.sql, then the same notify

# then, signed in as anybody @new-digital-intelligence.com:
/admin                         # set up a client, invite their people
/admin/clients/<id>            # their setup, and their page as they see it`}</CodeBlock>
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
                  ["Claude", "The notes after each meeting", "A few cents a meeting"],
                  ["OpenAI GPT-Live", "Only while somebody else is there; needs a paid OpenAI account (not the free tier)", "$0.05 a minute, billed by the second, plus its backend model by the token for what it hands over"],
                  ["Meet captions", "As good as Google’s captions; one language at a time, following what is spoken", "Free"],
                  ["Teams", "Guest only: waits in the lobby; needs the organiser’s company to allow guests and captions", "Free"],
                  ["Runner", "One meeting per seat (AVA_SEATS, two by default); the seats share its processors and memory", "A small VPS, about €5–25 a month; bigger for two meetings at once"],
                  ["Clients’ documents", "4 MB per upload (bigger, up to 30 MB, through Google Drive), 400,000 characters each, 300 per client", "Embeddings $0.02 per million tokens — a 100-page document is about a tenth of a cent; its summary a cent or two"],
                  ["Supabase", "The team’s shared “pocs” project: its plan’s limits, shared with the other projects", "On the team’s plan"],
                ]}
              />
              <p className="mt-3 text-xs text-slate-400">Prices as last checked; providers change them.</p>
            </Section>

            {/* ── changelog ────────────────────────────────────────────── */}
            <Section id="changelog" eyebrow="History" title="Changelog">
              <ol className="space-y-4">
                {CHANGELOG.map((c) => (
                  <li key={`${c.date}-${c.title}`} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={c.tone ?? "slate"}>{fmt(c.date)}</Chip>
                      <h3 className="font-semibold text-slate-900">{c.title}</h3>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-sm leading-6 text-slate-600">
                      {c.points.map((p) => (
                        <li key={p} className="flex gap-2">
                          <span className="mt-2.5 size-1 shrink-0 rounded-full bg-slate-300" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                    {c.commits.length ? (
                      <p className="mt-3 font-mono text-xs text-slate-400">{c.commits.join(" · ")}</p>
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
