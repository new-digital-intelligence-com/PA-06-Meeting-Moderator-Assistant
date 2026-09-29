/**
 * The languages she works in: English, German and Arabic.
 *
 * One per meeting. Her ears are the meeting's own captions, and Meet and Teams caption a
 * single spoken language, chosen in their settings — so the meeting's language decides
 * the captions she switches on, the language she answers in, her voice, and the notes.
 * No imports: the control room uses this too.
 */

export type Lang = "en" | "de" | "ar";

export const LANGUAGES: Record<Lang, { name: string; native: string; dir: "ltr" | "rtl"; locale: string }> = {
  en: { name: "English", native: "English", dir: "ltr", locale: "en-GB" },
  de: { name: "German", native: "Deutsch", dir: "ltr", locale: "de-DE" },
  ar: { name: "Arabic", native: "العربية", dir: "rtl", locale: "ar" },
};

export function langOf(v: unknown): Lang {
  return v === "de" || v === "ar" ? v : "en";
}
