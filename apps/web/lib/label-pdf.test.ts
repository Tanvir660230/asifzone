import { describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { assemblePdf, buildPageLayout, buildTestPagePdf, pixelRatioFor, thresholdPixels } from "./label-pdf";
import { LABEL_TEMPLATES, getTemplate } from "./label-templates";

const pt = (mm: number) => (mm * 72) / 25.4;

function mediaBoxes(pdf: string): Array<[number, number]> {
  return [...pdf.matchAll(/\/MediaBox\s*\[\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

/** A 1×1 white PNG — enough for jsPDF to embed and place. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

describe("buildTestPagePdf", () => {
  it("is one page at exactly every sticker template's size", () => {
    for (const t of LABEL_TEMPLATES.filter((x) => x.kind === "sticker")) {
      const boxes = mediaBoxes(buildTestPagePdf(t.pageWmm, t.pageHmm).output());
      expect(boxes, t.id).toHaveLength(1);
      expect(boxes[0]![0]).toBeCloseTo(pt(t.pageWmm), 1);
      expect(boxes[0]![1]).toBeCloseTo(pt(t.pageHmm), 1);
    }
  });
});

describe("assemblePdf", () => {
  const template = getTemplate("sticker-51x76");
  const pages = buildPageLayout({ orderIds: ["a", "b", "a"], template, orientation: "portrait", marginMm: template.defaultMarginMm });
  const images = new Map([
    ["a", PNG],
    ["b", PNG],
  ]);

  it("puts one sticker per page at the template size, embedding each order's image once", () => {
    const pdf = assemblePdf(pages, images).output();
    expect(mediaBoxes(pdf)).toHaveLength(3);
    // jsPDF names each embedded image XObject /I<n>; the alias makes the repeated order reuse its image.
    expect(new Set(pdf.match(/\/Subtype \/Image/g) ?? []).size).toBe(1);
    expect((pdf.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);
  });

  it("moves every image by the printer offset, keeping its size", () => {
    const addImage = vi.spyOn(jsPDF.API as unknown as { addImage: (...args: unknown[]) => unknown }, "addImage");
    const place = (offset?: { xMm: number; yMm: number }) => {
      addImage.mockClear();
      assemblePdf([pages[0]!], images, offset);
      const [, , x, y, w, h] = addImage.mock.calls[0]! as unknown as [string, string, number, number, number, number];
      return { x, y, w, h };
    };
    const base = place();
    const moved = place({ xMm: 1.5, yMm: -1 });
    addImage.mockRestore();
    expect(base.x).toBeCloseTo(template.defaultMarginMm);
    expect(moved.x - base.x).toBeCloseTo(1.5);
    expect(moved.y - base.y).toBeCloseTo(-1);
    expect([moved.w, moved.h]).toEqual([base.w, base.h]);
  });
});

describe("thresholdPixels", () => {
  it("turns every pixel pure black or white, opaque", () => {
    const px = new Uint8ClampedArray([17, 17, 17, 255, 200, 200, 200, 255, 120, 140, 160, 128, 255, 255, 255, 0]);
    thresholdPixels(px);
    expect(Array.from(px)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe("pixelRatioFor", () => {
  it("renders stickers at exactly twice the printer's dot pitch, A4 at 3×", () => {
    expect(pixelRatioFor("sticker", 203) * 96).toBeCloseTo(406);
    expect(pixelRatioFor("sticker", 300) * 96).toBeCloseTo(600);
    expect(pixelRatioFor("a4", 203)).toBe(3);
  });
});
