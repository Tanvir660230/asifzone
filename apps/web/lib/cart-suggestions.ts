/** Merges suggestion lists (most relevant list first) into one row: each product once, nothing already in the bag, and
 * only what can be bought right now (`inStock` is the caller's reading of the server-derived availability). */
export function pickCartSuggestions<T extends { id: string }>(
  sources: readonly (readonly T[])[],
  inBag: ReadonlySet<string>,
  inStock: (product: T) => boolean,
  limit = 8,
): T[] {
  const seen = new Set(inBag);
  const picked: T[] = [];
  for (const list of sources) {
    for (const product of list) {
      if (picked.length >= limit) return picked;
      if (seen.has(product.id) || !inStock(product)) continue;
      seen.add(product.id);
      picked.push(product);
    }
  }
  return picked;
}
