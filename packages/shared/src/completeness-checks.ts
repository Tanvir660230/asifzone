/** The checks a product is scored on. `alwaysRequired` ones block READY/PUBLISHED for every product; the rest
 * only block when the product's template lists the key in `requiredChecks` — otherwise they just lower the score. */
export const COMPLETENESS_CHECKS = [
  { key: "basics", label: "Basic information", hint: "Name and category", alwaysRequired: true },
  { key: "pricing", label: "Pricing", hint: "A price above zero", alwaysRequired: true },
  { key: "variants", label: "Variants", hint: "At least one variant with a SKU and this type's options filled in", alwaysRequired: true },
  { key: "images", label: "Images", hint: "At least one product image", alwaysRequired: true },
  { key: "attributes", label: "Required details", hint: "Every field the product type marks as required", alwaysRequired: true },
  { key: "inventory", label: "Inventory", hint: "Stock on hand (or stock tracking switched off)", alwaysRequired: false },
  { key: "description", label: "Description", hint: "A written description", alwaysRequired: false },
  { key: "seo", label: "SEO description", hint: "A meta description for search results", alwaysRequired: false },
  { key: "sizeGuide", label: "Size guide", hint: "A size guide shown to customers", alwaysRequired: false },
  { key: "material", label: "Material", hint: "What the product is made of", alwaysRequired: false },
  { key: "care", label: "Care instructions", hint: "How to look after it", alwaysRequired: false },
] as const;

export type CompletenessCheckKey = (typeof COMPLETENESS_CHECKS)[number]["key"];
export const COMPLETENESS_CHECK_KEYS = COMPLETENESS_CHECKS.map((c) => c.key) as [CompletenessCheckKey, ...CompletenessCheckKey[]];

/** Keys a template may add to its publish requirements (the always-required ones need no opt-in). */
export const OPTIONAL_COMPLETENESS_KEYS = COMPLETENESS_CHECKS.filter((c) => !c.alwaysRequired).map((c) => c.key);
