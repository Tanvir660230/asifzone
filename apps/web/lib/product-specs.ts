import { toVideoEmbed, type Product, type ProductResolvedView, type SpecItemView } from "@clothing-brand/shared";

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
 * server-rendered product page sanitizes (DOMPurify) *before* it gets here. */
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

/** Admin-written text: real HTML (from an editor) is sanitized; plain text becomes escaped paragraphs. */
export function textToHtml(content: string, sanitize: (html: string) => string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) return sanitize(content);
  return content
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const linesOf = (content: string | null | undefined) => (content ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

const listHtml = (lines: string[]) => `<ul class="list-disc space-y-1 pl-5 text-sm text-ink-700">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;

/** One accordion row per spec group, built only from what the admin filled in. */
function specGroupItems(resolved: ProductResolvedView | undefined): SpecAccordionItem[] {
  return (resolved?.specGroups ?? []).map((group) => ({
    title: group.name,
    content: `<ul class="space-y-1.5 text-sm text-ink-700">${group.items
      .map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${renderValueHtml(item)}</li>`)
      .join("")}</ul>`,
    html: true,
  }));
}

/** The video, as markup we build ourselves from a URL that passed the host allowlist — never from admin HTML. */
function videoHtml(url: string, title: string): string | null {
  const embed = toVideoEmbed(url);
  if (!embed) return null;
  if (embed.kind === "iframe") {
    return `<div class="aspect-video overflow-hidden rounded-lg bg-ink-100"><iframe src="${escapeHtml(embed.src)}" title="${escapeHtml(title)}" class="h-full w-full" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }
  return `<video src="${escapeHtml(embed.src)}" controls preload="none" class="w-full rounded-lg"></video>`;
}

/**
 * The product page's accordion, in the order the resolved sections say, from the sections that are switched on.
 * Sections with nothing to show (no materials, no FAQ, no text) simply don't appear. `sanitize` is DOMPurify, passed in so
 * the browser bundle never has to load it — this runs in the server-rendered page.
 */
export function buildAccordionItems(product: Product, sanitize: (html: string) => string): SpecAccordionItem[] {
  const resolved = product.resolved;
  const items: SpecAccordionItem[] = [];

  for (const section of (resolved?.sections ?? []).filter((s) => s.area === "accordion")) {
    switch (section.key) {
      case "description": {
        const html = sanitize(product.description);
        items.push({ title: section.title, content: html.trim() ? html : "<p>No description provided yet.</p>", html: true });
        break;
      }
      case "highlights":
      case "whatsIncluded": {
        const lines = linesOf(section.content);
        if (lines.length) items.push({ title: section.title, content: listHtml(lines), html: true });
        break;
      }
      case "specifications":
        items.push(...specGroupItems(resolved));
        break;
      case "material":
        if (resolved?.materials?.length) {
          items.push({
            title: section.title,
            content: `<ul class="space-y-1.5 text-sm text-ink-700">${resolved.materials
              .map((m) => `<li>${m.percentage ? `${escapeHtml(String(m.percentage))}% ` : ""}${escapeHtml(m.name)}</li>`)
              .join("")}</ul>`,
            html: true,
          });
        }
        break;
      case "care":
        if (resolved?.care) {
          items.push({
            title: section.title,
            content: `<ol class="list-decimal space-y-1 pl-5 text-sm text-ink-700">${resolved.care.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`,
            html: true,
          });
        } else {
          // Apparel has always shown a generic care note; keep it until a care guide (or the old free-text field) says otherwise.
          const careInstructions = (product.attributes as Attributes)?.careInstructions;
          const hasCare = typeof careInstructions === "string" && careInstructions.trim() !== "";
          if (resolved?.type?.key === "CLOTHING" && !hasCare) items.push({ title: "Care", content: CLOTHING_CARE_NOTE });
        }
        break;
      case "shipping":
      case "returns":
      case "warranty":
        if (section.content?.trim()) items.push({ title: section.title, content: textToHtml(section.content, sanitize), html: true });
        break;
      case "faq":
        if (resolved?.faqs?.length) {
          items.push({
            title: section.title,
            content: `<dl class="space-y-3 text-sm">${resolved.faqs
              .map((f) => `<div><dt class="font-medium text-ink-900">${escapeHtml(f.question)}</dt><dd class="mt-0.5 text-ink-600">${escapeHtml(f.answer).replace(/\n/g, "<br>")}</dd></div>`)
              .join("")}</dl>`,
            html: true,
          });
        }
        break;
      case "video": {
        const html = section.content ? videoHtml(section.content, `${product.name} video`) : null;
        if (html) items.push({ title: section.title, content: html, html: true });
        break;
      }
    }
  }
  return items;
}
