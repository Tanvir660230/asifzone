import type { StockItem } from "@/lib/api/stock";

/** Whole numbers with thousands separators; at most 2 decimals. */
export const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const BLANK = new Set(["", "-", "standard", "default"]);
const part = (s: string | null) => (s && !BLANK.has(s.trim().toLowerCase()) ? s.trim() : null);

/** The variant's own words: "M/22 · Black", "6ml"; the SKU when it has none. */
export function variantWords(i: Pick<StockItem, "size" | "color" | "sku">): string {
  return [part(i.size), part(i.color)].filter(Boolean).join(" · ") || i.sku;
}
export const sizeOf = (i: StockItem) => part(i.size);
export const colorOf = (i: StockItem) => part(i.color);

/** "6 sizes", "3 colours", "2 colours × 6 sizes". */
export function spreadWords(items: StockItem[]): string {
  const sizes = new Set(items.map((i) => part(i.size) ?? "")).size;
  const colors = new Set(items.map((i) => part(i.color) ?? "")).size;
  const w = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (colors <= 1) return sizes > 1 ? w(sizes, "size") : w(items.length, "variant");
  if (sizes <= 1) return w(colors, "colour");
  return `${w(colors, "colour")} × ${w(sizes, "size")}`;
}

/** A material's name without its variant's filler ("Attar gift box — Standard" → "Attar gift box"). */
export const materialName = (name: string) => name.replace(/\s+—\s+(standard|default)$/i, "");

export interface ProductGroup {
  productId: string;
  name: string;
  items: StockItem[];
  stock: number;
  reserved: number;
  value: number | null;
  low: number;
}

/** Variants grouped by product, in the overview's order. */
export function byProduct(items: StockItem[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const i of items) {
    const g = map.get(i.productId) ?? { productId: i.productId, name: i.productName, items: [], stock: 0, reserved: 0, value: null, low: 0 };
    g.items.push(i);
    g.stock += Math.max(0, i.stock);
    g.reserved += i.reserved;
    if (i.value !== null) g.value = (g.value ?? 0) + i.value;
    if (i.low && (i.stock > 0 || i.usedPerDay)) g.low += 1;
    map.set(i.productId, g);
  }
  return [...map.values()];
}

/** "6ml" → "6 ml" for display. */
export const spacedUnit = (s: string) => s.replace(/^(\d+(?:\.\d+)?)\s*(ml|g|kg|l)$/i, "$1 $2");

export const todayLocal = () => new Date().toLocaleDateString("en-CA");
