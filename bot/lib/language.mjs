// The meeting's language, for her runner: English, German or Arabic. It decides the
// captions she switches on — Meet and Teams caption one spoken language — her voice, and
// what she types in the Teams chat. The app (lib/languages.ts) holds the same three.

/** How each product names the spoken language in its caption settings. */
export const CAPTION_LANGUAGE = {
  meet: {
    en: /^english$/i,
    de: /^german$/i,
    // Meet offers Egyptian, Levantine, Maghrebi, Gulf and UAE Arabic; pick the one your
    // meetings speak with AVA_ARABIC_CAPTIONS (e.g. "Arabic (Egypt)").
    ar: new RegExp(`^${(process.env.AVA_ARABIC_CAPTIONS || "Arabic (Maghrebi)").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
  },
  teams: {
    en: /^english \(united states\)|^english$/i,
    de: /^german \(germany\)|^german|^deutsch/i,
    ar: new RegExp(process.env.AVA_ARABIC_CAPTIONS_TEAMS || "^arabic", "i"),
  },
};

/** "Grand Automative's", "Siemens'": whose assistant she is, in English. */
export const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * What she types in the Teams chat to collect emails for the notes. `owner` is whose
 * assistant she is: the client's in a client's meeting — never NDI's there — NDI's otherwise.
 */
export const CHAT_ASK = {
  en: (name, owner = "NDI") =>
    `Hi, I'm ${name}, ${possessive(owner)} meeting assistant. I'll email a summary with the actions after the meeting — type your email address here if you'd like it.`,
  de: (name, owner = "NDI") =>
    `Hallo, ich bin ${name}, die Besprechungsassistentin von ${owner}. Nach der Besprechung schicke ich eine Zusammenfassung mit den Aufgaben per E-Mail — schreiben Sie Ihre E-Mail-Adresse hier in den Chat, wenn Sie sie möchten.`,
  ar: (name, owner = "NDI") =>
    `مرحباً، أنا ${name === "Ava" ? "آفا" : name}، مساعدة الاجتماعات في ${owner}. سأرسل ملخصاً بالمهام بعد الاجتماع — اكتبوا بريدكم الإلكتروني هنا إذا أردتموه.`,
};

export const langOf = (v) => (v === "de" || v === "ar" ? v : "en");

const GERMAN = new Set(
  "der die das und ist nicht mit für wir sie ich ein eine einen zu auf im den dem von bitte besprechung heute morgen über wie was auch es sind werden haben wird oder aber wenn noch schon unsere unser team termin".split(
    " ",
  ),
);

/**
 * The language of a calendar invite. "Language: German" (or Sprache: / اللغة:) in the
 * description decides it; otherwise mostly Arabic script is Arabic, mostly German words
 * are German, and anything else is English.
 */
export function detectLanguage(text) {
  const t = String(text || "");
  const said = t.match(/(?:language|sprache|اللغة)\s*[:：]\s*([\p{L}]+)/iu)?.[1]?.toLowerCase();
  if (said) {
    if (/^(german|deutsch|allemand|الألمانية)/.test(said)) return "de";
    if (/^(arabic|arabisch|arabe|العربية|عربي)/.test(said)) return "ar";
    if (/^(english|englisch|anglais|الإنجليزية)/.test(said)) return "en";
  }
  const letters = t.match(/\p{L}/gu) ?? [];
  const arabic = t.match(/[؀-ۿ]/g) ?? [];
  if (letters.length && arabic.length / letters.length > 0.3) return "ar";
  const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length >= 4 && words.filter((w) => GERMAN.has(w)).length / words.length > 0.12) return "de";
  return "en";
}
