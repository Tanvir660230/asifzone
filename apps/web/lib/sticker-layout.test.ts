import { describe, expect, it } from "vitest";
import JsBarcode from "jsbarcode";
import { runs, stickerGeometry, stickerTitle, StickerLayoutError, STICKER_DOTS_PER_MM } from "./sticker-layout";

function bits(value: string): string {
  const o: { encodings?: Array<{ data: string }> } = {};
  JsBarcode(o, value, { format: "CODE128" });
  return o.encodings!.map((e) => e.data).join("");
}

const SKUS = ["TH-HVS-BLK-XXXL", "TH-HVF-BRN-M", "TH-HVS-NVY-XL", "8901234567890", "AZ-CAP-001"];

describe("stickerGeometry", () => {
  for (const dpi of [203, 300] as const) {
    for (const sku of SKUS) {
      it(`${sku} at ${dpi} dpi: whole dots, bars ≥ 0.125 mm, quiet zones clear, inside the frame`, () => {
        const b = bits(sku);
        const g = stickerGeometry(dpi, b.length, 21);
        expect(g.W).toBe(Math.round(50 * STICKER_DOTS_PER_MM[dpi]));
        expect(g.H).toBe(Math.round(25 * STICKER_DOTS_PER_MM[dpi]));
        for (const n of [g.bars.x, g.bars.y, g.bars.module, g.qr.x, g.qr.y, g.qr.module]) expect(Number.isInteger(n)).toBe(true);
        expect(g.bars.module / STICKER_DOTS_PER_MM[dpi]).toBeGreaterThanOrEqual(0.124);
        const barsEnd = g.bars.x + b.length * g.bars.module;
        // Code 128 quiet zones: 10 modules to the frame on the left and to the lower column line on the right.
        expect(g.bars.x - 10 * g.bars.module).toBeGreaterThanOrEqual(g.frame.inset + g.frame.width);
        expect(g.colBottom - barsEnd).toBeGreaterThanOrEqual(10 * g.bars.module);
        // QR quiet zone: 4 modules clear of the column line, the cells above, and the frame.
        const qq = 4 * g.qr.module, qs = 21 * g.qr.module;
        expect(g.qr.x - qq).toBeGreaterThanOrEqual(g.colBottom + g.line);
        expect(g.qr.y - qq).toBeGreaterThanOrEqual(g.cells.sizeY + (g.cells.colorY - g.cells.sizeY) + g.cells.h);
        expect(g.qr.x + qs + qq).toBeLessThanOrEqual(g.W - g.frame.inset - g.frame.width);
        expect(g.qr.y + qs + qq).toBeLessThanOrEqual(g.H - g.frame.inset - g.frame.width);
      });
    }
  }

  it("refuses a code too long to print as bars that scan", () => {
    expect(() => stickerGeometry(203, bits("TH-HVS-BLK-XXXL-EXTRA-LONG").length, 25)).toThrow(StickerLayoutError);
  });
});

describe("runs", () => {
  it("turns the encoding into bars", () => {
    expect(runs("1101001100")).toEqual([{ start: 0, width: 2 }, { start: 3, width: 1 }, { start: 6, width: 2 }]);
  });
});

describe("stickerTitle", () => {
  it("prefers the sticker name, else drops a trailing colour from the product name", () => {
    expect(stickerTitle({ labelName: "Haven Jacket", productName: "Haven Sleeveless Jacket – Black", color: "Black" })).toBe("Haven Jacket");
    expect(stickerTitle({ labelName: null, productName: "Haven Sleeveless Jacket – Black", color: "Black" })).toBe("Haven Sleeveless Jacket");
    expect(stickerTitle({ labelName: " ", productName: "Black Panjabi", color: "Black" })).toBe("Black Panjabi");
  });
});
