/**
 * Which meeting product a link belongs to. No imports on purpose: the control room (a
 * client component) and the server both use it.
 *
 * Google Meet is where she is at home — her own account, straight in. Microsoft Teams
 * she joins from the browser as a guest named Ava, and somebody admits her from the lobby.
 */

export type Platform = "meet" | "teams";

export function platformOf(url: string | undefined | null): Platform | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "meet.google.com") return "meet";
  if (host === "teams.microsoft.com" || host === "teams.live.com" || host === "teams.cloud.microsoft") return "teams";
  return null;
}

export const PLATFORM_NAME: Record<Platform, string> = { meet: "Google Meet", teams: "Microsoft Teams" };

const TEAMS_HOST = /^teams\.(microsoft\.com|live\.com|cloud\.microsoft)$/i;
const MEETUP = /\/l\/meetup-join\//i;

/** Outlook's Safe Links and Google's redirect wrap a link in their own: the one inside. */
function unwrap(href: string): string {
  try {
    const u = new URL(href);
    if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(u.hostname)) return u.searchParams.get("url") ?? href;
    if (/^(www\.)?google\.[a-z.]+$/i.test(u.hostname) && u.pathname === "/url") return u.searchParams.get("q") ?? href;
  } catch {
    /* not a URL */
  }
  return href;
}

/** A link that joins a meeting, as it is to be opened — or null for any other link. */
function joining(href: string): string | null {
  let u: URL;
  try {
    u = new URL(unwrap(href));
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase() === "meet.google.com") {
    const code = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i.exec(u.pathname)?.[1];
    return code ? `https://meet.google.com/${code.toLowerCase()}` : null;
  }
  if (!TEAMS_HOST.test(u.hostname)) return null;
  // Not Teams' other links in an invite: "Meeting options", help, the app's download.
  if (MEETUP.test(u.pathname) || /^\/meet\/\d+/i.test(u.pathname)) return u.href;
  // The launcher's and the web app's forms carry the same join path further in.
  const inner = [u.searchParams.get("url"), u.hash.slice(1)].find((s) => s && MEETUP.test(s));
  return inner ? `https://${u.hostname.toLowerCase()}${inner.slice(inner.search(MEETUP))}` : null;
}

/**
 * The first Google Meet or Microsoft Teams join link written in an invite's text — its
 * description or location, plain or HTML. An invite sent from Outlook or Teams has no
 * Meet of its own: its join link is in the description ("Join the meeting now<https://
 * teams.microsoft.com/l/meetup-join/…>"), and its location says "Microsoft Teams Meeting".
 */
export function joinLinkIn(text: string | undefined | null): string | null {
  if (!text) return null;
  for (const [href] of text.replace(/&amp;/gi, "&").matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const link = joining(href.replace(/[).,;:!?\]]+$/, ""));
    if (link) return link;
  }
  return null;
}
