const STORAGE_KEY = "recently-viewed";
const MAX_ENTRIES = 20;
const BUDGET_SAMPLE_SIZE = 10;
const BUDGET_PADDING_RATIO = 0.2;

export interface RecentlyViewedEntry {
  productId: string;
  categoryId: string;
  price: number;
  viewedAt: number;
}

function readAll(): RecentlyViewedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RecentlyViewedEntry[]) : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(entry: Omit<RecentlyViewedEntry, "viewedAt">): void {
  if (typeof window === "undefined") return;
  const existing = readAll().filter((e) => e.productId !== entry.productId);
  const next = [{ ...entry, viewedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage may be unavailable (private browsing, quota) — recommendations just stay generic
  }
}

export function getRecentlyViewed(): RecentlyViewedEntry[] {
  return readAll();
}

export function getViewedCategoryIds(): string[] {
  const seen = new Set<string>();
  for (const entry of readAll()) seen.add(entry.categoryId);
  return [...seen];
}

export function getBudgetRange(): { min: number; max: number } | null {
  const prices = readAll()
    .slice(0, BUDGET_SAMPLE_SIZE)
    .map((e) => e.price);
  if (prices.length < 2) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const padding = (max - min) * BUDGET_PADDING_RATIO || min * BUDGET_PADDING_RATIO;
  return { min: Math.max(0, Math.round(min - padding)), max: Math.round(max + padding) };
}
