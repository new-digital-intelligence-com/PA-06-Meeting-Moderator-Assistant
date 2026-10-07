# Ava in person

Ava attending meetings as **herself** — `ava@new-digital-intelligence.com`, a normal
member of your Workspace — and turning up to whatever she is invited to, on her own, at
the start time. She runs on a server, always on; nothing depends on anybody's PC.

## How it works

Two parts:

- **Her brain** is the web app on Railway. It decides what she says, keeps the transcript,
  takes the notes and writes and sends the follow-up.
- **Her body** is this folder, running as one container on a server. Inside it is a real
  Google Chrome on a virtual screen, signed in as her.

```
you invite ava@ to a meeting
  → it lands on her Google Calendar
  → the container sees it, and a minute before the start opens the Meet link in her Chrome
  → she is on the invite and in your organisation, so Meet lets her straight in —
    her own name, her own photo, no knocking
  → Meet asks the browser for a camera and a microphone and gets HER: her ElevenLabs
    voice is the microphone; in avatar mode (AVA_MODE=avatar) the camera is her Anam
    face, lip-synced to that voice, resting on a clip of her when nobody is talking to her
  → Meet's live captions are her ears; what people say goes to the brain
  → the brain decides when to answer or join in, and she says it out loud
  → the meeting ends; she leaves; the notes go to the guests from her own account
```

Before: the invite's description is her briefing and its guests are who the notes go to.
Declined meetings and all-day entries are ignored. Up to `AVA_SEATS` meetings at once (two by
default), each in its own Chrome — different clients' only; the app answers the invites accordingly.

**Microsoft Teams** the same way: invited from Outlook or Teams, the app reads the join link
in the invite. Or paste a Teams link in “Need Ava now?” on a client's page — the container
checks every 10 seconds. Either way she opens it as a guest named Ava and waits in the
lobby until somebody admits her. `npm run check -- <teams link>` goes as far as the
pre-join screen without joining.

**Proven, not assumed:** the container itself was run and pointed at a real Google Meet —
Meet listed "Ava" as both its camera and microphone and showed her face in its preview.

## Where to run it

Any Linux server with Docker, **2 vCPU and 4 GB RAM**, with a disk that survives restarts.

| | |
| --- | --- |
| **A small VPS** — Hetzner CX22, DigitalOcean, OVH, Scaleway… | cheapest (about €5–25 a month) and the simplest. Recommended. |
| **Render / Railway / Fly.io** — Docker from this repo | no server to look after, but you must add a persistent disk at `/data`, and plans with 4 GB are dearer. |

Use your own account on whichever you pick.

## Setting it up

Once, in this order.

**1. The app** — in the site's variables on Railway, then redeploy:

```
AVA_RUNNER_KEY=<a long random value — the same one goes in step 3>
AVA_EMAIL=ava@new-digital-intelligence.com
```

**2. Connect her Google account to the app.** In the control room, click the amber
**Connect Ava's Google** pill and pick `ava@…` (it refuses any other account). This lets
her read her invites and send the notes as herself.

**3. On the server** (a VPS with Docker installed):

```bash
git clone <this repo>
cd <repo>/bot
cp .env.example .env
nano .env                       # AVA_APP_URL, AVA_RUNNER_KEY, AVA_ADMIN_PASSWORD
docker compose up -d --build
```

**4. Sign her in, once.** Her screen is only reachable from the server itself, so tunnel
to it from your computer:

```bash
ssh -L 8080:localhost:8080 root@<your-server>
```

then open <http://localhost:8080/vnc.html> — user `ava`, password `AVA_ADMIN_PASSWORD`.
A Chrome window is waiting at the Google sign-in page. Sign in as her, open
<https://meet.google.com> once, then **close that window**. She checks again, finds
herself signed in, and goes on duty.

**5. Invite `ava@new-digital-intelligence.com` to a meeting**, like anybody else.

To follow what she is doing: `docker compose logs -f`. To watch her in a meeting, open
the same screen page — you see exactly what her Chrome sees.

### On Render / Railway / Fly instead of a VPS

Create a Docker service from this repo with root directory `bot`, a plan with 4 GB RAM,
a **persistent disk mounted at `/data`**, and the variables from `.env.example`. The
platform gives you HTTPS, so her screen page is at `https://<service-url>/vnc.html`.

## Her Google account — settings that keep her working

- **Google Cloud → OAuth consent screen → User type: Internal.** In *Testing*, Google
  expires the sign-in after 7 days and she silently stops reading her calendar and
  sending notes. (If Internal is greyed out, *Publish app* instead.)
- **Admin console → Security → Google session control:** a long web session for her, so
  she is not signed out mid-week.
- **2-Step Verification:** if enforced, complete it in step 4 and tick *Don't ask again on
  this computer*.
- **Admin console → Security → API controls:** if unknown apps are blocked, trust this one.
- **Her account:** name *Ava*, profile photo the NDI portrait; in Google Calendar settings,
  *Add invitations to my calendar → From everyone*.

## Things worth knowing

- **If Google ever signs her out** she stops, says so in the logs, and reopens the sign-in
  window — she will not wander into meetings as an anonymous guest. Repeat step 4.
- **Her ears are Meet's captions**, so what she hears is as good as they are. The Meet UI
  is forced to English, and captions default to English.
- **Development on your own machine:** `npm install`, then `npm run login` once and
  `npm run watch`. `npm run check -- <meet link>` shows her face in a meeting's pre-join
  screen without joining.
