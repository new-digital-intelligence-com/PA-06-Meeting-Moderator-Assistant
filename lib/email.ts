/**
 * The meeting notes as an email people want to open: NDI-branded HTML, built from the
 * same plain text that is sent alongside it for mail apps that do not show HTML.
 *
 * Built from the text rather than from the model's parts, on purpose: the text is what
 * you can edit in the control room before sending, and an edit there has to show up in
 * the designed version too. The text has a fixed shape — `assemble()` in moderator.ts —
 * an opening with the actions as a numbered list, then NOTES (markdown), then FILES.
 *
 * Email clients are a hostile place for HTML: tables for layout, every style inline, no
 * images (blocked by default, so the NDI mark is type), nothing that needs a stylesheet.
 * No imports, so the control room can render the same preview in the browser.
 */

export type NotesEmail = {
  subject: string;
  /** The plain-text email, as sent: opening and actions, NOTES, FILES. */
  body: string;
  meeting: {
    title: string;
    startedAt?: number;
    endedAt?: number;
    /** Who spoke, as the captions named them. */
    participants: string[];
  };
  /** Her name, for the sign-off. */
  assistant?: string;
};

const RED = "#D7141A";
const INK = "#111827";
const TEXT = "#374151";
const MUTED = "#6B7280";
const LINE = "#E5E7EB";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Bold, italics, links and bare URLs, on already-escaped text. */
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${INK};font-weight:600">$1</strong>`)
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" style="color:${RED};text-decoration:underline">$1</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, `$1<a href="$2" style="color:${RED};text-decoration:underline">$2</a>`);
}

/** The small markdown the notes use: headings, bullet and numbered lists, paragraphs. */
function markdown(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const open = (kind: "ul" | "ol") => {
    if (list === kind) return;
    close();
    list = kind;
    out.push(`<${kind} style="margin:0 0 14px;padding-left:20px;color:${TEXT};font-size:15px;line-height:24px">`);
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (heading) {
      close();
      const size = heading[1].length <= 2 ? 17 : 15;
      out.push(
        `<h3 style="margin:22px 0 8px;font-size:${size}px;line-height:24px;font-weight:600;color:${INK}">${inline(heading[2])}</h3>`,
      );
    } else if (bullet) {
      open("ul");
      out.push(`<li style="margin:0 0 6px">${inline(bullet[1])}</li>`);
    } else if (numbered) {
      open("ol");
      out.push(`<li style="margin:0 0 6px">${inline(numbered[1])}</li>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p style="margin:0 0 14px;color:${TEXT};font-size:15px;line-height:24px">${inline(line)}</p>`);
    }
  }
  close();
  return out.join("\n");
}

/** Splits the plain text back into its parts. */
function parts(body: string) {
  const text = body.replace(/\r\n/g, "\n");
  const notesAt = text.search(/^NOTES\s*$/m);
  const filesAt = text.search(/^FILES\s*$/m);
  const end = (from: number) => [notesAt, filesAt, text.length].filter((i) => i > from).sort((a, b) => a - b)[0];

  const opening = text.slice(0, notesAt >= 0 ? notesAt : filesAt >= 0 ? filesAt : text.length).trim();
  const notes = notesAt >= 0 ? text.slice(notesAt + 5, end(notesAt)).trim() : "";
  const files =
    filesAt >= 0
      ? text
          .slice(filesAt + 5, end(filesAt))
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const url = l.match(/https?:\/\/\S+/)?.[0] ?? "";
            return { name: l.replace(url, "").replace(/[:\s-]+$/, "").trim() || url, url };
          })
      : [];

  // The opening: its sentences, and the actions as a numbered list.
  const intro: string[] = [];
  const actions: string[] = [];
  for (const line of opening.split("\n")) {
    const item = line.match(/^\s*(?:\d+[.)]|[-*•])\s+(.*)$/);
    if (item) actions.push(item[1].trim());
    else if (line.trim() && !/^actions?:?$/i.test(line.trim())) intro.push(line.trim());
  }
  return { intro, actions, notes, files };
}

/** "Helmi — send the deck (by Friday)": the owner and the date picked out, when they are there. */
function action(text: string) {
  let rest = text;
  let owner = "";
  let due = "";
  const by = rest.match(/\s*[(\[]\s*(?:by|due)\s+([^)\]]+)[)\]]\s*\.?$/i) ?? rest.match(/\s+[—–-]\s+(?:by|due)\s+(.+?)\.?$/i);
  if (by) {
    due = by[1].trim();
    rest = rest.slice(0, by.index).trim();
  }
  const who = rest.match(/^\*{0,2}([^—–:*]{2,40}?)\*{0,2}\s*(?:—|–|:| - )\s+(.+)$/);
  if (who) {
    owner = who[1].trim();
    rest = who[2].trim();
  }
  return { owner, text: rest, due };
}

function when(m: NotesEmail["meeting"]): string {
  const bits: string[] = [];
  if (m.startedAt) {
    bits.push(
      new Date(m.startedAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
    );
    if (m.endedAt && m.endedAt > m.startedAt) {
      const mins = Math.max(1, Math.round((m.endedAt - m.startedAt) / 60_000));
      bits.push(mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`);
    }
  }
  return bits.join(" · ");
}

const section = (title: string, content: string) => `
<tr><td style="padding:28px 40px 0">
  <p style="margin:0 0 14px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${RED}">${title}</p>
  ${content}
</td></tr>`;

export function renderNotesEmail({ subject, body, meeting, assistant = "Ava" }: NotesEmail): string {
  const { intro, actions, notes, files } = parts(body);
  const people = meeting.participants.filter(Boolean);
  const meta = [when(meeting), people.length ? `${people.length} ${people.length === 1 ? "participant" : "participants"}` : ""]
    .filter(Boolean)
    .join(" · ");

  const actionRows = actions.length
    ? actions
        .map((raw, i) => {
          const a = action(raw);
          return `
      <tr>
        <td valign="top" width="36" style="padding:12px 0 12px 0;border-top:${i ? `1px solid ${LINE}` : "0"}">
          <div style="width:24px;height:24px;border-radius:12px;background:${RED};color:#ffffff;font-size:12px;line-height:24px;font-weight:700;text-align:center">${i + 1}</div>
        </td>
        <td valign="top" style="padding:12px 0;border-top:${i ? `1px solid ${LINE}` : "0"}">
          <p style="margin:0;font-size:15px;line-height:22px;color:${INK}">${inline(a.text)}</p>
          ${
            a.owner || a.due
              ? `<p style="margin:6px 0 0;font-size:13px;line-height:18px;color:${MUTED}">${
                  a.owner ? `<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:#F3F4F6;color:${INK};font-weight:600">${esc(a.owner)}</span>` : ""
                }${a.owner && a.due ? "&nbsp;&nbsp;" : ""}${
                  a.due ? `<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:#FEF2F2;color:${RED};font-weight:600">Due ${esc(a.due)}</span>` : ""
                }</p>`
              : ""
          }
        </td>
      </tr>`;
        })
        .join("")
    : `<tr><td style="padding:4px 0;font-size:15px;line-height:22px;color:${MUTED}">No actions were agreed in this meeting.</td></tr>`;

  const fileList = files
    .map(
      (f) => `
      <tr><td style="padding:0 0 10px">
        <a href="${esc(f.url)}" style="display:block;padding:12px 16px;border:1px solid ${LINE};border-radius:10px;color:${INK};font-size:14px;line-height:20px;text-decoration:none">
          <span style="color:${RED};font-weight:700">&#8599;</span>&nbsp;&nbsp;${esc(f.name)}
        </a>
      </td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(intro[0] ?? `Notes from ${meeting.title}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6">
<tr><td align="center" style="padding:32px 12px">

<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE}">
  <tr><td style="height:6px;background:${RED};font-size:0;line-height:0">&nbsp;</td></tr>

  <tr><td style="padding:28px 40px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:26px;line-height:28px;font-weight:800;letter-spacing:-0.5px;color:${RED}">NDI</td>
      <td align="right" style="font-size:12px;line-height:16px;color:${MUTED}">
        <span style="font-weight:600;color:${INK}">Meeting Assistant</span><br>New Digital Intelligence · PA-06
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:28px 40px 0">
    <p style="margin:0 0 6px;font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED}">Meeting notes</p>
    <h1 style="margin:0;font-size:26px;line-height:32px;font-weight:700;color:${INK}">${esc(meeting.title || subject)}</h1>
    ${meta ? `<p style="margin:8px 0 0;font-size:14px;line-height:20px;color:${MUTED}">${esc(meta)}</p>` : ""}
    ${
      people.length
        ? `<p style="margin:14px 0 0;font-size:13px;line-height:26px">${people
            .map((p) => `<span style="display:inline-block;margin:0 6px 0 0;padding:2px 10px;border-radius:12px;background:#F3F4F6;color:${TEXT}">${esc(p)}</span>`)
            .join("")}</p>`
        : ""
    }
  </td></tr>

  ${
    intro.length
      ? `<tr><td style="padding:24px 40px 0">${intro
          .map((l) => `<p style="margin:0 0 10px;font-size:16px;line-height:26px;color:${TEXT}">${inline(l)}</p>`)
          .join("")}</td></tr>`
      : ""
  }

  ${section(
    `Actions${actions.length ? ` · ${actions.length}` : ""}`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;border:1px solid ${LINE};border-radius:12px;padding:4px 16px">${actionRows}</table>`,
  )}

  ${notes ? section("Summary", markdown(notes)) : ""}

  ${files.length ? section("Files", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fileList}</table>`) : ""}

  <tr><td style="padding:32px 40px 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
      <td width="44" valign="top" style="padding:20px 0 0">
        <div style="width:32px;height:32px;border-radius:16px;background:${RED};color:#ffffff;font-size:15px;line-height:32px;font-weight:700;text-align:center">${esc(assistant.charAt(0).toUpperCase())}</div>
      </td>
      <td valign="top" style="padding:20px 0 0;font-size:13px;line-height:20px;color:${MUTED}">
        <span style="color:${INK};font-weight:600">${esc(assistant)}</span>, NDI's meeting assistant, wrote these notes from the live transcript.
        Captions can mishear — reply to this email to correct anything.
      </td>
    </tr></table>
  </td></tr>
</table>

<p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#9CA3AF">New Digital Intelligence · Meeting Assistant PA-06</p>
</td></tr>
</table>
</body>
</html>`;
}
