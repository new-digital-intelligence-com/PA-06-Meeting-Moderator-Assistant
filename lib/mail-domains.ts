/** Shared mail providers: a domain like these is everybody, so it can only ever be an address. */
export const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.de", "gmx.net", "web.de", "yandex.com", "mail.com",
]);

export const emailDomain = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";
