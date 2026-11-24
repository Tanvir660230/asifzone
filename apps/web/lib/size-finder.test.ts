import { describe, expect, it } from "vitest";
import { EXAMPLE_FIT_PROFILE, fitProfileSchema, recommendSize, type FitInput } from "@clothing-brand/shared";

const ft = (feet: number, inches: number) => feet * 12 + inches;
const size = (input: FitInput) => {
  const r = recommendSize(EXAMPLE_FIT_PROFILE, input);
  return r.status === "ok" ? r.size : r.status;
};

describe("find my size: the example jacket profile (owner's fittings, 2026-11-24)", () => {
  it.each([
    [5, 2, 48, "M"], [5, 3, 50, "M"], [5, 3, 58, "L"], [5, 3, 78, "XL"], [5, 4, 58, "L"], [5, 5, 52, "L"],
    [5, 7, 78, "L"], [5, 7, 80, "L"], [5, 7, 82, "XL"], [5, 8, 50, "L"], [5, 8, 60, "XL"], [5, 9, 50, "L"],
    [5, 10, 64, "XL"], [5, 10, 85, "XXL"], [5, 8, 91, "XXL"], [5, 11, 70, "XL"], [5, 11, 80, "XXL"],
    [6, 0, 95, "XXL"], [6, 2, 70, "XXL"], [5, 6, 100, "XXXL"],
  ])("%d'%d\" %d kg → %s", (f, i, kg, expected) => expect(size({ heightIn: ft(f, i), weightKg: kg })).toBe(expected));

  it("past the largest size, or implausible numbers, is not guessed", () => {
    expect(size({ heightIn: ft(5, 8), weightKg: 110 })).toBe("too-large");
    expect(size({ heightIn: ft(5, 8), weightKg: 80, chestIn: 46 })).toBe("too-large");
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: 30, weightKg: 70 })).toEqual({ status: "invalid", field: "height" });
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: 68, weightKg: 7 })).toEqual({ status: "invalid", field: "weight" });
  });

  it("a bigger body chest wins over the table", () => {
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 7), weightKg: 70, chestIn: 39 })).toMatchObject({ size: "XL", source: "chest" });
  });

  it("runs small: the size worn elsewhere counts one up", () => {
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 6), weightKg: 65, usualSize: "XL" })).toMatchObject({ size: "XXL", source: "usual" });
    expect(size({ heightIn: ft(5, 6), weightKg: 65, usualSize: "S" })).toBe("L");
    expect(size({ heightIn: ft(5, 6), weightKg: 65, usualSize: "XXXL" })).toBe("too-large");
  });

  it("near the top of a size names the next one, and over a panjabi takes it", () => {
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 7), weightKg: 78 })).toMatchObject({ size: "L", alternative: { size: "XL", kind: "looser" } });
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 7), weightKg: 78, overLayer: true })).toMatchObject({ size: "XL", upForLayer: true, alternative: null });
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 4), weightKg: 60 })).toMatchObject({ size: "L", alternative: null });
  });

  it("just past a limit names the smaller size as a snug fit (owner: XL fits at 91 kg except under the arms)", () => {
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 8), weightKg: 91, chestIn: 41 })).toMatchObject({ size: "XXL", alternative: { size: "XL", kind: "snug" } });
    expect(recommendSize(EXAMPLE_FIT_PROFILE, { heightIn: ft(5, 9), weightKg: 50 })).toMatchObject({ size: "L", alternative: null });
  });
});

describe("fit profile validation", () => {
  it("accepts the example and rejects a table that does not match its sizes", () => {
    expect(fitProfileSchema.safeParse(EXAMPLE_FIT_PROFILE).success).toBe(true);
    const bad = { ...EXAMPLE_FIT_PROFILE, bands: [{ maxHeightIn: null, maxKg: [60, 70] }] };
    expect(fitProfileSchema.safeParse(bad).success).toBe(false);
    const unordered = { ...EXAMPLE_FIT_PROFILE, bands: [{ maxHeightIn: null, maxKg: [70, 60, 80, 90, 100] }] };
    expect(fitProfileSchema.safeParse(unordered).success).toBe(false);
  });
});
