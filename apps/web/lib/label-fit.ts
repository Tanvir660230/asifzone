/**
 * Shipping-label layout engine: one label design that fits any label size, never cutting text.
 *
 * Every size of the label is in `em` of one base unit (the body text size, in CSS px). For a given label cell, the
 * engine walks the detail levels below from richest to plainest and, at each, finds the biggest base unit at which the
 * whole label still fits its cell. The first level that fits at a comfortable size wins; if none does, the plainest
 * level wins at whatever size fits, and only if even the smallest legible size doesn't fit is the label flagged
 * `overflow` (the print page then asks for a bigger label size instead of printing a cut one).
 *
 * Name, phone, the full address, COD, the courier note and the QR are never dropped (the QR only gets smaller); the
 * store's logo stays almost to the end too — the owner's call. The levels give up, in order: one line per item (the
 * products then run inline, still all named), the footer, some of the QR's size, the names of all but the first
 * products, a bare count instead of names, the logo image (a wordmark instead), and last some of the barcode's height. The DOM measuring lives in
 * LabelCard; this module is the pure part (layout pick, size bounds, level ladder, search), unit-tested on its own.
 */

export type LabelLayout = "stack" | "wide";

export interface DetailLevel {
  /** Packing list: a number = one line per item, capped (the rest becomes "+N more items"); "inline" = every item in one
   * wrapped run ("2× Oud · 12ml, 1× Panjabi · XL") — the products still named, in far less height; "summary" = one
   * "N items · M pcs" line. */
  items: number | "inline" | "summary";
  footer: boolean;
  /** The tracking QR, on every label: full size or a smaller one. */
  qr: "full" | "small";
  /** The store's logo image in the header. Off → the store name as a small wordmark. */
  logo: boolean;
  /** A shorter barcode (still well over a scanner's minimum bar height) — the very last thing given up. */
  slimBarcode: boolean;
}

/** Richest first. A label takes the first level that fits at a comfortable size. Every product named (one per line,
 * then all of them inline) comes first; then the QR shrinks before the product names are trimmed; the logo goes only
 * once the products are already down to a count. */
const RICH = { footer: true, qr: "full", logo: true, slimBarcode: false } as const;
const LEAN = { ...RICH, footer: false, qr: "small" } as const;
export const DETAIL_LEVELS: readonly DetailLevel[] = [
  { ...RICH, items: Number.POSITIVE_INFINITY },
  { ...RICH, items: "inline" },
  { ...RICH, items: "inline", footer: false },
  { ...LEAN, items: "inline" },
  { ...LEAN, items: 2 },
  { ...LEAN, items: 1 },
  { ...LEAN, items: "summary" },
  { ...LEAN, items: "summary", logo: false },
  { ...LEAN, items: "summary", logo: false, slimBarcode: true },
];

/** CSS px per mm (96 dpi), the unit the capture renders in. */
export const PX_PER_MM = 96 / 25.4;

/**
 * The off-screen label is laid out (and measured) this many times its printed size, and captured at 1/this pixel
 * ratio, so the image's resolution is unchanged. The reason is glyph rounding: on screen the browser rounds each
 * glyph's advance to the pixel grid, and at a real label's 8-9px text that rounding adds up — Bangla, with several
 * glyphs per conjunct, most of all — while the high-resolution capture keeps the exact widths. Measured on a long
 * Bangla address: 6 lines on screen vs 5 in the image at 1×, still one line apart at 4×, line for line identical at
 * 8×. The fit must measure the layout that prints — a drift wastes space one way and cuts text the other.
 * Units elsewhere in this module stay in printed px.
 */
export const LABEL_RENDER_SCALE = 8;

/** Below this body size (≈ 4.1pt) Bangla conjuncts stop reading cleanly off a thermal head — the floor for any level. */
export const MIN_UNIT_PX = 5.5;

/** Portrait-ish cells stack like Steadfast's own label; landscape cells (80×50, A4-8up) put the address and the COD
 * side by side so the barcode keeps the full width. */
export function pickLayout(wMm: number, hMm: number): LabelLayout {
  return hMm / wMm >= 0.85 ? "stack" : "wide";
}

export interface UnitBounds {
  /** Largest base unit worth trying — text bigger than this looks shouted, not designed. */
  max: number;
  /** A level that only fits below this is passed over for a plainer one at a bigger size. */
  comfortable: number;
  min: number;
}

/** Size bounds from the cell. The maximum follows the label's width (≈ 17 body-em across a stacked label, ≈ 24 across a
 * wide one) and is capped so an A4 full-page label doesn't print 40px body text. */
export function unitBounds(wMm: number, hMm: number): UnitBounds {
  const layout = pickLayout(wMm, hMm);
  const widthPx = wMm * PX_PER_MM;
  const byWidth = layout === "stack" ? widthPx / 17 : Math.min(widthPx / 24, (hMm * PX_PER_MM) / 11);
  const max = Math.max(MIN_UNIT_PX, Math.min(byWidth, 20));
  return { max, comfortable: Math.min(max, 8.5), min: MIN_UNIT_PX };
}

/** Largest unit in [lo, hi] for which `fits` holds, assuming fit is monotonic (smaller text never fits worse).
 * Returns null when even `lo` doesn't fit. Precision ≈ 0.05px — finer than a thermal dot. */
export function searchUnit(fits: (unit: number) => boolean, lo: number, hi: number): number | null {
  if (fits(hi)) return hi;
  if (!fits(lo)) return null;
  let good = lo;
  let bad = hi;
  while (bad - good > 0.05) {
    const mid = (good + bad) / 2;
    if (fits(mid)) good = mid;
    else bad = mid;
  }
  return good;
}

export interface FitResult {
  level: number;
  unit: number;
  /** True when the label doesn't fit even at the plainest level and smallest size — it would print cut. */
  overflow: boolean;
}

/** Level decision, given the best unit each level managed (null = didn't fit at the minimum). Pure, so the choice
 * between "more detail, smaller" and "less detail, bigger" is testable without a DOM. */
export function chooseLevel(bestUnits: ReadonlyArray<number | null>, bounds: UnitBounds): FitResult {
  for (let level = 0; level < bestUnits.length; level++) {
    const unit = bestUnits[level];
    if (unit != null && unit >= bounds.comfortable - 0.01) return { level, unit, overflow: false };
  }
  const last = bestUnits.length - 1;
  const plainest = bestUnits[last];
  if (plainest != null) return { level: last, unit: plainest, overflow: false };
  return { level: last, unit: bounds.min, overflow: true };
}

/** What the print page reports per label: how hard the engine had to work. */
export type FitGrade = "full" | "shortened" | "overflow";

/** "full" = every product is named on the label; "shortened" = it fit by naming fewer (or giving a count). */
export function gradeFit(fit: FitResult, itemCount: number): FitGrade {
  if (fit.overflow) return "overflow";
  const level = DETAIL_LEVELS[fit.level]!;
  // Every product named (one per line, or all inline) counts as full; a capped list or a bare count does not.
  const allItems = level.items === "inline" || (typeof level.items === "number" && level.items >= itemCount);
  return allItems ? "full" : "shortened";
}
