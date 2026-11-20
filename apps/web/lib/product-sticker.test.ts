import { describe, expect, it } from "vitest";
import { code128Modules, stickerBarcode, stickerName, stickerSizeTier, STICKER_SIZES } from "./product-sticker";

describe("stickerName", () => {
  it("drops a colour the product name already ends with, since the sticker prints the colour on its own line", () => {
    expect(stickerName("Haven Sleeveless Jacket – Black", "Black")).toBe("Haven Sleeveless Jacket");
    expect(stickerName("Haven Full-Sleeve Jacket - Dark Ash", "dark ash")).toBe("Haven Full-Sleeve Jacket");
    expect(stickerName("Haven Jacket — Navy Blue", "Navy Blue")).toBe("Haven Jacket");
  });

  it("keeps the name when the colour isn't a trailing part of it", () => {
    expect(stickerName("Black Panjabi", "Black")).toBe("Black Panjabi");
    expect(stickerName("Olive Cap", "")).toBe("Olive Cap");
    expect(stickerName("Jacket Coffee", "Coffee")).toBe("Jacket Coffee");
  });

  it("never leaves an empty name", () => {
    expect(stickerName("Black", "Black")).toBe("Black");
  });
});

describe("code128Modules", () => {
  it("counts start, data, check and stop for text codes", () => {
    // start 11 + 15 × 11 + check 11 + stop 13
    expect(code128Modules("TH-HVS-BLK-XXXL")).toBe(200);
  });

  it("packs digits in pairs, with a switch for an odd digit left over", () => {
    expect(code128Modules("12345678")).toBe(11 * (1 + 4 + 1) + 13);
    expect(code128Modules("8901234567890")).toBe(11 * (1 + 6 + 2 + 1) + 13);
  });
});

describe("stickerBarcode", () => {
  it("leaves the long-code bars off a 50 × 30 sticker: at a printable bar width they don't fit", () => {
    expect(stickerBarcode("TH-HVS-BLK-XXXL", "50x30")).toBeNull();
  });

  it("prints the bars when they fit at two printer dots per bar or wider", () => {
    const b = stickerBarcode("8901234567890", "50x30");
    expect(b).not.toBeNull();
    expect(b!.widthMm).toBeLessThanOrEqual(STICKER_SIZES["50x30"].widthMm - 2 * STICKER_SIZES["50x30"].padMm);
    expect(b!.widthMm / (code128Modules("8901234567890") + 20)).toBeGreaterThanOrEqual(0.25);
  });

  it("drops the bars on the smaller sticker when they'd be too thin", () => {
    expect(stickerBarcode("8901234567890", "38x25")).toBeNull();
    expect(stickerBarcode("1234", "38x25")).not.toBeNull();
  });
});

describe("the 50 × 25 sticker", () => {
  it("takes a real EAN as bars and leaves a long SKU to the QR", () => {
    expect(stickerBarcode("8901234567890", "50x25")).not.toBeNull();
    expect(stickerBarcode("TH-HVS-BLK-XXXL", "50x25")).toBeNull();
  });
});

describe("stickerSizeTier", () => {
  it("prints short sizes biggest", () => {
    expect(stickerSizeTier("M")).toBe("xl");
    expect(stickerSizeTier("XL")).toBe("xl");
    expect(stickerSizeTier("XXL")).toBe("lg");
    expect(stickerSizeTier("XXXL")).toBe("md");
    expect(stickerSizeTier("Free size")).toBe("sm");
    expect(stickerSizeTier("")).toBe("none");
  });
});
