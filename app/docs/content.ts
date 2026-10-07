/**
 * The parts of /docs that change with nearly every piece of work: where things stand,
 * and what changed. Update this file in the same commit as the change it describes —
 * newest changelog entry first, and `UPDATED` set to its date.
 */

import type { Tone } from "./ui";

export const UPDATED = "2026-10-07";

/** Where things stand right now. */
export const STATUS: { label: string; value: string; tone: Tone }[] = [
  { label: "Mode", value: "Avatar — Anam face on her GPT-Live voice", tone: "emerald" },
  { label: "Anam", value: "Three accounts, each with its own Elena: the next takes over when one runs out of minutes; with none left she is voice only, camera off", tone: "emerald" },
  { label: "Teams", value: "Built — waiting for its first real call", tone: "sky" },
  { label: "Site", value: "Railway — POCs project, [PA-06] group: the site and its Redis; her server talks to it", tone: "emerald" },
  { label: "Runner", value: "AWS EC2 server (2 vCPU, 4 GB), always on — two seats: two clients' meetings at once, until a bigger server", tone: "emerald" },
  { label: "Brain", value: "GPT-Live (gleam) with gpt-6-luna behind it — one-on-one tested: answers almost at once", tone: "emerald" },
  { label: "Clients", value: "Built: NDI at /admin, each client at /client with their documents and preparation — first test with one client", tone: "sky" },
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
    date: "2026-10-07",
    title: "The guides say Railway",
    points: [
      "The README's deploy guide is Railway's now: the site and its Redis, the three addresses, what Google needs listed, deploying a push by hand. Her server's guide and example settings point at Railway too, and these docs show the meeting state on Railway's Redis.",
      "The 4 MB upload limit no longer gives Vercel as its reason: bigger files come through Google Drive, up to 30 MB.",
      "Checked from a client's account: the Drive picker opens with their files on the Railway address, so Google accepts its key there.",
    ],
    commits: [],
    tone: "slate",
  },
  {
    date: "2026-10-07",
    title: "Vercel retired: Railway only",
    points: [
      "The Vercel project is deleted: its address (pa-06-meeting-moderator-assistant.vercel.app) no longer answers, and Google's sign-in settings list only the Railway address. The site, its Redis and her server's link are all on Railway.",
      "Every push to main is deployed to Railway — by Railway itself once its GitHub App can see the repo; until then right after each push, from the machine that pushes.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-07",
    title: "What still said Vercel",
    points: [
      "The privacy page names Railway as where the site runs. The control room warns about a store her server cannot share on any deployed address, not only a vercel.app one. Her server's example address is Railway's.",
      "Checked from outside: Google accepts the Drive picker's sign-in from the Railway address (and refuses an unlisted one, the control).",
    ],
    commits: [],
    tone: "slate",
  },
  {
    date: "2026-10-07",
    title: "The site moves to Railway",
    points: [
      "The site runs on Railway, in the POCs project's [PA-06] group: the site (https://pa-06-meeting-moderator-assistant-production.up.railway.app) and its own Redis beside it, reachable only on Railway's private network. Same settings as on Vercel; her Google account connected again there.",
      "Her server talks to Railway now: her calendar, the heartbeat in meetings, “Need Ava now?”, the notes. Use the Railway address from here on — the live meeting is only on Railway's Redis; clients, preparations and notes are in Supabase, shared by both.",
      "Always on, so no cold starts, and Railway has no 4.5 MB request limit. Until Railway's GitHub App can see the repo, each push to main is deployed to Railway by hand; Vercel still deploys on push.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-07",
    title: "Redirects go to the site's own address",
    points: [
      "After signing in with Google, the Railway copy of the site sent you to https://localhost:8080 — its address inside Railway — though the sign-in had worked. Vercel hands the site its public address with each request; Railway does not. Every redirect (signing in with Google or by email, signing out, being sent to sign in) now uses APP_URL, as emailed links already did.",
    ],
    commits: [],
    tone: "rose",
  },
  {
    date: "2026-10-07",
    title: "Ready for Railway: a plain Redis connection",
    points: [
      "The meeting state can be kept in any Redis over a normal connection (REDIS_URL), used when there are no Upstash REST credentials — for the site on Railway, with its own Redis beside it in the POCs project, reachable only on Railway's private network. On Vercel nothing changes: Upstash's web API, as before.",
    ],
    commits: [],
    tone: "slate",
  },
  {
    date: "2026-10-07",
    title: "A third Anam account; voice only when no account can give her a face",
    points: [
      "A third Anam account on her server (ANAM_API_KEY_3), with its own copy of Elena — checked from her server: its key, its avatar, and a session Anam issued.",
      "No account can give her a face before a meeting — every one out of minutes: she joins it as in voice mode, camera off, the meeting showing her profile photo, and her voice works as always.",
      "Lost during a meeting — every account out, or three tries in a row that fail: her camera is turned off in the call (Meet or Teams), instead of showing a resting face whose lips never move. Her voice carries on; the next meeting tries Anam again.",
      "An account that refuses for want of minutes when a session is asked for rests a day and the next is asked at once; one that fails for another reason is passed over too.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-06",
    title: "Two clients' meetings at once",
    points: [
      "She has seats: two meetings at the same time, each in its own Chrome on her server (AVA_SEATS, two by default) — one client's and another's side by side. Still one at a time for each client: never two of one client's.",
      "On the site each seat keeps its own meeting. Every call from her server names its seat and the meeting in it — what she hears, her searches through documents, the notes — so nothing of one client's meeting reaches another's, and a late call from a meeting she has left is refused instead of landing in the next one.",
      "“Need Ava now?” puts her in a free seat; it is refused while she is in one of that client's meetings, or every seat is taken. A calendar meeting takes a free seat too, and waits for one when both are taken.",
      "Her answers to invites follow the seats: two clients' meetings at the same time get a yes each; a third at once, or a second of the same client, gets a no — the note says only that she is booked then.",
      "Seat 2's Chrome is a copy of seat 1's, made when her server starts: she is signed in once. The control room shows each seat, with each client's meeting to follow.",
      "Both seats share the server's processors and memory: until it is bigger, two meetings at once halve what each gets.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-06",
    title: "She answers every invite: one meeting at a time",
    points: [
      "Every invite from an active client is answered within a minute, and Google emails the answer to the host: yes — or no when it overlaps a meeting she already has, with the reason in the reply: she is already booked at that time, can only be in one meeting at a time, and accepts if it moves to a time she is free.",
      "Across all clients: she is one person on one server. She keeps the meeting she already said yes to, then the one that has been at that time longest, so a host who moves their meeting onto hers does not take her. Back-to-back meetings are fine.",
      "A recurring meeting gets one answer for the whole series, not one email per occurrence; an occurrence that clashes gets its own no.",
      "She does not go to a meeting she declined. The client's page shows it as declined, with why, and its history keeps her answers and the note the host read. If it moves to a free time, or the other meeting goes, she accepts it by herself.",
      "Invites she does not go to anyway — nobody's client, a paused client's, without a Google Meet link — are not answered.",
    ],
    commits: [],
    tone: "rose",
  },
  {
    date: "2026-10-06",
    title: "In a client's meeting she is theirs; preparation locks a minute before",
    points: [
      "In a client's meeting she introduces herself as the client's meeting assistant — “Hi, I'm Ava, Grand Automative's meeting assistant” — not NDI's, and never mentions NDI: in her hello, what she types in the Teams chat, her answers, and the notes email, which carries the client's name where NDI's was. NDI's own meetings are unchanged.",
      "From a minute before a meeting starts its preparation is locked: “Edit preparation” becomes “View preparation” (read-only), and the server refuses changes to the preparation, the brief and the meeting's documents. The page locks on the minute, and warns in the last 15 minutes.",
      "A meeting she has finished moves to Past meetings straight away, instead of staying under “coming up” until its calendar slot ends — Grand Automative's 20:35 meeting still offered “Edit preparation” after she had left.",
      "Preparing a meeting, “Earlier meetings” lists every earlier one of that client — the same meeting first — each with its notes, preparation and history; an earlier meeting's notes and actions can be given to her for this one.",
      "The ended-meeting panel shows the notes formatted, not as raw Markdown.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-06",
    title: "Every meeting has a history; past meetings show all of it",
    points: [
      "Each meeting keeps what happened to it, and who did it, in a new table (meeting_history): from her calendar, what the host changed — invited, moved, renamed, description, guests, link, called off, back on; from the page, each saved preparation (the version itself and which parts changed), documents added or removed, “Need Ava now?”, ending it; from her, her brief, joining, leaving and why, the notes written and emailed.",
      "A past meeting opens on three parts: Notes — the summary, the actions, the email as it went out, to whom and when; Preparation — what she was given, her brief, the meeting's documents; History — the timeline. Meetings that were called off are listed apart, struck through, with their history. An upcoming meeting's preparation shows its history so far.",
      "Meetings from before the table only have what their row says (on her calendar, prepared, briefed, ended, emailed), and say so.",
      "The ended-meeting panel no longer promises notes that will not come: nothing heard says so; notes that failed say so after three minutes.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-06",
    title: "A meeting is ended only on purpose, and it says by whom",
    points: [
      "Since the control room lost “Send”, the meeting route took any command it did not know for “stop” — so a page left open from before (its Send button sends “dispatch”) could end the meeting she was in. Grand Automative's 20:30 meeting was ended 45 seconds after she joined, from the site. Now only “stop” stops; anything else is refused and she stays.",
      "Ending a meeting from the site records who did it — the address signed in, or her runner — on the meeting: her log says “ended from the site by …”, and the client's page shows it under the ended meeting.",
      "A meeting she was taken out of is not walked into again from her calendar, even if it moves: to have her back, “Need Ava now?” with its link.",
    ],
    commits: [],
    tone: "rose",
  },
  {
    date: "2026-10-06",
    title: "Links from sites with an incomplete certificate are read",
    points: [
      "Some sites send their security certificate without the intermediate one — actia.com does. Browsers fetch the missing piece themselves, so the page opens; the site's reader refused it (“fetch failed”). It now does what a browser does: it reads where the site's own certificate says its issuer is published, fetches that certificate from a public address, keeps it only if it signed the site's, and reads the page with it — still checked against the usual trusted roots.",
      "When a link cannot be read, the reason is said in words (“took too long to answer”, “could not be found”, “its certificate has expired”…) instead of “fetch failed”, and shown on the document's row, not behind a click. A link that failed has “Try again”: it is read anew and replaces the failed one.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-06",
    title: "“Need Ava now?”, her meeting on the client's page, and a new look",
    points: [
      "Every client's page has “Need Ava now?”: paste a Google Meet or Teams link, add a line about it if you like, and she goes at once — for that client, with what she knows about them, their documents searchable. No time to pick and no organiser to match: only the client's own people and NDI can press it. Refused while she is in any meeting; another client is told only that she is busy.",
      "While she is in one of their meetings — from their calendar or sent now — their page shows it live: what she hears (her own lines set apart), the actions as she notes them, how many are in the call, a clock. They can tell her something mid-meeting (added to her briefing) or end it; the notes are then written as if she had left by herself — emailed to the invite's guests for a calendar meeting — and filed under Past meetings. A meeting sent now is kept with their meetings too.",
      "The control room keeps only its three cards — her Google account, her server, the meeting storage — and “Ava's server” says what she is doing and links to the client's page to follow it. Gone: “Your Google account”, “Brief her”, booking a time, and “Files for the room” (and the /api/calendar and /api/drive routes behind them).",
      "A new look: NDI's red logo beside Ava in the top bar (Archivo Black, as on NDI's own site); a coloured header on each client's page with their logo, her status and the button; tabs with icons; sections with coloured icons; files dropped straight onto “Her documents”; an icon for each kind of document; cards that lift under the pointer; and a page shape while it loads.",
      "Her runner, for a meeting sent from a client's page: logs it in that client's log too, and says “sent now for <client>”.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-06",
    title: "Clients run their own setup",
    points: [
      "A client's page has a fourth tab, Setup: their logo, their company name, and who can use her — add someone (Ava emails the invitation), send it again, or remove someone (never yourself). Which meetings are theirs (domains, addresses) shows there to read: NDI changes it.",
      "NDI's page for a client shows the same Setup, all of it: also the domains and addresses, pausing her, and deleting the client. One set of routes serves both — /api/portal/setup, /people and /logo — checking who asks; the admin-only members and logo routes are gone.",
      "Nobody can be added who already belongs to another client — by its people, its domain or one of its addresses — since their meetings would move; a client is not told whose. Nor anyone at NDI, who sees every client anyway.",
      "Her log for each client is now on the client's card in the list (“Her log ↗”), no longer at the top of their setup.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-06",
    title: "“Who can use her”: their invites count too",
    points: [
      "On a client's setup, “Who can open their page” is now “Who can use her”: the people listed sign in to the client's page as before and — new — Ava joins the meetings they invite her to, from whatever address. A founder on Gmail now needs only that one box.",
      "Company domain and personal email addresses still work as before, for anyone else whose invites count: they can invite her without opening the page. A client can now be set up with only the people who can use her.",
      "Which client a meeting is for: one of its exact addresses first, then the people who can use her, then its company domain — always the organiser, never a guest. Someone who can use her brings every meeting they organise to that client, so NDI's own people are not added to clients.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-06",
    title: "A logo for each client",
    points: [
      "A client's setup in /admin has their logo at the top: Add their logo, Change logo, Remove. It is on their page beside “Ava for …” and on their card in the list of clients; a new client can be given one as they are created. Without one, their initials, on a colour of their own.",
      "Kept on Cloudinary: sent by the server, signed with CLOUDINARY_API_SECRET (with CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY, or the one line CLOUDINARY_URL), under pa-06/clients/<client id> — a new logo replaces the old, and deleting a client takes theirs down. The pages ask Cloudinary for it at the size shown, in the best format for the browser.",
      "PNG, JPG, WebP or GIF, up to 2 MB, checked by its bytes rather than its name. Admins only. A schema made before this needs one line in Supabase, in db/schema.sql and in “Running her”.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "Each client's log, alone",
    points: [
      "Her server keeps a log per client: what she prints in a client's meeting — from walking in to “finished”, what was said, her searches, any error — also goes to /data/logs/clients/<client id>, one file a day, two weeks kept. The full log is unchanged.",
      "On her screen's address: /logs/clients lists the clients she has a log for, the most recent first; /logs/client/<id> shows one client's last days, each under its date, then follows live. Same access as /logs.",
      "A client's page in /admin links to it (“Her log for …”) — NDI only, never on the client's own page. Her runner gives the app its screen's address (AVA_SCREEN_HOST) with each call, so there is nothing to set.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "Write it down: text as one of her documents",
    points: [
      "Beside Upload files, From Google Drive and Add a link, “What she knows” has Add text: a title (optional — the first line otherwise) and whatever she should know — who is who, prices, how to answer, what not to say. She reads it like a document: searchable in every meeting, part of what she knows about them, marked Text in the list, and its Preview shows it.",
      "Nothing goes to Drive for it, and a text up to 1,500 characters is its own summary, so no model is asked to summarise it. What was typed stays in the form until she has read it, so an error loses nothing. Not offered in a meeting's preparation, which has its own notes.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "Preview a document",
    points: [
      "Every document that was read has a Preview, in the list and in a meeting's preparation. It opens over the page with two views: the file as it was given — the copy kept in NDI's Drive, Google Docs, Sheets and Slides (and so Word, Excel and PowerPoint) as a PDF — and “What she read”, the text she searches in a meeting, put back together from its passages. A link has only the second, and a button to open the page.",
      "The file comes through the site, from Ava's Drive, to the client's own people and NDI only. Up to 4.3 MB (Vercel's limit for a response); a bigger one, or one read without a copy kept, says so and offers what she read. Nothing that could run in the page is shown as itself: HTML and other text as plain text, anything unknown as a download.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "A client's page in three tabs, and what she knows as a README",
    points: [
      "A client's page has a tab bar — Meetings · What she knows · How she works for you — with a count beside the first two. All three stay loaded, so an upload in progress or unsaved text survives a switch.",
      "“What Ava knows about …” is shown like a README under the list of documents: headings, bullet lists, bold, tables. She is asked to write it that way — a short opening, then a section each for what they offer, people, facts and figures, names, what not to share — and her meeting briefs too (Purpose, Agenda, People, Facts she may need, Avoid). Press Update to rewrite an existing one in the new form.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "Clearer: what each status means, and the two halves of a client",
    points: [
      "The control room's coloured pills are now four cards that say what they are: Ava's Google account, Ava's server, meeting storage, and your own Google account — marked optional, grey when off, as it only fills a meeting from your calendar and shares Drive files from there. Red only for what stops her.",
      "Setting up a client is two separate parts: 1 · which meetings Ava joins for them (company domain, personal email addresses — matched against whoever sent the invite) and 2 · who can open their page (the people who sign in to give her documents and prepare her). The client's setup page is split the same way.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "One Google client for everything",
    points: [
      "Ava's own account, the site's “Sign in with Google” and the Drive button now all use GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — one OAuth client, in the ava-avatar project, open to outside accounts. GOOGLE_LOGIN_CLIENT_SECRET and the NEXT_PUBLIC_GOOGLE_ settings are gone.",
      "The Drive button gets its settings from the page: the client ID, its project number (the digits the client ID starts with) and GOOGLE_API_KEY, a browser key restricted to the Picker API and this site.",
      "Moving GOOGLE_CLIENT_ID to a new client means connecting Ava's Google again from the control room: her stored access belongs to the client that issued it.",
    ],
    commits: [],
    tone: "amber",
  },
  {
    date: "2026-10-05",
    title: "Clients can sign in with Google",
    points: [
      "The site's “Sign in with Google” can run on the Drive picker's web client, in a Google project open to outside accounts — ava-avatar: set GOOGLE_LOGIN_CLIENT_SECRET (its ID is NEXT_PUBLIC_GOOGLE_CLIENT_ID; GOOGLE_LOGIN_CLIENT_ID only for a different client). Ava's own connection to her calendar, Gmail and Drive stays on GOOGLE_CLIENT_ID; without the secret, sign-in uses it as before.",
      "A privacy notice at /privacy, public like the docs: Google asks for one before publishing the sign-in to outside accounts. It says what is kept, which services process it, and that Google data is used only for the files people pick (Limited Use).",
      "Who gets in is unchanged: NDI addresses, and the people a client was given. The emailed link still works for everyone.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "The Drive button can have a Google project of its own",
    points: [
      "Google's file picker needs an API key, a project number and an OAuth client — and they can come from their own Google Cloud project (\"Ava Avatar\"), apart from the one the sign-in uses. NEXT_PUBLIC_GOOGLE_CLIENT_ID is then that project's web client, not GOOGLE_CLIENT_ID. Nothing in the code changed: .env.example and the settings table say how.",
    ],
    commits: [],
    tone: "slate",
  },
  {
    date: "2026-10-05",
    title: "“Who can open their page”",
    points: [
      "On a client's setup, “Who signs in for them” is now “Who can open their page”, with a line saying what it is: their people who give Ava documents and prepare her. Which meetings are theirs stays the domains and addresses.",
    ],
    commits: [],
    tone: "slate",
  },
  {
    date: "2026-10-05",
    title: "Light, and a cleaner design",
    points: [
      "Every page is light now: white cards on a soft grey, the blue of her icon for actions, softer colours for what is ready, waiting or wrong. Commands in the docs stay dark, as a terminal is.",
      "One header across the signed-in pages — her mark, where you are, who you are, sign out — and the same fields, buttons and badges on every page. Sign-in is a single card under her mark.",
      "A client's meetings show their day like a calendar page; a meeting already prepared offers “Edit preparation” rather than another blue button. The control room is titled as such.",
      "Her stage (/bot), which is a video tile, keeps its dark background.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "Her own icon",
    points: [
      "The site's icon is no longer Next.js's: a participant's tile with her speaking, in the site's blue (app/icon.svg; favicon.ico and apple-icon.png made from it, with a simpler drawing at 16 px).",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-10-05",
    title: "Clients' data through Supabase's API, in the team's shared project",
    points: [
      "The team's Supabase project hands each project its schema and the project's secret key, not a database password. Her data now goes through Supabase's Data API with that key — SUPABASE_URL, SUPABASE_SCHEMA (pa-06) and SUPABASE_SERVICE_ROLE_KEY — from the server only. npm run db:migrate and DATABASE_URL are gone.",
      "db/schema.sql is pasted once into the SQL editor: the tables in pa-06, and three functions for what the API cannot say by itself — her passage search (match_chunks), copying her calendar in (sync_meetings) and the admin counts (client_summaries). Then pa-06 is added to the exposed schemas.",
      "Row security is on in pa-06 with no policies, and only service_role — the secret key's role — has access: the browser roles get nothing even with the schema exposed.",
      "Tested on a Postgres set up like Supabase (its roles, pgvector in extensions, another team's table beside hers): the script runs twice cleanly, the functions do what the app expects, and the other table came out untouched.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-05",
    title: "Her tables in a schema of their own: pa-06",
    points: [
      "Her Supabase database is shared with other projects. Everything of hers — clients, who signs in, meetings, documents, passages, sign-in links — is in the schema pa-06, which npm run db:migrate creates; it touches nothing outside it.",
      "Every query names the schema instead of relying on the search path, which the transaction pooler does not keep and which would find another project's clients or meetings first. pgvector's type and distance operator are named where it is installed (extensions, on Supabase).",
      "pgvector is not installed by her: it is enabled once for the whole database (Database → Extensions → vector). Without it the migration stops and changes nothing.",
      "Tested on a Postgres with another project's clients and meetings tables beside hers, pgvector off the search path: hers worked, theirs came out untouched.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-10-05",
    title: "Clients: one Ava, each company with its own knowledge",
    points: [
      "Everything is behind sign-in now, except signing in and these docs. NDI — every address on ADMIN_DOMAIN — signs in with Google and sees the control room and every client. A client's people sign in with Google or a link by email (15 minutes, once) and see only their own page. Nobody signs up: an admin adds them.",
      "/admin: set up a client — name, company domains or exact addresses, who signs in — and Ava emails them an invitation from her Gmail. Invites from organisers who are nobody's client are listed there; she no longer goes to them. NDI is client number one, so NDI's own meetings go on as before.",
      "/client: their meetings, each with an optional preparation — goal, agenda, people, what to avoid, notes, documents for that meeting — from which she writes her brief, shown back to them; their documents (uploads up to 4 MB, Google Drive through Google's picker, links) and “What Ava knows about” them; how she should work for them; and the notes of past meetings.",
      "In the meeting: the runner gets the app's briefing for the client — their instructions, her brief, the invite and what she knows — and her backend can search their documents (search_knowledge). Which client's is decided by the meeting she is in.",
      "Kept: files in NDI's Drive (CLIENTS_DRIVE_FOLDER), one folder per client; passages, vectors, summaries, briefs and notes in Postgres with pgvector (DATABASE_URL). OpenAI only turns passages into vectors — nothing is stored there.",
      "The older Recall stage (/bot) is behind sign-in too, out of reach of Recall's browser: that path is retired.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-30",
    title: "She leaves a minute after she is alone — and never sits in silence",
    points: [
      "In a meeting sent from the control room, everybody left at 11:15 but she stayed until the meeting was ended by hand at 12:34, with GPT-Live open the whole time. Fireflies, the notetaker, stayed in the call and was never recognised as a bot — not one “not counting” line all day — so she counted two and thought she was in a one-on-one. Her count could also read the chat button's unread-messages number as people (“Chat with everyone” matched “everyone”).",
      "Now: one minute alone and she leaves (it was five). The chat button is never read as a head count (tested: her and a Fireflies tile with three unread messages counts one).",
      "A notetaker she does not know by name no longer keeps her: she matches the names on the tiles with the names in the captions, and once everybody who has spoken has gone and what is left — two at most — has not said a word for a minute, she leaves. She only does this once tiles and captions have been seen to name people alike in that meeting, and she matches loosely, so a person who has spoken is never taken for a stranger.",
      "After three minutes with nobody — her included — saying anything, GPT-Live closes and reopens at the first words anybody says; after ten, she leaves: whatever is left in the call is not a conversation.",
      "Each change of count is logged with how it was made — tiles on screen, the people button, notetakers not counted.",
    ],
    commits: [],
    tone: "rose",
  },
  {
    date: "2026-09-30",
    title: "Her live log in the browser — and no password on her screen",
    points: [
      "https://<her screen's address>/logs shows her log and streams every new line as she writes it (logs.mjs, in her container, reading /data/logs). Everything her runner prints now goes into that file, not only her own log lines.",
      "At the request of her operator, her screen and the live log open with no password: Caddy signs every visitor in (AVA_BASIC_AUTH). Anyone who has the address can control her signed-in Chrome — her Gmail, Drive and Calendar. Clear AVA_BASIC_AUTH to have the password asked again.",
    ],
    commits: [],
    tone: "amber",
  },
  {
    date: "2026-09-30",
    title: "Her face moves to another Anam account when one runs out",
    points: [
      "Anam's free minutes run out mid-month. When Anam refuses her face for its usage limit, spend cap or plan, that account rests 24 hours (kept on her disk across restarts) and the face reconnects at once on the next account — ANAM_API_KEY_2 up to _5. Her voice carries on meanwhile; with every account used up, she carries on with it alone.",
      "An avatar belongs to the account it was made in, so each account needs its own copy of Elena. Its ID can be left out: she finds the avatar that account made itself with the first avatar's name (Anam marks those with the account's organisation). Tested with free token requests: account 1, then 2 with its avatar found, then “every account used up”.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-30",
    title: "A new Anam account",
    points: [
      "Her face now runs on a new Anam account, with that account's own Elena: an avatar belongs to the account it was made in, so the previous ID would not start a face there. Anam accepted the new key and avatar from her server.",
      "The first meeting films a new resting clip for this avatar.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-29",
    title: "Her voice straight from GPT-Live; the face only moves her lips",
    points: [
      "The noise was on her voice itself, not between sentences: the face's stream measured −104 and −112 dBFS when she was quiet, and Meet's Studio sound was already off. What the meeting heard was the face's copy of her voice — cut to 16 kHz, through Anam's servers and one more codec before Meet's own.",
      "Now the meeting hears GPT-Live's audio straight. The face is still sent a copy to move its lips, and her voice is held back by the face's lag — measured on each reply, from sending a sound to it coming back out — so lips and voice match. No added delay: the face's copy came back just as late.",
      "The face is no longer renewed in the middle of a reply. AVA_FACE_AUDIO=anam goes back to the face's copy, to compare.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-29",
    title: "Notes emailed for calendar meetings only",
    points: [
      "Meetings she is invited to on her calendar: the notes are emailed to the invite's guests when they end, as before. Meetings she is sent to from the control room: the notes are written and wait there — not emailed, and her hello no longer promises it.",
      "Gone with it: the control room's “Email the notes to” and “+ me”, the chat ask in meetings sent from the control room, the sender's-calendar and directory lookups, and the directory permission. (The sender rule could not have worked anyway: the fields it needed were dropped each time the meeting was read back — found and fixed for the new “sent from” field.)",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-29",
    title: "The notes reach everybody she can find in the meeting",
    points: [
      "Sent from the control room to a scheduled meeting, she takes every guest of its calendar invite from the sender's calendar — the call itself never shows addresses.",
      "Colleagues the call showed by name are found in the organisation's directory (people:searchDirectoryPeople), one exact match each. It needs her Google connected once more, for the directory permission; if the lookup cannot run, her log says why.",
      "Only people from outside the organisation in an unscheduled meeting stay unknown — Google never shows their addresses — and are asked in the chat.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-29",
    title: "The notes go out by themselves; no hiss between sentences",
    points: [
      "The control room is for sending her, not for sending notes. Whoever sends her from it now gets the notes automatically when the meeting ends — if their Google name was on the call or in its captions (tested: exact names, with or without accents or capitals; never somebody else's) — alongside invite guests, addresses given, and addresses typed in the chat.",
      "Her voice is clear since Meet's Studio sound is off, but the face's stream carries a steady hiss between sentences, which Studio sound had been hiding. The face's sound now reaches her microphone only while she speaks through it.",
      "Meet's audio settings are logged every meeting (turned off, already off, or not offered), and her transcript drops sound marks like “[sigh]”.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-29",
    title: "No more echo from Meet; the notes reach somebody",
    points: [
      "The echo: Meet's own “Studio sound” — Gemini rebuilding a voice to sound studio-recorded — was on for her, with “Adaptive audio”, reprocessing a voice that is already synthetic. Both are on again in every new meeting, so she switches them off as she joins. Tested in a meeting of her own: both on before, both off after.",
      "A connection Anam's SDK makes when it reconnects mid-session is now recognised as her face's too, so she can never hear her own voice.",
      "Notes: every test sent from the control room had no addresses, so nothing went out. In Meet too she now asks in the chat when nobody is to get the notes, and adds the addresses typed there (tested: posted, and read back). The control room has “+ me”, warns when the list is empty, and shows notes she wrote as soon as they are written.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-29",
    title: "Elena, and logs that survive a restart",
    points: [
      "Her face is Elena: an avatar made for NDI (Anam's Cara 4 model), in an office with the NDI sign behind her. Anam only moves her lips; her voice stays GPT-Live's.",
      "Her runner also writes its log to her disk, one file a day, two weeks kept (/data/logs). A new container used to start with an empty log, and twice a test meeting's log went with the old one before anybody read it.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-29",
    title: "Her lips move again",
    points: [
      "With the new Anam account her face never came up — every attempt was refused, and the camera showed her resting clip, which does not move its lips. The ID set as her avatar was a persona's (\"Olivia\"), not an avatar's. Set right; and a persona ID given by mistake is now turned into its avatar's by itself, and Anam's own reason for refusing is logged.",
      "Her greeting also began before the face was up, so it went through her microphone — and that choice was kept for the rest of the reply, which with the near-silence GPT-Live streams between turns could be the whole call.",
      "Now her voice goes through the face whenever it is up, taking over at the next pause if the face arrives mid-sentence; only real speech counts as a reply going on.",
      "The face is sent 16 kHz again — where Anam's lip-sync is proven — filtered properly from GPT-Live's 24 kHz: the crude conversion was the hiss in her voice. Tested offline: speech passes unchanged, everything above 8 kHz is cut by over 50 dB, and no clicks where pieces join.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-29",
    title: "A new face",
    points: [
      "A new Anam account and avatar, made from a photo — nothing else is set up in Anam: her voice stays GPT-Live's, and Anam only moves her lips to it.",
      "Anam accepted the key and the avatar. Her first meeting with it films a new resting clip; until then the camera shows her name card when the face is not live.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-29",
    title: "The notes email is always in English",
    points: [
      "Whatever language the meeting was held in, the summary email — subject, actions, notes, labels — is written in English, translating what was said and keeping names and quoted terms as they were.",
      "The captions still follow the spoken language, so the transcript it is written from stays accurate.",
    ],
    commits: [],
    tone: "sky",
  },
  {
    date: "2026-09-29",
    title: "GPT-Live in use: clearer voice, nothing open in an empty room, languages by themselves",
    points: [
      "First one-on-one on GPT-Live: she answers almost at once. Her voice now reaches her face at GPT-Live's own 24 kHz — it was being converted down to 16 kHz, which added noise and dulled it — and each reply plays through one path, never switching mid-sentence as the face comes up.",
      "The rule: no voice session and no face while she is the only one in the meeting, bots not counted. Both close within seconds of the room emptying, and reopen only when somebody is seen twice in a row — a lingering tile had reopened them once.",
      "The control room drops “How much does she join in?” and the language choice. The live view names the meeting — sent from here or from her calendar invite — and shows whether her voice session is open.",
      "Languages follow the room: the captions, and so the notes, switch to what people actually speak, from what GPT-Live hears. Meetings sent from the control room start in the language of their briefing.",
      "These docs now describe GPT-Live as how she works, with Claude as the fallback brain and the writer of the notes.",
    ],
    commits: [],
    tone: "emerald",
  },
  {
    date: "2026-09-29",
    title: "A second brain to try: OpenAI GPT-Live, with Claude",
    points: [
      "AVA_BRAIN=live: OpenAI's GPT-Live hears the meeting's sound and holds the conversation over one live connection — it listens while she speaks, takes turns and stops when talked over — instead of captions → Claude → ElevenLabs.",
      "What needs more thought or her memory of the meeting — earlier decisions, a recap, the actions, something to note, current facts — it hands to a backend: by default gpt-6-luna, run by OpenAI, with web search and two tools of ours (the meeting's record and noting an action, /api/moderator/record); or Claude through the app (/api/moderator/ask). Set by OPENAI_DELEGATION_MODEL and _EFFORT.",
      "One-on-one she talks naturally; in a group she responds when addressed. The session closes while she is alone — notetaker bots never count as people, and their captions are ignored — and renews itself before its time limit. Her face lip-syncs to the voice as it streams in.",
      "German is native quality in GPT-Live; Arabic is understood in dialect and answered in Modern Standard Arabic. $0.05 a minute, billed by the second.",
      "Built first on OpenAI's Realtime API the same day, then moved to GPT-Live, which OpenAI now recommends for conversation. Claude alone stays the default.",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-29",
    title: "English, German and Arabic",
    points: [
      "Each meeting has a language — chosen in the control room, or read from the invite. She switches the meeting's captions to it, answers in it, speaks it and writes the notes in it.",
      "Her voice (ElevenLabs Flash v2.5, multilingual) is told the language; her name is recognised in Arabic script; the notes email is right to left in Arabic.",
      "Meet offers German and five kinds of Arabic for its captions; Arabic defaults to Maghrebi (AVA_ARABIC_CAPTIONS).",
    ],
    commits: [],
    tone: "violet",
  },
  {
    date: "2026-09-28",
    title: "Send her to a Google Meet from the control room",
    points: [
      "Send now puts her own Chrome in the meeting for Google Meet links too — as her own account, straight in if she is on the invite — instead of the old Recall bot, which needed Recall, an Anam face on the app and a public URL.",
      "The control room drops the Recall-era checks and shows what matters: your Google, hers, her server and the store.",
      "Sent to a meeting that is also on her calendar, she does not walk back into it from the calendar afterwards.",
    ],
    commits: [],
    tone: "sky",
  },
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
