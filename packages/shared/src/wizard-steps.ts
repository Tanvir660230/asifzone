import type { ResolvedTypeConfig } from "./schemas/catalog";

export type WizardStepId =
  | "basics"
  | "media"
  | "pricing"
  | "variants"
  | "care"
  | "sizeGuide"
  | "content"
  | "seo"
  | "preview"
  | "review"
  | "publish";

export interface WizardStep {
  id: WizardStepId;
  label: string;
  /** True for a step that only appears because this product's configuration calls for it (Options & Variants,
   * Care & Material, Size Guide). The core steps (Basics, Media, Pricing, Page Content, SEO, Preview, Final
   * Review, Publish) are always present — every one of the spec's example flows keeps them regardless of
   * product type. */
  optional: boolean;
}

const CORE_BEFORE: WizardStep[] = [
  { id: "basics", label: "Basics", optional: false },
  { id: "media", label: "Media", optional: false },
  { id: "pricing", label: "Pricing & Inventory", optional: false },
];

const CORE_AFTER: WizardStep[] = [
  { id: "content", label: "Page Content", optional: false },
  { id: "seo", label: "SEO", optional: false },
  { id: "preview", label: "Live Preview", optional: false },
  { id: "review", label: "Final Review", optional: false },
  { id: "publish", label: "Publish", optional: false },
];

/** The product-type resolution a step-visibility decision needs — a subset of `ResolvedTypeConfig` so callers
 * that only have that much (e.g. a freshly-created product with no type yet) can still call this. */
export type WizardStepConfig = Pick<ResolvedTypeConfig, "variantDimensions" | "sizeGuide"> | null;

/** The resolved section entries a step-visibility decision needs — from `resolveSections()`. */
export interface WizardStepSection {
  key: string;
  enabled: boolean;
}

/** Pure: the wizard's step list for this product, in order. Same function drives the wizard shell's
 * navigation and (where a server-side check needs to know which steps even apply) the completeness gate —
 * one source of truth for "which steps does this product actually have," matching the spec's dynamic-step
 * requirement (a simple product with no variants/care/size-guide skips straight from Pricing to Page Content). */
export function computeWizardSteps(config: WizardStepConfig, resolvedSections: WizardStepSection[]): WizardStep[] {
  const sectionEnabled = (key: string) => resolvedSections.find((s) => s.key === key)?.enabled ?? true;

  const dynamic: WizardStep[] = [];
  if ((config?.variantDimensions.length ?? 0) > 0) {
    dynamic.push({ id: "variants", label: "Options & Variants", optional: true });
  }
  if (sectionEnabled("care") || sectionEnabled("material")) {
    dynamic.push({ id: "care", label: "Care & Material", optional: true });
  }
  if (config && config.sizeGuide.mode !== "NOT_APPLICABLE") {
    dynamic.push({ id: "sizeGuide", label: "Size Guide", optional: true });
  }

  return [...CORE_BEFORE, ...dynamic, ...CORE_AFTER];
}
