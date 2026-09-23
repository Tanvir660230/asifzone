import { DEFAULT_SIZE_GUIDE, type SizeGuideData } from "./config/product-types";
import type { ProductResolvedView, ResolvedTypeConfig } from "./schemas/catalog";
import type { PublicSection, ResolvedSection } from "./sections";
import { buildSpecGroups } from "./spec-groups";

/** Whether the product page offers a size guide, and which chart: the product's own saved guide wins;
 * otherwise the template's preset (or the generic chart when the template has none). */
export function buildSizeGuideView(
  config: Pick<ResolvedTypeConfig, "sizeGuide"> | null,
  attributes: Record<string, unknown>,
): ProductResolvedView["sizeGuide"] {
  if (!config || config.sizeGuide.mode === "NOT_APPLICABLE") return { show: false, chart: null };
  const saved = attributes.sizeGuide;
  if (saved && typeof saved === "object") {
    return { show: (saved as SizeGuideData).enabled === true, chart: saved as SizeGuideData };
  }
  return { show: config.sizeGuide.mode === "ON_BY_DEFAULT", chart: config.sizeGuide.chart ?? DEFAULT_SIZE_GUIDE };
}

/** What care steps to show, most specific first: the product's own list, its chosen preset, then the template's default. */
export function buildCareView(
  product: { careOverride: unknown; carePreset: { name: string; steps: unknown } | null },
  config: Pick<ResolvedTypeConfig, "care"> | null,
): ProductResolvedView["care"] {
  const own = Array.isArray(product.careOverride) ? (product.careOverride as string[]).filter(Boolean) : [];
  if (own.length) return { title: "Care", steps: own, source: "product" };
  const steps = product.carePreset ? (product.carePreset.steps as string[]) : [];
  if (product.carePreset && steps.length) return { title: product.carePreset.name, steps, source: "preset" };
  if (config && config.care.steps.length) return { title: config.care.name ?? "Care", steps: config.care.steps, source: "template" };
  return null;
}

/** Only what the page will render: enabled sections, in order, with text sent only for the text-type ones. */
export function toPublicSections(resolved: ResolvedSection[]): PublicSection[] {
  return resolved
    .filter((s) => s.enabled)
    .map((s) => ({ key: s.key, title: s.title, order: s.order, area: s.area, content: s.contentType === "none" ? null : s.content }));
}

/** The storefront's `product.resolved` bag. The API builds it for a saved product; the admin wizard's live preview
 * builds it from unsaved form values — same function, so the preview can't drift from what customers get. */
export function buildResolvedView(
  config: ResolvedTypeConfig | null,
  attributes: Record<string, unknown>,
  extras: Pick<ProductResolvedView, "care" | "materials" | "sections" | "faqs"> = { care: null, materials: [], sections: [], faqs: [] },
): ProductResolvedView {
  return {
    type: config ? { id: config.typeId, key: config.key, name: config.name } : null,
    variantDimensions: config?.variantDimensions ?? [],
    specGroups: config ? buildSpecGroups(config.fields, attributes) : [],
    sizeGuide: buildSizeGuideView(config, attributes),
    care: extras.care,
    materials: extras.materials,
    sections: extras.sections,
    faqs: extras.faqs,
  };
}
