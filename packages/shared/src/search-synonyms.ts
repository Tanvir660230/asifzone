/** Curated Bangla <-> English + common spelling-variant synonyms for menswear search terms.
 * Each key maps to every term that should be treated as equivalent (the key's own list
 * does not need to include the key itself — expandSearchTerms adds that automatically). */
const SYNONYM_GROUPS: string[][] = [
  ["panjabi", "punjabi", "পাঞ্জাবি"],
  ["pant", "pants", "trouser", "trousers", "প্যান্ট"],
  ["shirt", "shirts", "শার্ট"],
  ["t-shirt", "tshirt", "tee", "t shirt", "টিশার্ট"],
  ["jacket", "coat", "জ্যাকেট"],
  ["kurta", "কুর্তা"],
  ["fatua", "ফতুয়া"],
  ["blazer", "ব্লেজার"],
  ["winter", "শীত", "শীতকালীন"],
  ["sweater", "sweatshirt", "hoodie", "সোয়েটার"],
  ["shoe", "shoes", "footwear", "জুতা"],
  ["belt", "বেল্ট"],
  ["wallet", "মানিব্যাগ"],
  ["cap", "hat", "টুপি"],
  ["formal", "ফরমাল"],
  ["casual", "ক্যাজুয়াল"],
];

const SYNONYM_MAP: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map((term) => term.toLowerCase());
    for (const term of normalized) {
      map.set(term, new Set(normalized));
    }
  }
  return map;
})();

/** Expands a raw search query into itself plus any known synonyms for its individual words
 * and the full phrase — e.g. "panjabi" -> ["panjabi", "punjabi", "পাঞ্জাবি"]. */
export function expandSearchTerms(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = new Set<string>([normalized]);
  const words = normalized.split(/\s+/).filter(Boolean);

  for (const word of [...words, normalized]) {
    const synonyms = SYNONYM_MAP.get(word);
    if (synonyms) {
      for (const synonym of synonyms) terms.add(synonym);
    }
  }

  return [...terms];
}
