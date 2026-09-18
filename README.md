# Ava — Meeting Moderator

She joins your **Google Meet as a participant**, with a face and a voice. You brief her
beforehand — what the meeting is about, who is coming, anything she should know. She
sits in, answers when somebody says her name, notes what people commit to, and emails
the write-up round when it ends.

Not a meeting product — a participant in Google's. There is no room to join here; you
paste the Meet link you already have.

- **Presence:** [Recall.ai](https://recall.ai) Output Media. Recall joins the Meet with
  its own browser and streams a page *we* control into the call as the bot's camera, so
  Ava sits in a normal participant tile rather than taking over the screen share.
- **Face and voice:** [Anam](https://lab.anam.ai) — a photoreal person over WebRTC who
  speaks the lines we hand her. One connection does both, so there is no audio to ship
  between two vendors and nothing to keep in lip-sync by hand. Her own LLM is switched
  off (`llmId: CUSTOMER_CLIENT_V1`): in a live meeting, nothing but this app should be
  able to put words in her mouth.
- **Ears:** Google Meet's own live captions, relayed by Recall already labelled with
  real speaker names. No second transcription vendor, and no guessing who spoke.
- **Brain:** Claude — Haiku for live replies and note-taking, Sonnet for the write-up.
- **Hands:** Gmail, Calendar and Drive, as the signed-in organiser.

## How it fits together

Two pages, and they are very different animals.

| | runs in | does |
| --- | --- | --- |
| **`/`** the control room | your browser | plan the agenda, send Ava in, watch what she hears, review and send the follow-up |
| **`/bot`** the stage | *Recall's* browser, streamed into the Meet | her face, full frame — and the loop that decides when to speak |

Neither can hold the meeting state, so the server does (`lib/meeting.ts`).

The stage runs one loop: take the captions that arrived, post them to
`/api/moderator/tick`, speak whatever comes back. It only ticks while she is silent, so
she cannot talk over herself.

```
app/
  page.tsx                     control room (server component — seeds the client)
  bot/page.tsx                 the stage Recall streams into the call
  api/meeting/route.ts         the briefing: context, link, recipients
  api/meeting/start/route.ts   sends the Recall bot to the Meet
  api/meeting/control/route.ts end the meeting, or rehearse without one
  api/meeting/followup/route.ts writes the notes and sends them
  api/moderator/tick/route.ts  ← the heart: what does she say right now?
  api/moderator/notes/route.ts the note-taker, off the speaking path
  api/drive/route.ts           find files, grant the room access
  api/anam/route.ts            her face and voice: a short-lived session token
lib/
  script.ts                    the two lines she says unprompted — no model in them
  moderator.ts                 the three things that need one: reply, notes, write-up
  recall.ts                    getting her into the meeting
  meeting.ts                   the shared state
  workspace.ts                 Drive sharing, Gmail, Calendar
components/
  Stage.tsx                    what the meeting sees
  ControlRoom.tsx              what you see
  useAnamStream.ts             Anam session; speak() waits for real end-of-speech
```

### When she speaks, and when she does not

Twice, and only twice. Once at the start to say who she is and that she is taking notes
— a fixed string from `lib/script.ts`, because the first thing a room hears her say
should not be able to hallucinate or time out. And whenever somebody says her name.

That is the whole of it. She does not chime in, chase the agenda or announce the time.
A bot that volunteers remarks into a meeting is an irritation, and the quickest way to
get her thrown out of the next one.

Her Anam persona ships with its own LLM; it is switched off (`llmId:
CUSTOMER_CLIENT_V1`). In a live meeting nothing but this app should be able to put words
in her mouth.

If the model is unreachable she simply stays quiet. The transcript still records and the
write-up still happens afterwards.

## Setup

Do step 1 first; it is the long pole.

1. **A public address.** Recall's browser loads `/bot` over the public internet.
   Pointed at localhost it joins the call and shows a blank tile. Either:

   - **Deploy it** (see below) and use the deployment's URL, or
   - **Tunnel** for local work:

     ```bash
     cloudflared tunnel --url http://localhost:3000
     ```

     Put the `https://…trycloudflare.com` address it prints into `PUBLIC_URL`. It
     changes every restart, so keep the tunnel up for the whole session.

2. **Recall.ai** — an API key from the dashboard, into `RECALL_API_KEY`. Check your
   account's region and set `RECALL_REGION` to match (`us-west-2` by default). The
   first 5 recording hours are free.

3. **Her face and voice** — at [lab.anam.ai](https://lab.anam.ai): an API key into
   `ANAM_API_KEY`, and the id of a persona you have built there into `ANAM_PERSONA_ID`.

   The persona must have **both an avatar and a voice**. An avatar on its own cannot
   speak on Anam's default transport, and the session will be refused. We read the
   avatar and voice off the persona and ignore its brain.

   Drop the same portrait at `public/face.png` — that is the still shown while the
   stream connects.

4. **Google** — Cloud Console → Credentials → OAuth 2.0 Client (Web application), with
   `http://localhost:3000/api/auth/google/callback` as an authorised redirect URI.
   Enable the **Gmail, Calendar and Drive** APIs. While the consent screen is in
   *Testing*, add yourself under *Test users*.

5. **Anthropic** — `ANTHROPIC_API_KEY`.

6. `SESSION_SECRET` — any 32 bytes:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Then:

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, connect Google, and check every pill is green.

## Deploying to Vercel

A permanent URL and no tunnel. One thing has to be set up or it will be subtly broken.

**The meeting needs an external store.** Serverless instances do not share a process or
a filesystem, so the stage and the control room would each end up with their own copy of
the meeting. `lib/store.ts` picks a backend from the environment:

| set | backend |
| --- | --- |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Redis — best fit here |
| `MONGODB_URI` | MongoDB — use it if you already have a cluster |
| neither | `data/meeting.json` — local dev only |

Redis is the better fit: the state is one small blob rewritten every couple of seconds
over HTTP, with no connection to pool and no handshake on a cold start. Adding the
**Upstash** integration from the Vercel dashboard sets both variables for you.

Then:

1. Push the repo and import it in Vercel.
2. Add every variable from `.env.example` in **Settings → Environment Variables**,
   with these three pointing at the deployment rather than localhost:

   ```
   PUBLIC_URL=https://your-app.vercel.app
   APP_URL=https://your-app.vercel.app
   GOOGLE_REDIRECT_URI=https://your-app.vercel.app/api/auth/google/callback
   ```

3. Add that same callback URL to **Google Cloud Console → Credentials → your OAuth
   client → Authorised redirect URIs**. Missing this is the usual cause of
   `redirect_uri_mismatch` on first sign-in.
4. Deploy, open it, and check the header says **Redis** (or **Mongo**) — not **File**.
   File on a deployment means the store variables did not arrive.

The control room shows the backend it is using for exactly this reason.

## Using it

1. **Brief her.** A title, the Meet link, and — the important bit — **what the meeting
   is about**: the subject, who is attending, what matters, anything she should know
   walking in. That text is the only thing she knows, and it is what she answers from.
   Then the addresses the notes go to.

   ```
   Quarterly review with Acme. Sam (their CTO) and Priya (procurement) are joining.

   We are proposing the enterprise tier at 40k a year. They pushed back on price last
   time and want the security review before committing. Budget sign-off is Priya's.

   If anyone asks about timelines: pilot in March, full rollout by June.
   ```

2. **Rehearse** (optional). Runs her with no bot and no call, in a browser tab. Checks
   her face and voice work before a room full of people does.

3. **Send her to the meeting.** She knocks. **Somebody has to admit her from the Meet
   window** — Google screens suspected bots into a queue that defaults to denying, so
   do it promptly or she gives up.

4. **During.** She introduces herself, then goes quiet and listens. Say *"Ava, …"* to
   ask her something or have her note an action. She answers from your briefing and
   from what has been said; asked something neither covers, she says she does not know
   rather than inventing it. You can add to her briefing mid-meeting and the next
   answer will know it.

5. **End & send notes.** One button: she leaves the call, the transcript is written up,
   and the email goes to your recipients. The text is kept and shown, so you can edit
   and re-send if you want to.

Files: search your Drive from the control room and *Grant access* to give every
recipient the file. That one is never triggered by anything she hears — only by you.


## What it costs

Per meeting hour, roughly:

| | |
| --- | --- |
| Recall bot | $0.50 / recording hour |
| Transcription | $0 — Google Meet's own captions |
| Anam | per minute of streamed session (face and voice together) |
| Claude | fractions of a cent |

Anam is the one to watch: it bills for the whole session, not just the speaking. If
that matters, render the agenda panel full-width as the bot's camera and only bring the
face in while she is talking — the stage is yours, nothing stops you.

## Notes

- **Google Meet only**, deliberately. Recall would take a Zoom or Teams link, but the
  timings here — how long admission takes, that the captions carry speaker names —
  were tuned against Meet. `app/api/meeting/start/route.ts` enforces it.
- **She joins as a guest**, so her name is `BOT_NAME` and somebody admits her. Making
  her skip the waiting room means a *signed-in* bot, which requires a dedicated paid
  Workspace on its own domain and SAML SSO — and that changes sign-in for every user in
  the Workspace you apply it to. Not worth it on your main domain.
- **Announce her.** She is a participant that records and transcribes. Say so at the
  top of the call; in a two-party-consent jurisdiction you have to.
- **Latency** from end-of-sentence to her first word is 1.5–3s. Fine for a moderator,
  whose speaking moments are mostly scheduled; it would be poor for banter.
- `data/` holds the live meeting and is gitignored. One meeting at a time — swap
  `lib/meeting.ts` for a real table before a second host exists.
- **Delivery is confirmed, not assumed.** A scripted cue is handed to the stage with a
  key and only recorded as spoken once she reports having said it. If her face is down,
  the line comes back round on the next tick instead of vanishing — which is how an
  earlier version ended up with a moderator who never introduced herself and a clock
  that never started.
- `speak()` resolves on Anam's `endOfSpeech` event rather than when the command is
  accepted, so the loop genuinely knows when she has stopped. Every wait has a timeout:
  inside Recall's browser there is nobody to notice a hung promise.
