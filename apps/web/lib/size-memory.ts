/** "Your size": the sizes a shopper has put in their bag on this device, most recent first, so a product page can point
 * out the one they usually take. Kept in the browser only (no account needed, nothing sent anywhere) and never
 * pre-selected: it is a hint beside the size pills, the shopper still chooses. */

const KEY = "az_size_memory_v1";
const LIMIT = 12;

/** Puts `size` first in the list, dropping an older copy of it and anything beyond the limit. */
export function rememberSize(list: readonly string[], size: string): string[] {
  const value = size.trim();
  if (!value) return [...list];
  return [value, ...list.filter((s) => s !== value)].slice(0, LIMIT);
}

/** The most recently used size this product offers and can still sell, or null. */
export function suggestSize(list: readonly string[], offered: readonly string[], inStock: (size: string) => boolean): string | null {
  return list.find((s) => offered.includes(s) && inStock(s)) ?? null;
}

export function readSizeMemory(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string").slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordSize(size: string | null | undefined): void {
  if (!size) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(rememberSize(readSizeMemory(), size)));
  } catch {
    // Storage blocked (private mode, quota): the hint simply doesn't appear.
  }
}
