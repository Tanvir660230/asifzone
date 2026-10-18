/**
 * Recognising the same customer question however it is typed — Bangla script, Banglish, English, typos, greetings —
 * without an AI call. A question becomes a small set of canonical words ("দাম কত ভাই?" and "daaam koto bhai" both become
 * {price}); two questions match when their sets (allowing small typos) mostly overlap.
 */

/** At or above this a question counts as the same as a saved answer's example. Tuned so "how do I order" ≠ "how do I
 * cancel my order" (text-match.test.ts). */
export const MATCH_THRESHOLD = 0.75;

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bangla-script words → the Banglish/English word the rest of the table knows. */
const BANGLA: Record<string, string> = {
  দাম: "price", কত: "koto", টাকা: "taka", ডেলিভারি: "delivery", ডেলিভারী: "delivery", চার্জ: "charge", অর্ডার: "order",
  কিভাবে: "how", কীভাবে: "how", কেমনে: "how", কোথায়: "where", দোকান: "shop", শপ: "shop", শোরুম: "shop", দিন: "din",
  লাগে: "lage", লাগবে: "lagbe", সাইজ: "size", চার্ট: "chart", আছে: "ache", হবে: "hobe", যাবে: "jabe", করবো: "korbo", করব: "korbo",
  করতে: "korte", করা: "kora", ক্যাশ: "cash", অন: "on", ভাই: "bhai", আপু: "apu", ঢাকা: "dhaka", চট্টগ্রাম: "chittagong",
  বিকাশ: "bkash", নগদ: "nagad", পেমেন্ট: "payment", বাতিল: "cancel", ক্যানসেল: "cancel", রিটার্ন: "return", ফেরত: "return",
  এক্সচেঞ্জ: "exchange", বদল: "exchange", কি: "ki", কী: "ki", এর: "er", এ: "e", আমি: "ami", আমার: "amar", আপনার: "apnar",
  আপনাদের: "apnader", প্লিজ: "plz", সালাম: "salam", আসসালামু: "assalamu", আলাইকুম: "alaikum", কালার: "color", রং: "color",
};

/** Spellings (after repeated letters are folded: "daaam" → "dam") → one canonical word. */
const SYNONYMS: Record<string, string> = {
  dam: "price", dm: "price", price: "price", prize: "price", prc: "price", rate: "price", taka: "price", tk: "price",
  delivery: "delivery", delivary: "delivery", deliveri: "delivery", dilivery: "delivery", delevery: "delivery", delivry: "delivery", delivari: "delivery",
  charge: "charge", charj: "charge", charg: "charge", chrg: "charge", chage: "charge", fe: "charge", fes: "charge",
  order: "order", ordar: "order", odr: "order", ordr: "order",
  kivabe: "how", kibhabe: "how", kibabe: "how", kivbe: "how", kemne: "how", kemone: "how", kmne: "how", how: "how",
  kothay: "where", kothai: "where", kotha: "where", where: "where", location: "where", lokesan: "where",
  shop: "shop", dokan: "shop", store: "shop", showroom: "shop", outlet: "shop",
  din: "day", day: "day", days: "day", lage: "take", lagbe: "take", lagbo: "take", lgbe: "take", take: "take",
  cod: "cod", size: "size", saiz: "size", sise: "size", chart: "chart",
  cancel: "cancel", cansel: "cancel", batil: "cancel", return: "return", ferot: "return", exchange: "exchange", bodol: "exchange", bodlano: "exchange", bodlabo: "exchange",
  payment: "payment", pay: "payment", pement: "payment", bkash: "bkash", bikash: "bkash", nagad: "nagad",
  chitagong: "chittagong", ctg: "chittagong", chatogram: "chittagong", chotogram: "chittagong", dhaka: "dhaka",
  color: "color", colour: "color", kalar: "color", rong: "color",
};

/** Greetings, politeness, pronouns and filler: they never decide what is being asked. */
const STOPWORDS = new Set(
  (
    "koto kto ki kii ta to ti e te er r ar and a an the is are i me my ami amar amake apni apnar apnader apnara amader tumi " +
    "vai bhai bro apu apa sir madam mam vaiya bhaiya plz pls please assalamu assalamualaikum alaikum salam salaam hi hello hlw ok okay " +
    "jante chai chaisi bolen bolben bolun janaben jabe hobe ache ase korbo korte kori kora korar korben korlam do does can will of in on for " +
    "with gula gulo ekta akta ei eta oi ota na naki kina ke jodi tahole niye nite dite dao den deben diben dio pathan pathaben pathiye " +
    "pathao send pabo pai kemon ace hoy hoi"
  )
    .split(" ")
    .map(fold),
);

/** "daaam" → "dam", "plzzz" → "plz": repeated letters are how people stress words, not different words. */
function fold(word: string): string {
  return word.replace(/(\p{L})\1+/gu, "$1");
}

/** A question as its sorted set of canonical words. */
export function normalizeQuestion(text: string): string[] {
  const ascii = text.toLowerCase().replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
  const words = ascii
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => BANGLA[w] ?? w)
    .join(" ")
    .replace(/\bcash on deliv\w*/g, "cod")
    .replace(/\bc o d\b/g, "cod")
    .split(" ")
    .map((w) => {
      const f = fold(w);
      return SYNONYMS[f] ?? SYNONYMS[w] ?? f;
    })
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  return [...new Set(words)].sort();
}

function trigrams(word: string): Set<string> {
  const padded = ` ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function dice<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return (2 * common) / (a.size + b.size);
}

/** Two words are the same if equal, or (both 5+ letters) a near-identical spelling. */
function sameWord(a: string, b: string): boolean {
  return a === b || (a.length >= 5 && b.length >= 5 && dice(trigrams(a), trigrams(b)) >= 0.6);
}

/** 0…1: how far two questions ask the same thing (overlap of their canonical words, typo-tolerant). */
export function questionSimilarity(a: string | string[], b: string | string[]): number {
  const A = typeof a === "string" ? normalizeQuestion(a) : a;
  const B = typeof b === "string" ? normalizeQuestion(b) : b;
  if (!A.length || !B.length) return 0;
  const used = new Set<number>();
  let matched = 0;
  for (const x of A) {
    const j = B.findIndex((y, i) => !used.has(i) && sameWord(x, y));
    if (j >= 0) {
      used.add(j);
      matched++;
    }
  }
  return matched / (A.length + B.length - matched);
}

/** 0…1: how alike two replies are (shared words). Used to tell "staff keep giving the same answer" from one-off replies. */
export function answerSimilarity(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean));
  return dice(words(a), words(b));
}
