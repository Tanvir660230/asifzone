import { z } from "zod";

/**
 * Product-page sections. The set is fixed in code (each one has a renderer); what an admin controls is whether each is
 * shown, in what order, under what title and — for the text-type ones — with what words, at three levels:
 * the whole store, a product template, or a single product. Resolution is field by field:
 *     product override → template override → global override → the default below
 * so a template can change only the title of "Care" and inherit everything else.
 */

export type SectionArea =
  /** An accordion row beside the product photos. */
  | "accordion"
  /** A full-width block under the product (reviews, recommendation lists). */
  | "block"
  /** A control inside another part of the page (the size-guide link by the size picker). */
  | "control";

/** What the section's `content` holds. */
export type SectionContentType =
  | "none" // built from other data (description, spec groups, materials, care, FAQ, reviews, lists)
  | "text" // rich text / HTML, sanitized on the server before it is shown
  | "lines" // one item per line (highlights, what's included)
  | "video"; // a YouTube / Vimeo / direct video URL

export interface SectionDef {
  key: string;
  label: string;
  area: SectionArea;
  content: SectionContentType;
  defaultEnabled: boolean;
  defaultTitle: string;
  /** Default text for a text-type section. Must equal what the page showed before sections were configurable. */
  defaultContent?: string;
  /** Explains what the admin is switching. */
  help: string;
  /** For recommendation lists: which curated relation kind feeds it (falling back to an algorithm when empty). */
  relationKind?: "RELATED" | "CROSS_SELL" | "UPSELL" | "FREQUENTLY_BOUGHT" | "RECOMMENDED";
}

/** Registry order is the default order — it reproduces the page as it was before sections were configurable. */
export const SECTION_REGISTRY = [
  { key: "description", label: "Description", area: "accordion", content: "none", defaultEnabled: true, defaultTitle: "Description", help: "The product's description." },
  { key: "highlights", label: "Highlights", area: "accordion", content: "lines", defaultEnabled: false, defaultTitle: "Highlights", help: "A short bullet list of selling points (one per line, written per product)." },
  { key: "specifications", label: "Specifications", area: "accordion", content: "none", defaultEnabled: true, defaultTitle: "Specifications", help: "The product's fields, grouped as the product type's template defines (each group is its own row)." },
  { key: "material", label: "Material", area: "accordion", content: "none", defaultEnabled: true, defaultTitle: "Material", help: "The material composition. Hidden when a product has none." },
  { key: "care", label: "Care instructions", area: "accordion", content: "none", defaultEnabled: true, defaultTitle: "Care instructions", help: "The product's care guide. Hidden when it has none." },
  {
    key: "shipping",
    label: "Shipping & returns",
    area: "accordion",
    content: "text",
    defaultEnabled: true,
    defaultTitle: "Shipping & Returns",
    defaultContent:
      "Dispatched within 1–2 business days. Inside Dhaka: 1–2 days, outside Dhaka: 3–5 days. Unworn items with tags can be returned or exchanged within 7 days of delivery.",
    help: "Delivery and return information. Set the store-wide wording once; a template or product can override it.",
  },
  { key: "returns", label: "Returns (separate)", area: "accordion", content: "text", defaultEnabled: false, defaultTitle: "Returns", help: "A separate returns row, if you'd rather not combine it with shipping." },
  { key: "warranty", label: "Warranty", area: "accordion", content: "text", defaultEnabled: false, defaultTitle: "Warranty", help: "Warranty terms (watches, electronics…)." },
  { key: "whatsIncluded", label: "What's included", area: "accordion", content: "lines", defaultEnabled: false, defaultTitle: "What's included", help: "What comes in the box (one per line, written per product)." },
  { key: "faq", label: "FAQ", area: "accordion", content: "none", defaultEnabled: true, defaultTitle: "FAQ", help: "The product's own questions and answers. Hidden when a product has none." },
  { key: "video", label: "Product video", area: "accordion", content: "video", defaultEnabled: false, defaultTitle: "Product video", help: "A YouTube, Vimeo or direct video link, set per product." },
  { key: "sizeGuide", label: "Size guide link", area: "control", content: "none", defaultEnabled: true, defaultTitle: "Size guide", help: "The size guide link by the size picker (still only shown when the product has a guide)." },
  { key: "reviews", label: "Customer reviews", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Reviews", help: "Ratings and written reviews." },
  { key: "bundle", label: "Bundle offer", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Complete the Bundle", help: "The bundle discount suggestions, when a bundle applies." },
  { key: "related", label: "Related products", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Best Match", relationKind: "RELATED", help: "Hand-picked related products; automatic best matches when none are picked." },
  { key: "frequentlyBought", label: "Frequently bought together", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Customers Also Bought", relationKind: "FREQUENTLY_BOUGHT", help: "Hand-picked companions; what customers really buy together when none are picked." },
  { key: "crossSell", label: "Cross-sell", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Complete The Look", relationKind: "CROSS_SELL", help: "Hand-picked complements; automatic outfit suggestions when none are picked." },
  { key: "upsell", label: "Upsell", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Upgrade Option", relationKind: "UPSELL", help: "Hand-picked step-ups; automatic pricier alternatives when none are picked." },
  { key: "budget", label: "Budget alternatives", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Budget Alternative", help: "Cheaper alternatives (automatic)." },
  { key: "premium", label: "Premium alternatives", area: "block", content: "none", defaultEnabled: true, defaultTitle: "More Premium Options", help: "Premium alternatives (automatic)." },
  { key: "recommended", label: "Recommended products", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Trending Now", relationKind: "RECOMMENDED", help: "Hand-picked recommendations; store-wide trending products when none are picked." },
  { key: "recentlyViewed", label: "Recently viewed", area: "block", content: "none", defaultEnabled: true, defaultTitle: "Recently Viewed", help: "The shopper's own recently viewed products." },
] as const satisfies readonly SectionDef[];

export type SectionKey = (typeof SECTION_REGISTRY)[number]["key"];
export const SECTION_KEYS = SECTION_REGISTRY.map((s) => s.key) as [SectionKey, ...SectionKey[]];
export const getSectionDef = (key: string): SectionDef | undefined => (SECTION_REGISTRY as readonly SectionDef[]).find((s) => s.key === key);

/** Recommendation lists an admin can hand-pick products for, and the section each one feeds. */
export const RELATION_SECTIONS = (SECTION_REGISTRY as readonly SectionDef[]).filter((s) => s.relationKind) as (SectionDef & {
  relationKind: NonNullable<SectionDef["relationKind"]>;
})[];

/* ───────────────────────── resolution ───────────────────────── */

export interface SectionOverride {
  enabled?: boolean | null;
  sortOrder?: number | null;
  title?: string | null;
  content?: string | null;
}
export type SectionLayer = Partial<Record<string, SectionOverride>>;
export type SectionSource = "product" | "template" | "global" | "default";

export interface ResolvedSection {
  key: SectionKey;
  label: string;
  area: SectionArea;
  contentType: SectionContentType;
  enabled: boolean;
  order: number;
  title: string;
  content: string | null;
  /** Which level each value came from — the editors show "inherited from template" from this. */
  source: { enabled: SectionSource; order: SectionSource; title: SectionSource; content: SectionSource };
}

const has = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined && (typeof v !== "string" || v.trim() !== "");

function pickField<K extends keyof SectionOverride>(
  key: string,
  field: K,
  layers: { product?: SectionLayer; template?: SectionLayer; global?: SectionLayer },
): { value: NonNullable<SectionOverride[K]> | undefined; source: SectionSource } {
  for (const [name, layer] of [["product", layers.product], ["template", layers.template], ["global", layers.global]] as const) {
    const v = layer?.[key]?.[field];
    if (has(v)) return { value: v as NonNullable<SectionOverride[K]>, source: name };
  }
  return { value: undefined, source: "default" };
}

/** Every section, resolved and sorted by order (enabled or not — the editors need the disabled ones too). */
export function resolveSections(layers: { product?: SectionLayer; template?: SectionLayer; global?: SectionLayer }): ResolvedSection[] {
  return (SECTION_REGISTRY as readonly SectionDef[])
    .map((def, index) => {
      const enabled = pickField(def.key, "enabled", layers);
      const order = pickField(def.key, "sortOrder", layers);
      const title = pickField(def.key, "title", layers);
      const content = pickField(def.key, "content", layers);
      return {
        key: def.key as SectionKey,
        label: def.label,
        area: def.area,
        contentType: def.content,
        enabled: enabled.value ?? def.defaultEnabled,
        // Default order leaves gaps (10, 20, …) so an admin-chosen 15 lands between two defaults.
        order: order.value ?? (index + 1) * 10,
        title: title.value ?? def.defaultTitle,
        content: content.value ?? def.defaultContent ?? null,
        source: { enabled: enabled.source, order: order.source, title: title.source, content: content.source },
        _index: index,
      };
    })
    .sort((a, b) => a.order - b.order || a._index - b._index)
    .map(({ _index, ...rest }) => {
      void _index;
      return rest;
    });
}

/* ───────────────────────── validation ───────────────────────── */

export type VideoEmbed = { kind: "iframe"; src: string } | { kind: "file"; src: string };

/** Only hosts we know how to embed safely. Anything else is refused on write and never rendered. */
export function toVideoEmbed(rawUrl: string): VideoEmbed | null {
  const url = rawUrl.trim();
  let m = /^https:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{6,20})(?:[&#].*)?$/i.exec(url);
  m ??= /^https:\/\/youtu\.be\/([\w-]{6,20})(?:[?#].*)?$/i.exec(url);
  m ??= /^https:\/\/(?:www\.)?youtube\.com\/embed\/([\w-]{6,20})(?:[?#].*)?$/i.exec(url);
  if (m) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  const vimeo = /^https:\/\/(?:www\.)?vimeo\.com\/(\d{6,12})(?:[/?#].*)?$/i.exec(url);
  if (vimeo) return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/^https:\/\/[^\s"'<>]+\.(?:mp4|webm)(?:\?[^\s"'<>]*)?$/i.test(url)) return { kind: "file", src: url };
  return null;
}

const nullish = <T extends z.ZodTypeAny>(schema: T) => schema.nullish();

export const sectionOverrideSchema = z
  .object({
    sectionKey: z.enum(SECTION_KEYS),
    enabled: nullish(z.boolean()),
    sortOrder: nullish(z.number().int().min(0).max(100_000)),
    title: nullish(z.string().trim().max(80)),
    content: nullish(z.string().max(20_000)),
  })
  .superRefine((o, ctx) => {
    const def = getSectionDef(o.sectionKey);
    if (!has(o.content) || !def) return;
    if (def.content === "none") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${def.label} has no text of its own`, path: ["content"] });
    } else if (def.content === "video" && !toVideoEmbed(o.content)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use a YouTube or Vimeo link, or a direct https link to an .mp4 / .webm file", path: ["content"] });
    } else if (def.content === "lines" && o.content.split("\n").filter((l) => l.trim()).length > 20) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At most 20 lines", path: ["content"] });
    }
  });
export type SectionOverrideInput = z.infer<typeof sectionOverrideSchema>;

export const sectionLayerSchema = z
  .array(sectionOverrideSchema)
  .max(SECTION_KEYS.length)
  .refine((rows) => new Set(rows.map((r) => r.sectionKey)).size === rows.length, "A section can only be listed once");

/** A row that overrides nothing is the same as no row — callers drop those instead of storing empty rows. */
export const isEmptyOverride = (o: SectionOverride) => !has(o.enabled) && !has(o.sortOrder) && !has(o.title) && !has(o.content);

export const productFaqSchema = z.object({
  question: z.string().trim().min(1, "Write the question").max(200),
  answer: z.string().trim().min(1, "Write the answer").max(2000),
});
export const productFaqsSchema = z.array(productFaqSchema).max(30);

export const RELATION_KINDS = ["RELATED", "CROSS_SELL", "UPSELL", "FREQUENTLY_BOUGHT", "RECOMMENDED"] as const;
export const relationKindEnum = z.enum(RELATION_KINDS);
export const productRelationsSchema = z
  .array(
    z.object({
      kind: relationKindEnum,
      productIds: z.array(z.string().min(1)).max(12).refine((ids) => new Set(ids).size === ids.length, "A product can only be listed once per list"),
    }),
  )
  .refine((rows) => new Set(rows.map((r) => r.kind)).size === rows.length, "Each list can only be sent once");
export type ProductRelationsInput = z.infer<typeof productRelationsSchema>;

/* ───────────────────────── API shapes ───────────────────────── */

/** What the storefront needs per enabled section, in display order. */
export interface PublicSection {
  key: SectionKey;
  title: string;
  order: number;
  area: SectionArea;
  content: string | null;
}
