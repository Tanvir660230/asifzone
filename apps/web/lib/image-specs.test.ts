import { describe, expect, it } from "vitest";
import { checkFit, imageSpec, ratioLabel, specSummary } from "./image-specs";

describe("image specs", () => {
  it("names ratios the way people say them", () => {
    expect(ratioLabel([3, 1])).toBe("3:1");
    expect(ratioLabel([16, 10])).toBe("16:10");
    expect(ratioLabel([1920, 640])).toBe("3:1");
    expect(ratioLabel([1200, 630])).toBe("1.9:1");
  });

  it("states the exact size and where the picture shows", () => {
    expect(specSummary(imageSpec("bannerDesktop"))).toBe("1920 × 640 px (3:1, landscape) — the homepage hero on computers (1024px and wider)");
  });

  it("accepts a picture at the frame's shape, with a sliver of tolerance", () => {
    expect(checkFit(imageSpec("bannerDesktop"), 1920, 640)).toEqual({ kind: "ok" });
    expect(checkFit(imageSpec("categoryPortrait"), 1200, 1530)).toEqual({ kind: "ok" });
  });

  it("says which edges a wrong shape loses", () => {
    const wideInSquare = checkFit(imageSpec("bannerPhone"), 1920, 640);
    expect(wideInSquare.kind).toBe("shape");
    expect(wideInSquare.kind !== "ok" && wideInSquare.message).toContain("the left and right sides");
    const tallInWide = checkFit(imageSpec("categoryWide"), 1200, 1500);
    expect(tallInWide.kind !== "ok" && tallInWide.short).toBe("1200 × 1500 px — not 16:10 landscape, top and bottom cut off");
  });

  it("reports a too-small picture before its shape", () => {
    const small = checkFit(imageSpec("bannerDesktop"), 600, 600);
    expect(small.kind).toBe("small");
    expect(small.kind !== "ok" && small.message).toContain("at least 1440 px wide");
  });
});
