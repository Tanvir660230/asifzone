import { describe, expect, it } from "vitest";
import { computeWizardSteps, type WizardStepConfig, type WizardStepSection } from "@clothing-brand/shared";

const dims = (...fields: ("size" | "color")[]) => fields.map((f) => ({ targetField: f, label: f, options: [] }));
const config = (over: Partial<{ dims: ("size" | "color")[]; sizeGuideMode: "OFF_BY_DEFAULT" | "ON_BY_DEFAULT" | "NOT_APPLICABLE" }> = {}): WizardStepConfig => ({
  variantDimensions: dims(...(over.dims ?? [])),
  sizeGuide: { mode: over.sizeGuideMode ?? "NOT_APPLICABLE", presetId: null, chart: null },
});
const sections = (enabled: string[]): WizardStepSection[] =>
  ["care", "material"].map((key) => ({ key, enabled: enabled.includes(key) }));

const ids = (config: WizardStepConfig, s: WizardStepSection[]) => computeWizardSteps(config, s).map((s) => s.id);

describe("computeWizardSteps", () => {
  it("Example A — color+size variant with care, material and a size guide gets every dynamic step", () => {
    expect(ids(config({ dims: ["size", "color"], sizeGuideMode: "ON_BY_DEFAULT" }), sections(["care", "material"]))).toEqual([
      "basics", "media", "pricing", "variants", "care", "sizeGuide", "content", "seo", "preview", "review", "publish",
    ]);
  });

  it("Example B — a simple product (no variants, no care/material, no size guide) skips straight to content", () => {
    expect(ids(config(), sections([]))).toEqual(["basics", "media", "pricing", "content", "seo", "preview", "review", "publish"]);
  });

  it("Example C — color-only variant, no care/material/size guide", () => {
    expect(ids(config({ dims: ["color"] }), sections([]))).toEqual(["basics", "media", "pricing", "variants", "content", "seo", "preview", "review", "publish"]);
  });

  it("Example D — no color, no size, no variants at all (same shape as the simple product)", () => {
    expect(ids(config({ dims: [] }), sections([]))).toEqual(["basics", "media", "pricing", "content", "seo", "preview", "review", "publish"]);
  });

  it("shows the Care step when only Material is enabled, or only Care — either one is enough", () => {
    expect(ids(config(), sections(["material"]))).toContain("care");
    expect(ids(config(), sections(["care"]))).toContain("care");
    expect(ids(config(), sections([]))).not.toContain("care");
  });

  it("a null config (no product type chosen yet) has no variants/care/size-guide steps", () => {
    expect(computeWizardSteps(null, sections([]))).toEqual(computeWizardSteps(config(), sections([])));
  });

  it("size guide step reacts to the template's mode alone, independent of variants/care", () => {
    expect(ids(config({ sizeGuideMode: "OFF_BY_DEFAULT" }), sections([]))).toContain("sizeGuide");
    expect(ids(config({ sizeGuideMode: "NOT_APPLICABLE" }), sections([]))).not.toContain("sizeGuide");
  });
});
