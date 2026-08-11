/** Curated Bangla <-> English + common spelling-variant synonyms for the storefront's catalog
 * vocabulary (clothing, footwear, accessories, fragrance, prayer items). Each key maps to every
 * term that should be treated as equivalent (the key's own list does not need to include the key
 * itself — expandSearchTerms adds that automatically).
 *
 * Scope note: this is a bounded, curated dictionary of *catalog vocabulary* (a few dozen product
 * types), not a general-purpose Bangla<->English transliteration engine. A generic phonetic
 * transliterator would need to guess at arbitrary free text and inevitably produces false-positive
 * collisions; a hand-maintained list of the words shoppers actually search a clothing store for is
 * both more accurate and cheaper to run. Combined with normalizeBanglaSpelling() below (which
 * handles the vowel-length spelling variance within any single Bangla word), this covers the
 * realistic space of "customer typed it a different way" without that risk.
 */
const SYNONYM_GROUPS: string[][] = [
  // Panjabi / Kabli / Sherwani / Thobe — long-shirt menswear
  ["panjabi", "punjabi", "panjabee", "pajabi", "পাঞ্জাবি", "পান্জাবি"],
  ["kabli", "kabuli", "কাবলি", "কাবুলি"],
  ["sherwani", "শেরওয়ানি", "সেরওয়ানি"],
  ["thobe", "thawb", "jubba", "jellabiya", "থোব", "জুব্বা"],
  ["kurta", "kurti", "কুর্তা", "কুর্তি"],
  ["fatua", "ফতুয়া"],
  ["waistcoat", "vest", "ওয়েস্টকোট", "ওয়েস্ট কোট"],

  // Shirts / T-shirts / everyday tops
  ["shirt", "shirts", "sart", "শার্ট"],
  ["t-shirt", "tshirt", "tee", "t shirt", "টিশার্ট", "টি শার্ট", "টি-শার্ট"],
  ["polo", "পোলো"],
  ["top", "tops", "টপ"],

  // Bottoms
  ["pant", "pants", "trouser", "trousers", "প্যান্ট", "ট্রাউজার"],
  ["jeans", "jean", "জিন্স", "জিনস"],
  ["chino", "chinos", "চিনো"],

  // Outerwear
  ["jacket", "coat", "outerwear", "জ্যাকেট", "কোট"],
  ["sweater", "sweatshirt", "hoodie", "সোয়েটার", "হুডি"],
  ["winter", "শীত", "শীতকালীন"],

  // Women's wear
  ["abaya", "আবায়া"],
  ["hijab", "হিজাব"],
  ["scarf", "shemagh", "keffiyeh", "স্কার্ফ", "শেমাগ"],
  ["orna", "ওড়না", "উড়না"],
  ["dress", "dresses", "ড্রেস"],
  ["co-ord", "coord", "co ord", "কো-অর্ড", "কোঅর্ড"],

  // Footwear
  ["shoe", "shoes", "footwear", "জুতা", "জুতো"],
  ["sandal", "sandals", "স্যান্ডেল", "চপ্পল"],

  // Fragrance
  ["perfume", "fragrance", "cologne", "পারফিউম", "পারফিউমস"],
  ["attar", "ittar", "আতর"],

  // Headwear — cap/topi is the single most-typed example in this catalog (prayer caps),
  // so every observed script/spelling/transliteration variant is listed explicitly.
  ["cap", "hat", "topi", "tupi", "tupee", "টুপি", "টুপী", "তুপি", "তুপী", "ক্যাপ", "হ্যাট"],

  // Bags / small leather goods / watches
  ["bag", "bags", "ব্যাগ", "ব্যাগস"],
  ["wallet", "মানিব্যাগ", "ওয়ালেট"],
  ["belt", "belts", "বেল্ট"],
  ["watch", "watches", "ঘড়ি"],

  // Prayer items
  ["prayer mat", "jaynamaz", "janamaz", "jaynamaz", "জায়নামাজ", "জানামাজ"],

  // Innerwear
  ["innerwear", "underwear", "essentials", "গেঞ্জি", "ভেতরের কাপড়"],

  // Style descriptors
  ["formal", "ফরমাল"],
  ["casual", "ক্যাজুয়াল"],
  ["premium", "প্রিমিয়াম"],

  // Gender / age segments — these show up as adjectives in compound queries
  // ("men's shirt", "ছেলেদের পাঞ্জাবি"), so they need to expand too, not just match verbatim.
  ["men", "mens", "men's", "male", "পুরুষ", "ছেলেদের"],
  ["women", "womens", "women's", "female", "মহিলা", "মেয়েদের", "মহিলাদের"],
  ["kids", "kid", "children", "child", "বাচ্চা", "বাচ্চাদের", "শিশু"],
  ["boy", "boys", "ছেলে", "ছেলেদের"],
  ["girl", "girls", "মেয়ে", "মেয়েদের"],
];

/** Bangla vowel-sign pairs that are routinely typed interchangeably (they're near-identical to
 * type and, for most speakers, indistinguishable by ear) — normalizing both sides to one form
 * means a single dictionary entry (e.g. "টুপি") transparently also matches "টুপী" without needing
 * every vowel-length variant spelled out by hand. Deliberately narrow: this does NOT touch
 * consonants (e.g. ট vs ত), which change the actual sound and would cause false-positive
 * collisions between genuinely different words if normalized away.
 */
const BANGLA_VOWEL_NORMALIZATION: Array<[string, string]> = [
  ["ী", "ি"], // dirgha-i matra -> hrasva-i matra
  ["ূ", "ু"], // dirgha-u matra -> hrasva-u matra
  ["ঈ", "ই"], // independent dirgha-i -> hrasva-i
  ["ঊ", "উ"], // independent dirgha-u -> hrasva-u
];

/** Collapses the spelling-variance pairs above so lookups/comparisons are variant-insensitive.
 * Applied to every term before both synonym-map lookups and (in product.service.ts) the
 * did-you-mean vocabulary match — never applied to what's actually sent to the database query
 * itself, since Postgres `contains` still needs the literal substring to search for. */
export function normalizeBanglaSpelling(term: string): string {
  let result = term;
  for (const [variant, canonical] of BANGLA_VOWEL_NORMALIZATION) {
    result = result.split(variant).join(canonical);
  }
  return result;
}

const SYNONYM_MAP: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map((term) => normalizeBanglaSpelling(term.toLowerCase()));
    for (const term of normalized) {
      const existing = map.get(term);
      if (existing) {
        for (const t of normalized) existing.add(t);
      } else {
        map.set(term, new Set(normalized));
      }
    }
  }
  return map;
})();

/** Every distinct term the dictionary knows about — the "vocabulary" a did-you-mean spell
 * correction is allowed to suggest back to the shopper (see findClosestVocabularyTerm). */
export const SEARCH_VOCABULARY: readonly string[] = [...new Set(SYNONYM_GROUPS.flat())];

/** Expands a raw search query into every individually-searchable term: the full phrase, each
 * word in it, and any known synonyms of the phrase or of any individual word (spelling-variant
 * normalized first, so "টুপী"/"তুপি"-style variance resolves to the same synonym group as
 * "টুপি"). Multi-word queries decompose per-word — "pakistani topi" expands to include "topi"
 * (and its synonyms) even though "pakistani topi" itself isn't a dictionary phrase — instead of
 * only ever being searchable as one literal multi-word substring, which would (and previously
 * did) fail to match a product simply titled "Pakistani Cap". */
export function expandSearchTerms(query: string): string[] {
  const normalized = normalizeBanglaSpelling(query.trim().toLowerCase());
  if (!normalized) return [];

  const terms = new Set<string>([normalized]);
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const word of words) terms.add(word);

  for (const candidate of [...words, normalized]) {
    const synonyms = SYNONYM_MAP.get(candidate);
    if (synonyms) for (const synonym of synonyms) terms.add(synonym);
  }

  return [...terms];
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

/** 0..1, higher is closer. Plain edit-distance ratio — script-agnostic (works the same for Bangla
 * and Latin script, since it only compares character sequences), which is what makes this able to
 * catch cross-spelling typos that Postgres's pg_trgm word_similarity can't: trigram similarity
 * between two different scripts is ~0 even when a human would instantly recognize e.g. "তুপি" as
 * a typo of "টুপি". */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

const DID_YOU_MEAN_THRESHOLD = 0.6;

/** Best single spelling-corrected guess from the curated vocabulary (see SEARCH_VOCABULARY) for a
 * query that matched nothing — e.g. "তুপি" -> "টুপি", "pnajabi" -> "panjabi". Checked per-word so
 * a multi-word miss ("kids tupi") still finds "টুপি"/"topi"-style corrections for the word that's
 * actually misspelled. Returns null below the confidence threshold rather than guessing wildly. */
export function findClosestVocabularyTerm(query: string): string | null {
  const normalized = normalizeBanglaSpelling(query.trim().toLowerCase());
  if (!normalized) return null;

  const candidates = [normalized, ...normalized.split(/\s+/).filter(Boolean)];
  let best: { term: string; score: number } | null = null;

  for (const candidate of candidates) {
    if (SYNONYM_MAP.has(candidate)) continue; // already an exact known term, nothing to correct
    for (const vocabTerm of SEARCH_VOCABULARY) {
      const score = similarity(candidate, normalizeBanglaSpelling(vocabTerm.toLowerCase()));
      if (score >= DID_YOU_MEAN_THRESHOLD && (!best || score > best.score)) {
        best = { term: vocabTerm, score };
      }
    }
  }

  return best?.term ?? null;
}
