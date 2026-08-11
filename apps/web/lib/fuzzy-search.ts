// Typo-tolerant matching for short pick-list values (e.g. Bangladesh division/district names)
// so a misspelled search query ("Dkha", "Chittagng") still surfaces the intended option.

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
  const q = query.trim();
  if (!q) return [...items];
  return items
    .map((item) => ({ item, score: fuzzyScore(q, getLabel(item)) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
