import type { CompletenessCheckKey, CreateProductInput, WizardStepId } from "@clothing-brand/shared";

/** Per-step guidance shown in the step header. Labels and the step list itself come from the shared wizard
 * configuration (`computeWizardSteps`); this only adds the copy that explains each step to the admin. */
export const STEP_DESCRIPTION: Record<WizardStepId, string> = {
  basics: "What this product is. Its type decides which details, options and guides the rest of the builder asks for.",
  media: "The photos customers see. The first one is the cover — drag to reorder.",
  pricing: "What it sells for and how its stock is tracked. Final prices are always worked out by the store's pricing engine.",
  variants: "Every purchasable option, each with its own SKU and stock — and its own price or photos when it needs them.",
  care: "How to look after it and what it's made of. Start from a preset, then adjust it for this product if needed.",
  sizeGuide: "The size chart shown next to the size picker. It follows the product type unless you change it here.",
  content: "Which sections the product page shows, in what order, plus this product's own questions and recommendations.",
  seo: "How the product appears in search results and when it's shared.",
  preview: "Check the customer's view on every surface and device before reviewing.",
  review: "Everything the publish check looks at, and where to fix anything that's missing.",
  publish: "Put the product on the store, or keep working on it as a draft.",
};

/** Which form fields each step owns — so a validation error can be shown on the step that fixes it. */
const STEP_FIELDS: Partial<Record<WizardStepId, (keyof CreateProductInput)[]>> = {
  basics: ["name", "categoryId", "typeId", "attributes", "brand", "brandTier", "sortOrder", "isFeatured", "shortDescription", "description"],
  pricing: ["basePrice", "compareAtPrice", "costPrice", "taxRate", "trackInventory", "lowStockThreshold", "restockDate"],
  variants: ["variants"],
  care: ["carePresetId", "careOverride", "materials"],
  content: ["sections", "faqs", "relations"],
  seo: ["slug", "seoTitle", "seoDescription", "focusKeyword", "ogTitle", "ogDescription", "ogImageUrl", "canonicalUrl"],
};

/** The step that holds a form field, given the steps this product actually has (a simple product's variants live
 * on Pricing). */
export function stepForField(field: string, has: (id: WizardStepId) => boolean): WizardStepId {
  const key = field.split(".")[0] as keyof CreateProductInput;
  for (const [step, fields] of Object.entries(STEP_FIELDS) as [WizardStepId, (keyof CreateProductInput)[]][]) {
    if (fields.includes(key)) return step === "variants" && !has("variants") ? "pricing" : step;
  }
  return "basics";
}

/** The step that fixes a completeness check (the shared engine decides WHAT is missing; this only says WHERE). */
export function stepForCheck(key: CompletenessCheckKey, has: (id: WizardStepId) => boolean): WizardStepId {
  switch (key) {
    case "pricing":
      return "pricing";
    case "images":
      return "media";
    case "variants":
    case "inventory":
      return has("variants") ? "variants" : "pricing";
    case "seo":
      return "seo";
    case "sizeGuide":
      return has("sizeGuide") ? "sizeGuide" : "basics";
    case "material":
    case "care":
      return has("care") ? "care" : "content";
    default:
      // basics, attributes, description
      return "basics";
  }
}
