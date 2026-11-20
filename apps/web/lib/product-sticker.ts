/**
 * Product sticker layout rules (docs/WAREHOUSE_OPERATIONS.md §3). The stickers go on a 203 dpi thermal label printer
 * (8 dots per mm), one sticker per page, so every decision here is in millimetres.
 *
 * The QR code is the sticker's scan code: it fits any length of code at a size a thermal head prints cleanly, and the
 * camera scanner, phones and 2D scanners all read it. A Code 128 strip is added only when the code fits across the
 * sticker with every bar at least two printer dots wide (0.25 mm). Narrower bars come out of a 203 dpi head ragged or
 * merged and scan unreliably, so a long SKU gets the QR alone rather than a strip that looks fine and doesn't scan.
 */

export const STICKER_SIZES = {
  "50x25": { label: "50 × 25 mm", page: "50mm 25mm", widthMm: 50, heightMm: 25, padMm: 1.5 },
  "50x30": { label: "50 × 30 mm", page: "50mm 30mm", widthMm: 50, heightMm: 30, padMm: 1.5 },
  "38x25": { label: "38 × 25 mm", page: "38mm 25mm", widthMm: 38, heightMm: 25, padMm: 1.2 },
} as const;
export type StickerSize = keyof typeof STICKER_SIZES;

/** Narrowest bar a 203 dpi head prints cleanly: two dots. */
export const MIN_BAR_MM = 0.25;
/** Code 128's quiet zone: ten bar widths each side. BarcodeSvg bakes it into the drawing. */
const QUIET_MODULES = 20;

/** Bar-width units in a Code 128 symbol for this value, counted the way JsBarcode encodes it or a little more (never
 * less), so a "fits" answer is safe. Text uses set B, one symbol per character; an all-digit value uses set C, two
 * digits per symbol, with a switch and one more symbol for an odd digit left over. */
export function code128Modules(value: string): number {
  const allDigits = /^\d+$/.test(value) && value.length >= 2;
  const symbols = allDigits ? Math.floor(value.length / 2) + (value.length % 2) * 2 : value.length;
  return 11 * (1 + symbols + 1) + 13; // start + data + check symbols, then the 13-module stop
}

/** The Code 128 strip for this sticker, or null when the bars would be thinner than a printer can print reliably.
 * The strip is drawn at exactly `widthMm` (quiet zones included), so every bar is at least MIN_BAR_MM wide. */
export function stickerBarcode(code: string, size: StickerSize): { widthMm: number } | null {
  const s = STICKER_SIZES[size];
  const room = s.widthMm - 2 * s.padMm;
  const widthMm = (code128Modules(code) + QUIET_MODULES) * MIN_BAR_MM;
  return code && widthMm <= room ? { widthMm: Math.round(widthMm * 100) / 100 } : null;
}

/** The product name without a colour it already ends with ("Haven Jacket – Black" → "Haven Jacket"), since the sticker
 * prints the colour on its own line. Only a trailing " - colour" (any dash) is dropped. */
export function stickerName(productName: string, color: string): string {
  const name = productName.trim();
  const c = color.trim();
  if (!c) return name;
  const m = name.match(/^(.*\S)\s*[-–—]\s*(.+)$/);
  if (m && m[2]!.trim().toLowerCase() === c.toLowerCase() && m[1]!.trim()) return m[1]!.trim();
  return name;
}

/** How big the size prints in its box: the size is what a packer checks first, so short sizes print largest. */
export function stickerSizeTier(size: string): "xl" | "lg" | "md" | "sm" | "none" {
  const n = size.trim().length;
  if (n === 0) return "none";
  if (n <= 2) return "xl";
  if (n === 3) return "lg";
  if (n <= 4) return "md";
  return "sm";
}
