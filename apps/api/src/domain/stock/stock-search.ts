/**
 * Search on the stock page (docs/STOCK_HUB.md §7): forgiving, so the owner finds an item the way they would say it.
 *
 *   every word typed must match one of the item's words — product name, size, colour, SKU (whole or its parts) and its
 *   kind (attar, material, product) — in any order; "12ml", "12 ml" and "12" are the same size
 *   a word of 4+ letters may be one edit off (two for 8+): a typo, a missing or extra letter, two letters swapped
 *   score per word: exact 4 · starts the word 3 · inside a word 2 · a typo 1 — so the closest matches come first
 *
 * Pure: the list service scores every item in memory (it already holds them all).
 */

const KIND_WORDS: Record<string, string[]> = {
  FILL_TO_ORDER: ["attar", "perfume", "bottle", "filled"],
  MATERIAL: ["material", "materials"],
  FINISHED: ["product", "products"],
};

/** Lowercase words of a text: letters (any script) and digits; a number glued to a unit ("12ml") becomes "12", "ml". */
export function wordsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/(\d)([a-zঀ-৿])/g, "$1 $2")
    .replace(/([a-zঀ-৿])(\d)/g, "$1 $2")
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

export function searchWords(i: { productName: string; size: string | null; color: string | null; sku: string; group: string }): string[] {
  const sku = i.sku.toLowerCase();
  return [...new Set([...wordsOf(i.productName), ...wordsOf(i.size), ...wordsOf(i.color), sku, ...wordsOf(sku), ...(KIND_WORDS[i.group] ?? [])])];
}

/** Optimal string alignment distance (Levenshtein plus a swap of two neighbours), stopping early past `limit`. */
export function editDistance(a: string, b: string, limit = 3): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
  }
  return d[a.length]![b.length]!;
}

function wordScore(q: string, words: string[]): number {
  let best = 0;
  const allowed = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  for (const w of words) {
    if (w === q) return 4;
    if (w.startsWith(q)) best = Math.max(best, 3);
    else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 2);
    else if (allowed && best < 1 && (editDistance(q, w, allowed) <= allowed || (w.length > q.length && editDistance(q, w.slice(0, q.length), allowed) <= allowed))) best = 1;
  }
  return best;
}

/** 0 = no match; otherwise higher is closer. The whole query also matches a SKU as typed ("zay-12"). */
export function searchScore(query: string, words: string[]): number {
  const raw = query.trim().toLowerCase();
  if (!raw) return 1;
  // typed like a SKU (a dash or underscore, no spaces): only a SKU containing it matches — split into pieces, its parts
  // ("p1", "2") would match half the catalogue
  if (/[-_]/.test(raw) && !/\s/.test(raw)) return words.some((w) => w.includes(raw)) ? 4 : 0;
  const qs = wordsOf(raw);
  let total = 0;
  for (const q of qs) {
    const s = wordScore(q, words);
    if (!s) return 0;
    total += s;
  }
  return total;
}
