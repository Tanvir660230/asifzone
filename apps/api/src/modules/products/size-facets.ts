/**
 * The storefront size filter's chips. Variant sizes are free text, so one size often exists in several spellings across
 * products ("2XL/23.5" and "2XL 23.5"); the filter shows each size once, in size order (XS → 2XL, then numbers), and a
 * chosen chip matches every spelling of it.
 */

/** One size whatever its spelling: case, spaces, slashes, dashes and underscores don't count. */
export function sizeKey(size: string): string {
  return size.trim().toLowerCase().replace(/[\s/_-]+/g, " ");
}

const LETTER_RANK: Record<string, number> = {
  xxxs: 0, xxs: 1, xs: 2, s: 3, m: 4, l: 5, xl: 6, xxl: 7, "2xl": 7, xxxl: 8, "3xl": 8, "4xl": 9, "5xl": 10, "6xl": 11,
};

/** Letter sizes in wearing order first, then numeric sizes by value, then everything else ("Free size"). */
function sizeRank(size: string): number {
  const token = sizeKey(size).split(" ")[0] ?? "";
  const letter = LETTER_RANK[token];
  if (letter !== undefined) return letter;
  if (/^\d+(\.\d+)?$/.test(token)) return 100 + Number(token);
  return Number.MAX_SAFE_INTEGER;
}

export interface SizeFacet {
  /** The spelling shown on the chip and sent back as the filter value. */
  label: string;
  /** Every stored spelling of this size. */
  values: string[];
}

/** `rows`: each distinct stored size with how many variants use it. The most-used spelling labels the chip. */
export function groupSizeFacets(rows: { size: string; count: number }[]): SizeFacet[] {
  const groups = new Map<string, { size: string; count: number }[]>();
  for (const row of rows) {
    const key = sizeKey(row.size);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const facets = [...groups.values()].map((spellings) => {
    const [best] = [...spellings].sort((a, b) => b.count - a.count || Number(b.size.includes("/")) - Number(a.size.includes("/")) || a.size.localeCompare(b.size));
    return { label: best!.size, values: spellings.map((s) => s.size) };
  });
  return facets.sort((a, b) => sizeRank(a.label) - sizeRank(b.label) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** The stored sizes a size filter should match: every spelling of each chosen size (a chosen size with no stored match
 * is kept as is, so it matches nothing rather than everything). */
export function expandSizeFilter(chosen: string[], stored: string[]): string[] {
  const keys = new Set(chosen.map(sizeKey));
  const matches = stored.filter((s) => keys.has(sizeKey(s)));
  const matchedKeys = new Set(matches.map(sizeKey));
  return [...new Set([...matches, ...chosen.filter((c) => !matchedKeys.has(sizeKey(c)))])];
}
