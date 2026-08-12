// Typo-tolerant matching for short pick-list values (e.g. Bangladesh division/district names)
// so a misspelled search query ("Dkha", "Chittagng") still surfaces the intended option.

// --- Bangla script support --------------------------------------------------------------------
// District/area names are stored in English, but a shopper typing on a Bangla phone keyboard
// searches in Bangla script. There's no dictionary of place-name translations to maintain here
// (and no way to guarantee one stays complete as areas get added) — instead this romanizes Bangla
// script character-by-character using the standard consonant+matra rules, close enough that the
// typo-tolerant scoring below still lands on the right English option (e.g. Bangla for "Gulshan"
// romanizes to roughly "guloshano", well within edit-distance tolerance of "gulshan").
//
// Every Bangla codepoint below is written as a \u escape rather than a literal glyph. This file's
// own save path has proven inconsistent about composed vs. decomposed Unicode normalization for
// literal Bangla text (concretely: the nukta letters ড়/ঢ়/য় can silently end up
// stored as two codepoints — base consonant + combining nukta ় — instead of one), which would
// silently break the lookup tables below. \u escapes are plain ASCII, so they can't be renormalized.

const BANGLA_INDEPENDENT_VOWELS: Record<string, string> = {
  "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u",
  "ঋ": "ri", "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
};

// Vowel signs (matras) are Unicode combining marks — must stay quoted as string keys since a bare
// combining character isn't a valid object-property identifier.
const BANGLA_VOWEL_SIGNS: Record<string, string> = {
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u",
  "ৃ": "ri", "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
};

const BANGLA_CONSONANTS: Record<string, string> = {
  "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
  "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "n",
  "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n",
  "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
  "প": "p", "ফ": "ph", "ব": "b", "ভ": "bh", "ম": "m",
  "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh",
  "স": "s", "হ": "h", "ৎ": "t", "ং": "ng", "ঃ": "h",
  "ড়": "r", // ড় (nukta ra)
  "ঢ়": "rh", // ঢ় (nukta rha)
  "য়": "y", // য় (nukta ya)
};

const BANGLA_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

const BANGLA_HASANTA = "্";
const BANGLA_CHANDRABINDU = "ঁ"; // nasalization mark — dropped, no useful Latin equivalent
const BANGLA_RANGE = /[ঀ-৿]/;

export function isBanglaText(text: string): boolean {
  return BANGLA_RANGE.test(text);
}

// Folds the decomposed nukta-letter spelling (base consonant ড/ঢ/য + combining nukta
// ়) to the precomposed codepoint (ড়/ঢ়/য়) that BANGLA_CONSONANTS is keyed by.
// Unicode normalization (NFC) does NOT do this merge — these three letters are on the composition
// exclusion list — so phone-keyboard input using the decomposed form has to be folded explicitly.
function foldBanglaNukta(text: string): string {
  return text
    .replace(/ড়/g, "ড়")
    .replace(/ঢ়/g, "ঢ়")
    .replace(/য়/g, "য়");
}

/** Romanizes Bangla script to an approximate Latin phonetic spelling. Not a linguistically exact
 * transliteration — just consistent enough to fall within fuzzyScore's edit-distance tolerance of
 * the target English name. */
export function transliterateBanglaToLatin(rawText: string): string {
  const text = foldBanglaNukta(rawText);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === BANGLA_CHANDRABINDU) continue;
    if (ch in BANGLA_DIGITS) {
      out += BANGLA_DIGITS[ch];
      continue;
    }
    if (ch in BANGLA_CONSONANTS) {
      const next = text[i + 1];
      if (next === BANGLA_HASANTA) {
        out += BANGLA_CONSONANTS[ch]!;
        i++; // skip hasanta, suppress the inherent vowel
      } else if (next !== undefined && next in BANGLA_VOWEL_SIGNS) {
        out += BANGLA_CONSONANTS[ch]! + BANGLA_VOWEL_SIGNS[next]!;
        i++;
      } else {
        out += BANGLA_CONSONANTS[ch]! + "o"; // inherent vowel
      }
      continue;
    }
    out += BANGLA_INDEPENDENT_VOWELS[ch] ?? ch; // vowel, or pass through (spaces, Latin, punctuation)
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + substitutionCost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

// Distance from the query to its closest-matching substring of `target`, so a typo in the
// middle of a longer name (e.g. "Dhka" inside a longer district name) still scores well.
function bestSubstringDistance(query: string, target: string): number {
  if (target.length <= query.length) return levenshtein(query, target);
  let best = Infinity;
  for (let i = 0; i <= target.length - query.length; i++) {
    const distance = levenshtein(query, target.slice(i, i + query.length));
    if (distance < best) best = distance;
    if (best === 0) break;
  }
  return Math.min(best, levenshtein(query, target));
}

/** Higher is a better match; -1 means "not a match". */
export function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.trim().toLowerCase();
  if (!q) return 0;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - (t.length - q.length);
  if (t.includes(q)) return 700 - t.indexOf(q);
  const distance = bestSubstringDistance(q, t);
  const tolerance = Math.max(1, Math.ceil(q.length * 0.4));
  if (distance > tolerance) return -1;
  return 500 - distance * 20;
}

export function fuzzyFilter<T>(query: string, items: readonly T[], getLabel: (item: T) => string): T[] {
  const raw = query.trim();
  if (!raw) return [...items];
  const q = isBanglaText(raw) ? transliterateBanglaToLatin(raw) : raw;
  return items
    .map((item) => ({ item, score: fuzzyScore(q, getLabel(item)) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
