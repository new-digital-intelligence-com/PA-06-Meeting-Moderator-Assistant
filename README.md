# Ava — Meeting Moderator

She joins your **Google Meet as a participant**, with a face and a voice. She reads the
agenda out, keeps time, answers when somebody says her name, takes the notes, and
afterwards writes the follow-up with the actions and the file links.

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
| **`/bot`** the stage | *Recall's* browser, streamed into the Meet | the face, the agenda panel, the clock — and the loop that decides when to speak |

Neither can hold the meeting state, so the server does (`lib/meeting.ts`).

The stage runs one loop: take the captions that arrived, post them to
`/api/moderator/tick`, speak whatever comes back. It only ticks while she is silent, so
she cannot talk over herself.

```
app/
  page.tsx                     control room (server component — seeds the client)
  bot/page.tsx                 the stage Recall streams into the call
  api/meeting/route.ts         the plan: agenda, link, participants
  api/meeting/start/route.ts   sends the Recall bot to the Meet
  api/meeting/control/route.ts next/back/end/rehearse — your override
  api/meeting/followup/route.ts writes the minutes and the email; drafts or sends it
  api/moderator/tick/route.ts  ← the heart: what does she say right now?
  api/moderator/notes/route.ts the note-taker, off the speaking path
  api/drive/route.ts           find files, grant the room access
  api/anam/route.ts            her face and voice: a short-lived session token
lib/
  agenda.ts                    the timekeeper — no model in it, all scripted
  moderator.ts                 the three things that need one: reply, notes, write-up
  recall.ts                    getting her into the meeting
  meeting.ts                   the shared state
  workspace.ts                 Drive sharing, Gmail, Calendar
components/
  Stage.tsx                    what the meeting sees
  ControlRoom.tsx              what you see
  useAnamStream.ts             Anam session; speak() waits for real end-of-speech
```

### Why the clock has no model in it

Everything Ava says on a schedule — the opening, each item, the time warnings, the
read-back — is a fixed string built from the clock in `lib/agenda.ts`. Scripted lines
cannot hallucinate, cannot be slow and cannot fail on a rate limit, and that is most of
what anyone hears her say.

The model is reached for exactly two things: answering when somebody addresses her, and
writing up afterwards. If it is unreachable she goes quiet and the meeting carries on —
the transcript is still recorded and the timekeeper still runs.

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

1. **Plan.** Pick the meeting from your calendar (which fills the link, title and
   invitees) or paste a Meet link. Add the agenda — a title, a length and optionally an
   owner per item. The participants are who gets the files and the follow-up.
2. **Rehearse** (optional). Runs the whole agenda with no bot and no call, on the real
   clock, in a browser tab. The only way to hear the script before a room full of
   people does, and it costs an Anam session instead of a Recall hour.
3. **Send Ava to the meeting.** She knocks. **Somebody has to admit her from the Meet
   window** — Google now screens suspected bots into a stricter queue that defaults to
   denying, so do it promptly or she gives up.
4. **During.** She opens the meeting, announces each item, warns on time, and nudges on
   overruns. Say *"Ava, …"* to ask her something or have her note an action. The control
   room shows what she is hearing, and Next / Back / End override her at any point.
5. **After.** *Write the minutes and email* drafts the follow-up from the transcript and
   the actions. Edit it, then **Save as Gmail draft** — or Send, which cannot be undone.

Files: search your Drive from the control room and *Grant access* to give every
participant the file, each with a notification mail. That one is never triggered by
anything Ava hears — only by you, with an explicit list.

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
