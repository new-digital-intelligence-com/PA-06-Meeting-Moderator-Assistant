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
