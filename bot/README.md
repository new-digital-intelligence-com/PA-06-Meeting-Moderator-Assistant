# Ava in person

Ava attending meetings as **herself** — `ava@new-digital-intelligence.com`, a normal
member of your Workspace — instead of as a Recall bot knocking at the door.

This is a real Chrome, signed in to her Google account. When a meeting she is invited to
starts, it opens the Meet link and walks in: she is on the invite, so she is let straight
in, with her own name and photo. Meet asks the browser for a camera and a microphone, and
gets her — the Anam avatar is the camera, her voice is the microphone. Meet's own live
captions are her ears.

Her brain is not here. The runner hands what she hears to the deployed app and says what
comes back, exactly as the Recall tile did, so everything already built — answering when
named, joining in, taking notes, writing and sending the follow-up — works unchanged.

## What she does

| | |
| --- | --- |
| **Before** | Watches her own calendar. The invite's description becomes her briefing; its guests become the people the notes go to. Declined meetings and all-day entries are ignored. |
| **During** | Joins about a minute before the start, turns on her camera, microphone and captions, introduces herself, listens, answers when named, joins in on her own, stops when talked over. |
| **After** | Leaves when the meeting ends — or three minutes after she is the only one left — then writes the notes and emails them to the guests **from her own account**. |

## Setting it up

Once, in this order.

**1. The app needs two more variables** — in Vercel, then redeploy:

```
AVA_RUNNER_KEY=<the value from ../.env.local>
AVA_EMAIL=ava@new-digital-intelligence.com
```

`AVA_RUNNER_KEY` is the shared secret that lets this runner read her calendar and send
mail as her. Without it those routes refuse, which is the point: anybody could otherwise
read her invites by finding the URL.

**2. Connect her Google account to the app.** In the control room, click the amber
**Connect Ava's Google** pill and choose `ava@…`. It refuses any other account. This is
what lets her read her invites and send the notes as herself, with nobody's browser open.

**3. Install and sign her in to Chrome** — on the machine that will run her:

```bash
cd bot
npm install
npm run login
```

A normal Chrome window opens with a profile of her own. Sign in as her, open
<https://meet.google.com> once, then close the window. (It has to be a normal window:
Google refuses sign-ins from automated browsers. After this, she stays signed in.)

**4. Check her face works in Meet** — optional, but it is how you find out before a room
does:

```bash
npm run check -- https://meet.google.com/any-meeting-link
```

Opens that meeting's pre-join screen as a throwaway guest, turns her on as the camera and
saves a screenshot. It never presses Join.

**5. Put her on duty:**

```bash
npm run watch
```

Leave it running. From now on, **invite `ava@new-digital-intelligence.com` to a meeting
like anybody else**, and she turns up.

To send her into one meeting right now instead:

```bash
npm run join -- https://meet.google.com/abc-defg-hij --to sam@acme.com --about "Q3 review with Acme"
```

## Things worth knowing

- **The machine has to be on.** She runs where this runs. A laptop that sleeps through
  the meeting means she misses it. For always-on, run it on a small cloud server with a
  desktop (any VM that can run Chrome); the same commands work.
- **You will see her Chrome window.** It is deliberately not headless — Meet degrades
  headless browsers and Google is warier of them. Leave it alone; minimising is fine.
- **One meeting at a time.** If two invites overlap she attends the earlier one.
- **If Google signs her out** — it occasionally asks accounts to re-verify — run
  `npm run login` again.
- **Captions are her ears**, so what she hears is as good as Meet's captions. They
  are English by default; the runner opens Meet in English for the same reason.
- **Her profile lives outside OneDrive**, in `%LOCALAPPDATA%\ava-runner`, because a
  Chrome profile being synced mid-write corrupts and signs her out.
