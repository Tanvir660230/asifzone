/**
 * Product sticker geometry, 50 × 25 mm, in whole printer dots (docs/WAREHOUSE_OPERATIONS.md §3).
 *
 * The sticker is drawn into a bitmap exactly one pixel per printer dot (203 dpi: 400 × 200, 300 dpi: 591 × 295), so
 * nothing is resampled on the way to the head. Code 128 bars and QR squares are whole dots:
 *   - bars: at least 0.125 mm (1 dot at 203, 2 at 300), then the widest whole number of dots that fits, with a
 *     10-module quiet zone each side;
 *   - QR: 3 dots a square at 203, 4 at 300 (≈ 0.35 mm), with a 4-module quiet zone clear of every other mark.
 * The layout: framed tag, logo + tagline, the sticker name, a dark tag pill, a column line, SIZE and COLOR cells, a rule,
 * Code 128 + its text on the left, the QR on the right. Pure — the drawing lives in sticker-canvas.ts.
 */

export type StickerDpi = 203 | 300;
export const STICKER_DOTS_PER_MM: Record<StickerDpi, number> = { 203: 8, 300: 300 / 25.4 };
export const STICKER_MM = { w: 50, h: 25 } as const;

export interface StickerGeometry {
  W: number;
  H: number;
  line: number;
  frame: { inset: number; width: number; radius: number };
  L: number;
  R: number;
  T: number;
  B: number;
  col: number;
  colBottom: number;
  rule: number;
  logo: { x: number; y: number; h: number };
  pill: { y: number; h: number; pad: number; radius: number };
  name: { y: number; size: number };
  leftW: number;
  cells: { x: number; w: number; h: number; sizeY: number; colorY: number; labelW: number; radius: number };
  bars: { x: number; y: number; module: number; height: number; modules: number };
  qr: { x: number; y: number; module: number; cells: number };
  codeText: { x: number; y: number; size: number; maxW: number };
  font: { tagline: number; label: number; size: number; color: number; tag: number };
}

export class StickerLayoutError extends Error {}

/** Lays the sticker out for a Code 128 of `barModules` modules and a QR of `qrCells` squares a side. */
export function stickerGeometry(dpi: StickerDpi, barModules: number, qrCells: number): StickerGeometry {
  const d = STICKER_DOTS_PER_MM[dpi];
  const D = (mm: number) => Math.round(mm * d);
  const W = D(STICKER_MM.w), H = D(STICKER_MM.h);
  const line = Math.max(2, D(0.25));
  const L = D(2.625), R = D(47.375), T = D(2.25), B = D(22.75), COL = D(29.375), RULE = D(13.25);
  const RCx = COL + D(1.25), RCw = R - RCx;
  const frameW = D(0.375), frameIn = D(0.5);
  const frameInnerR = W - frameIn - frameW;
  const frameInnerB = H - frameIn - frameW;

  // QR: centred under the cells, its quiet zone clear of the cells above and the frame below.
  const qm = dpi === 203 ? 3 : 4;
  const qs = qrCells * qm, qq = 4 * qm;
  const cellsBottom = T + D(10);
  let qx = RCx + Math.round((RCw - qs) / 2);
  const qy = cellsBottom + qq + Math.round((frameInnerB - D(0.5) - qq - (cellsBottom + qq) - qs) / 2);
  if (qx + qs + qq > frameInnerR - D(0.5)) qx = frameInnerR - D(0.5) - qq - qs;
  if (qy < cellsBottom + qq || qy + qs + qq > frameInnerB - D(0.5)) throw new StickerLayoutError("The QR code doesn't fit this sticker");

  // Code 128: the widest whole-dot module (≥ 0.125 mm) whose right quiet zone ends before the column line.
  const minBm = Math.ceil(0.125 * d - 1e-9);
  const room = (m: number) => COL - (L + barModules * m) >= 10 * m;
  let bm = minBm;
  while (room(bm + 1)) bm++;
  let colBottom = COL;
  if (!room(bm)) colBottom = L + barModules * bm + 10 * bm; // long bars push the lower column line right…
  if (colBottom + line > qx - qq) qx = frameInnerR - D(0.5) - qq - qs; // …and the QR moves right to make room
  if (colBottom + line > qx - qq) throw new StickerLayoutError("This code is too long for a barcode on a 50 × 25 mm sticker");
  // Bars centred between the content edge and the lower column line, right quiet zone kept.
  let bx = L + Math.floor((colBottom - L - barModules * bm) / 2);
  if (colBottom - (bx + barModules * bm) < 10 * bm) bx = colBottom - 10 * bm - barModules * bm;
  if (bx - 10 * bm < frameIn + frameW) throw new StickerLayoutError("This code is too long for a barcode on a 50 × 25 mm sticker");
  const codeSize = D(1.95);

  return {
    W, H, line,
    frame: { inset: frameIn, width: frameW, radius: D(2) },
    L, R, T, B, col: COL, colBottom, rule: RULE,
    logo: { x: L, y: T, h: D(2.6) },
    pill: { y: D(9.25), h: D(3), pad: D(1.5), radius: D(0.875) },
    name: { y: D(7.0), size: D(3.9) },
    leftW: COL - D(1.25) - L,
    cells: { x: RCx, w: RCw, h: D(4.625), sizeY: T, colorY: D(7.625), labelW: D(6.125), radius: D(1) },
    bars: { x: bx, y: qy, module: bm, height: qs - codeSize - D(0.5), modules: barModules },
    qr: { x: qx, y: qy, module: qm, cells: qrCells },
    codeText: { x: bx + Math.round((barModules * bm) / 2), y: qy + qs, size: codeSize, maxW: colBottom - D(1) - L },
    font: { tagline: D(1.5), label: D(1.42), size: D(3.7), color: D(2.3), tag: D(2.45) },
  };
}

/** Bar-width modules in a Code 128 symbol of `bits` (the encoder's 1/0 string). */
export function runs(bits: string): Array<{ start: number; width: number }> {
  const out: Array<{ start: number; width: number }> = [];
  for (let i = 0; i < bits.length; ) {
    let j = i;
    while (j < bits.length && bits[j] === bits[i]) j++;
    if (bits[i] === "1") out.push({ start: i, width: j - i });
    i = j;
  }
  return out;
}

/** The big name for a sticker: the product's own sticker name, else its name minus a trailing " – colour". */
export function stickerTitle(v: { labelName: string | null; productName: string; color: string }): string {
  if (v.labelName?.trim()) return v.labelName.trim();
  const name = v.productName.trim();
  const c = v.color.trim();
  const m = c ? name.match(/^(.*\S)\s*[-–—]\s*(.+)$/) : null;
  return m && m[2]!.trim().toLowerCase() === c.toLowerCase() && m[1]!.trim() ? m[1]!.trim() : name;
}
