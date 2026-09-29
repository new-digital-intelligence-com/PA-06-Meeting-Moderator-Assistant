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

const GERMAN = new Set(
  "der die das und ist nicht mit für wir sie ich ein eine einen zu auf im den dem von bitte besprechung heute morgen über wie was auch es sind werden haben wird oder aber wenn noch schon unsere unser team termin".split(
    " ",
  ),
);

/**
 * The language a meeting starts in, from its title and briefing — the same rule her
 * runner uses for invites: mostly Arabic script is Arabic, mostly German words German,
 * anything else English. With GPT-Live she then follows what people actually speak.
 */
export function detectLang(text: string): Lang {
  const letters = text.match(/\p{L}/gu) ?? [];
  const arabic = text.match(/[؀-ۿ]/g) ?? [];
  if (letters.length && arabic.length / letters.length > 0.3) return "ar";
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length >= 4 && words.filter((w) => GERMAN.has(w)).length / words.length > 0.12) return "de";
  return "en";
}
