import { getProductTypeConfig, type SizeGuideData } from "@clothing-brand/shared";

type Attributes = Record<string, unknown> | null | undefined;

export interface SpecAccordionItem {
  title: string;
  content: string;
  html?: boolean;
}

const CLOTHING_CARE_NOTE = "Machine wash cold with like colors. Do not bleach. Tumble dry low. Iron on low heat if needed.";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readAttribute(attrs: Record<string, unknown>, key: string): string {
  const value = attrs[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

/** Whether the product page offers a size guide, and the product's own chart (undefined = show the
 * default chart). Types that don't support a guide never show one, whatever is stored on the product. */
export function getSizeGuideDisplay(
  productType: string,
  attributes: Attributes,
): { show: boolean; sizeGuide: SizeGuideData | undefined } {
  const support = getProductTypeConfig(productType).sizeGuide;
  if (!support?.supported) return { show: false, sizeGuide: undefined };

  const saved = attributes?.sizeGuide;
  if (saved && typeof saved === "object") {
    return { show: (saved as SizeGuideData).enabled === true, sizeGuide: saved as SizeGuideData };
  }
  return { show: support.defaultEnabled, sizeGuide: undefined };
}

/** Accordion sections built only from what the admin actually filled in for this product type —
 * nothing is invented for empty fields. Values are admin-typed free text, so they are escaped. */
export function buildSpecAccordionItems(productType: string, attributes: Attributes): SpecAccordionItem[] {
  const config = getProductTypeConfig(productType);
  const attrs = attributes ?? {};
  const items: SpecAccordionItem[] = [];

  for (const section of config.sections) {
    if (section.key === "description") continue;
    const rows = config.fields
      .filter((field) => field.section === section.key)
      .map((field) => ({ label: field.label, value: readAttribute(attrs, field.key) }))
      .filter((row) => row.value !== "");
    if (rows.length === 0) continue;

    const listItems = rows
      .map((row) => `<li><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value).replace(/\n/g, "<br>")}</li>`)
      .join("");
    items.push({
      title: section.label,
      content: `<ul class="space-y-1.5 text-sm text-ink-700">${listItems}</ul>`,
      html: true,
    });
  }

  // Apparel has always shown a generic care note; keep it until an admin writes product-specific care.
  if (config.type === "CLOTHING" && !readAttribute(attrs, "careInstructions")) {
    items.push({ title: "Care", content: CLOTHING_CARE_NOTE });
  }

  return items;
}
