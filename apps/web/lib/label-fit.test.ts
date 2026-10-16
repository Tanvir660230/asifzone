import { describe, expect, it } from "vitest";
import { DETAIL_LEVELS, MIN_UNIT_PX, chooseLevel, gradeFit, pickLayout, searchUnit, unitBounds } from "./label-fit";
import { LABEL_TEMPLATES, resolveGeometry } from "./label-templates";

describe("pickLayout", () => {
  it("stacks portrait and square cells, puts landscape ones side by side", () => {
    expect(pickLayout(46.8, 72.2)).toBe("stack"); // 2×3" sticker
    expect(pickLayout(72.2, 72.2)).toBe("stack"); // 3×3"
    expect(pickLayout(96, 146)).toBe("stack"); // 4×6"
    expect(pickLayout(77, 47)).toBe("wide"); // 80×50
    expect(pickLayout(93, 66.25)).toBe("wide"); // A4 8-up cell
  });
});

describe("unitBounds", () => {
  it("keeps every real template between the legibility floor and the cap, with min ≤ comfortable ≤ max", () => {
    for (const t of LABEL_TEMPLATES) {
      const g = resolveGeometry(t, "portrait", t.defaultMarginMm);
      const b = unitBounds(g.cellWmm, g.cellHmm);
      expect(b.min).toBe(MIN_UNIT_PX);
      expect(b.comfortable).toBeLessThanOrEqual(b.max);
      expect(b.comfortable).toBeGreaterThanOrEqual(b.min);
      expect(b.max).toBeLessThanOrEqual(20);
    }
  });

  it("gives the 2×3\" sticker roughly 10px body text at most, the 4×6\" about twice that", () => {
    expect(unitBounds(46.8, 72.2).max).toBeCloseTo(10.4, 0);
    expect(unitBounds(96, 146).max).toBeGreaterThan(19);
  });
});

describe("searchUnit", () => {
  it("finds the largest fitting unit to within 0.05px", () => {
    const unit = searchUnit((u) => u <= 7.37, 5.5, 12);
    expect(unit).not.toBeNull();
    expect(unit!).toBeLessThanOrEqual(7.37);
    expect(unit!).toBeGreaterThan(7.3);
  });

  it("returns the maximum when everything fits and null when nothing does", () => {
    expect(searchUnit(() => true, 5.5, 12)).toBe(12);
    expect(searchUnit(() => false, 5.5, 12)).toBeNull();
  });
});

describe("chooseLevel", () => {
  const bounds = { min: 5.5, comfortable: 8.5, max: 10.4 };

  it("keeps the richest level that is still comfortable to read", () => {
    expect(chooseLevel([7, 8.6, 10], bounds)).toEqual({ level: 1, unit: 8.6, overflow: false });
  });

  it("falls back to the plainest level at whatever size fits", () => {
    expect(chooseLevel([null, 6, 7.2], bounds)).toEqual({ level: 2, unit: 7.2, overflow: false });
  });

  it("flags overflow only when even the plainest level misses the floor", () => {
    expect(chooseLevel([null, null, null], bounds)).toEqual({ level: 2, unit: 5.5, overflow: true });
  });
});

describe("DETAIL_LEVELS", () => {
  it("names every product (one per line, then inline) before any level caps the list or counts it", () => {
    const firstCapped = DETAIL_LEVELS.findIndex((l) => l.items === "summary" || (typeof l.items === "number" && Number.isFinite(l.items)));
    expect(DETAIL_LEVELS[0]!.items).toBe(Number.POSITIVE_INFINITY);
    expect(firstCapped).toBeGreaterThan(1);
    for (const level of DETAIL_LEVELS.slice(1, firstCapped)) expect(level.items).toBe("inline");
    expect(DETAIL_LEVELS.at(-1)!.items).toBe("summary");
  });

  it("prints the QR on every level, and keeps the logo and the full barcode until the products are down to a count", () => {
    for (const level of DETAIL_LEVELS) expect(["full", "small"]).toContain(level.qr);
    const firstSummary = DETAIL_LEVELS.findIndex((l) => l.items === "summary");
    const firstNoLogo = DETAIL_LEVELS.findIndex((l) => !l.logo);
    expect(firstNoLogo).toBeGreaterThan(firstSummary);
    expect(DETAIL_LEVELS.findIndex((l) => l.slimBarcode)).toBe(DETAIL_LEVELS.length - 1);
  });

  it("shrinks the QR before it trims any product name", () => {
    const firstSmallQr = DETAIL_LEVELS.findIndex((l) => l.qr === "small");
    const firstCapped = DETAIL_LEVELS.findIndex((l) => typeof l.items === "number" && Number.isFinite(l.items));
    expect(firstSmallQr).toBeLessThan(firstCapped);
  });

  it("never brings back something an earlier level already dropped", () => {
    for (let i = 1; i < DETAIL_LEVELS.length; i++) {
      for (const part of ["footer", "logo"] as const) {
        if (!DETAIL_LEVELS[i - 1]![part]) expect(DETAIL_LEVELS[i]![part], `level ${i} ${part}`).toBe(false);
      }
      const qrRank = { full: 2, small: 1 } as const;
      expect(qrRank[DETAIL_LEVELS[i]!.qr], `level ${i} qr`).toBeLessThanOrEqual(qrRank[DETAIL_LEVELS[i - 1]!.qr]);
      if (DETAIL_LEVELS[i - 1]!.slimBarcode) expect(DETAIL_LEVELS[i]!.slimBarcode, `level ${i} slimBarcode`).toBe(true);
    }
  });
});

describe("gradeFit", () => {
  it("is full only when every product is named", () => {
    expect(gradeFit({ level: 0, unit: 9, overflow: false }, 12)).toBe("full");
    expect(gradeFit({ level: 1, unit: 9, overflow: false }, 12)).toBe("full"); // all named, inline
    expect(gradeFit({ level: 2, unit: 9, overflow: false }, 12)).toBe("full"); // only the footer went
    expect(gradeFit({ level: 3, unit: 9, overflow: false }, 12)).toBe("full"); // a smaller QR, still everything
    expect(gradeFit({ level: 4, unit: 9, overflow: false }, 6)).toBe("shortened"); // only 2 products named
    expect(gradeFit({ level: 6, unit: 9, overflow: false }, 1)).toBe("shortened"); // a count, no names
    expect(gradeFit({ level: DETAIL_LEVELS.length - 1, unit: 6, overflow: false }, 1)).toBe("shortened");
    expect(gradeFit({ level: 0, unit: 5.5, overflow: true }, 1)).toBe("overflow");
  });
});
