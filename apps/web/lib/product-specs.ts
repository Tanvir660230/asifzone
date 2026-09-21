import type { ProductResolvedView, SpecItemView } from "@clothing-brand/shared";

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

// Fixed locale + UTC so server and client render the same string (no hydration mismatch).
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The value as HTML. Everything admin-typed is escaped; the only raw HTML is RICH_TEXT, which the
 * server-rendered product page sanitizes (DOMPurify) *before* it reaches this client-side code — sanitizing
 * here would bundle isomorphic-dompurify's jsdom fallback into the browser. */
function renderValueHtml(item: SpecItemView): string {
  const { value, dataType, unit } = item;
  switch (dataType) {
    case "BOOLEAN":
      return value ? "Yes" : "No";
    case "NUMBER":
    case "MEASUREMENT":
      return escapeHtml(`${value}${unit ? ` ${unit}` : ""}`);
    case "DATE": {
      const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
      return escapeHtml(Number.isNaN(d.getTime()) ? String(value) : DATE_FORMAT.format(d));
    }
    case "MULTI_SELECT":
      return escapeHtml(Array.isArray(value) ? value.join(", ") : String(value));
    case "URL": {
      const href = String(value);
      // Only ever a link when it is a plain http(s) URL — the API enforces that on write, this is the second lock.
      return /^https?:\/\//i.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow" class="underline">${escapeHtml(href)}</a>`
        : escapeHtml(href);
    }
    case "RICH_TEXT":
      return String(value);
    default:
      return escapeHtml(String(value)).replace(/\n/g, "<br>");
  }
}

/** One accordion section per spec group, built only from what the admin filled in — nothing is invented
 * for empty fields. The groups themselves (names, order, membership) come from the product's template. */
export function buildSpecAccordionItems(resolved: ProductResolvedView | undefined, attributes: Attributes): SpecAccordionItem[] {
  const items: SpecAccordionItem[] = (resolved?.specGroups ?? []).map((group) => ({
    title: group.name,
    content: `<ul class="space-y-1.5 text-sm text-ink-700">${group.items
      .map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${renderValueHtml(item)}</li>`)
      .join("")}</ul>`,
    html: true,
  }));

  // Apparel has always shown a generic care note; keep it until an admin writes product-specific care.
  const careInstructions = attributes?.careInstructions;
  const hasCare = typeof careInstructions === "string" && careInstructions.trim() !== "";
  if (resolved?.type?.key === "CLOTHING" && !hasCare) {
    items.push({ title: "Care", content: CLOTHING_CARE_NOTE });
  }

  return items;
}
