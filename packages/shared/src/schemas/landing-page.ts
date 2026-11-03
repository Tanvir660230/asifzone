import { z } from "zod";
import { mediaUrlSchema, slugSchema } from "./common";

/* Campaign landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2). A page is a product, which of its variants to
   offer, and an ordered list of sections from a fixed set. Every option is a choice between theme-token looks — no
   free CSS, HTML or script — so a page looks right in every brand theme and can't break the order form. Prices, stock
   and delivery charges are never stored here: the sections read them live from the product and the store settings. */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.preprocess((v) => (v === null ? undefined : v), text(max).optional());
const optionalMedia = z.preprocess((v) => (v === "" || v === null ? undefined : v), mediaUrlSchema.optional());

/** A section's background: the page canvas, a raised surface, or the theme's muted surface. */
export const landingBackgroundEnum = z.enum(["canvas", "surface", "muted"]);
export type LandingBackground = z.infer<typeof landingBackgroundEnum>;

/** Icons a trust or feature item may use — a fixed set, drawn from the storefront's own icon library. */
export const LANDING_ICONS = ["truck", "banknote", "rotate", "shield", "star", "phone", "sparkles", "ruler", "package", "badge"] as const;
export const landingIconEnum = z.enum(LANDING_ICONS);
export type LandingIcon = z.infer<typeof landingIconEnum>;

const base = {
  /** Stable within a page, so the editor can reorder and the preview can scroll to a section. */
  id: z.string().min(1).max(40),
  enabled: z.boolean().default(true),
  background: landingBackgroundEnum.default("canvas"),
};

const item = z.object({ icon: landingIconEnum.optional(), title: text(80).min(1), text: optionalText(240) });

export const landingSectionSchema = z.discriminatedUnion("type", [
  /** A headline over a photograph (the product's first photo when none is chosen), with a button down to the order form. */
  z.object({
    ...base,
    type: z.literal("hero"),
    eyebrow: optionalText(60),
    headline: text(120).min(1),
    subheadline: optionalText(240),
    imageUrl: optionalMedia,
    ctaText: optionalText(40),
    align: z.enum(["start", "center"]).default("start"),
  }),
  /** Gallery beside name, price, rating and short description — the gallery follows the chosen colour. */
  z.object({
    ...base,
    type: z.literal("product"),
    showRating: z.boolean().default(true),
    showShortDescription: z.boolean().default(true),
    showPromises: z.boolean().default(true),
  }),
  /** One tile per colour offered, with that colour's own photo; a tap chooses it and goes to the order form. */
  z.object({ ...base, type: z.literal("colors"), title: text(80).min(1), subtitle: optionalText(200) }),
  z.object({ ...base, type: z.literal("features"), title: text(80).min(1), items: z.array(item).min(1).max(8) }),
  z.object({
    ...base,
    type: z.literal("specs"),
    title: text(80).min(1),
    rows: z.array(z.object({ label: text(60).min(1), value: text(200).min(1) })).min(1).max(12),
  }),
  /** Words only: an offer section never changes a price — the price is the product's (and any live flash sale's). */
  z.object({
    ...base,
    type: z.literal("offer"),
    badge: optionalText(40),
    title: text(120).min(1),
    text: optionalText(400),
    /** Shows a countdown to this moment; the section hides itself once it has passed. */
    endsAt: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().datetime({ offset: true }).optional()),
  }),
  z.object({ ...base, type: z.literal("description"), title: text(80).min(1) }),
  z.object({ ...base, type: z.literal("reviews") }),
  /** Delivery days and fees from the store's own settings — nothing typed here can promise what the store hasn't set. */
  z.object({ ...base, type: z.literal("delivery"), title: text(80).min(1) }),
  z.object({
    ...base,
    type: z.literal("faq"),
    title: text(80).min(1),
    items: z.array(z.object({ q: text(200).min(1), a: text(1000).min(1) })).max(12).default([]),
    /** Adds the standard answers built from the store's settings (delivery time and fee, COD, returns). */
    includeStandard: z.boolean().default(true),
  }),
  z.object({ ...base, type: z.literal("trust"), items: z.array(item).min(1).max(6) }),
  z.object({
    ...base,
    type: z.literal("order"),
    title: text(80).min(1),
    subtitle: optionalText(240),
    ctaText: optionalText(40),
  }),
  z.object({ ...base, type: z.literal("moreProducts") }),
]);
export type LandingSection = z.infer<typeof landingSectionSchema>;
export type LandingSectionType = LandingSection["type"];
export type LandingSectionInput = z.input<typeof landingSectionSchema>;

/** Sections a page may hold only once (the order form is the page's one checkout). */
export const LANDING_SINGLETON_SECTIONS: LandingSectionType[] = ["product", "colors", "order", "reviews", "delivery", "description", "moreProducts"];

export const landingDesignSchema = z.object({
  /** Headings in the theme's display face, or in its text face for a plainer page. */
  headingFont: z.enum(["display", "sans"]).default("display"),
  /** The bottom bar on phones with the price and an order button. */
  stickyCta: z.boolean().default(true),
  /** "Call us" in the slim header (when the store has a phone number). */
  headerCall: z.boolean().default(true),
});
export type LandingDesign = z.infer<typeof landingDesignSchema>;

export const landingPageContentSchema = z.object({
  productId: z.string().min(1).max(40),
  /** A collection page: more products sold beside the main one, behind the same colour/size picker — each keeps its own
   * variants, prices and stock (landing-collection.ts). The main product stays the page's product for tracking, reviews
   * and "more products". */
  extraProductIds: z
    .array(z.string().min(1).max(40))
    .max(11)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, "A product is listed twice"),
  /** The page's title in place of the main product's name — e.g. "Haven sleeveless jackets" for a collection. */
  displayName: optionalText(120),
  /** The variants this page sells, a subset of its products'. Empty = every active variant. */
  variantIds: z.array(z.string().min(1).max(40)).max(200).default([]),
  /** A colour as the page shows it — on a collection page a repeated colour carries its product's name (landingColorLabels). */
  defaultColor: optionalText(160),
  defaultSize: optionalText(80),
  design: landingDesignSchema.default({}),
  seoTitle: optionalText(70),
  seoDescription: optionalText(200),
  ogImageUrl: optionalMedia,
  sections: z
    .array(landingSectionSchema)
    .min(1)
    .max(30)
    .superRefine((sections, ctx) => {
      const ids = new Set<string>();
      const singletons = new Set<string>();
      sections.forEach((s, i) => {
        if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "Two sections share one id" });
        ids.add(s.id);
        if (LANDING_SINGLETON_SECTIONS.includes(s.type)) {
          if (singletons.has(s.type)) ctx.addIssue({ code: "custom", path: [i, "type"], message: `A page can have only one ${s.type} section` });
          singletons.add(s.type);
        }
      });
      if (!sections.some((s) => s.type === "order" && s.enabled)) ctx.addIssue({ code: "custom", message: "The page needs its order form section turned on" });
    }),
});
export type LandingPageContent = z.infer<typeof landingPageContentSchema>;
export type LandingPageContentInput = z.input<typeof landingPageContentSchema>;

/* ── Admin API ───────────────────────────────────────────────────────────────────────────────────────────────────── */

export const LANDING_TEMPLATE_KEYS = ["single", "colors", "launch", "offer"] as const;
export const landingTemplateKeyEnum = z.enum(LANDING_TEMPLATE_KEYS);
export type LandingTemplateKey = z.infer<typeof landingTemplateKeyEnum>;

export const createLandingPageSchema = z.object({
  name: text(120).min(1, "Give the page a name"),
  slug: slugSchema,
  productId: z.string().min(1, "Choose a product").max(40),
  templateKey: landingTemplateKeyEnum.default("single"),
});
export type CreateLandingPageInput = z.input<typeof createLandingPageSchema>;

export const saveLandingPageSchema = z.object({
  name: text(120).min(1, "Give the page a name"),
  slug: slugSchema,
  content: landingPageContentSchema,
  /** The version the editor loaded; an older one is refused with 409. */
  version: z.number().int().min(0),
});
export type SaveLandingPageInput = z.input<typeof saveLandingPageSchema>;

export const duplicateLandingPageSchema = z.object({ name: text(120).min(1), slug: slugSchema });
export type DuplicateLandingPageInput = z.infer<typeof duplicateLandingPageSchema>;

export type LandingPageStatus = "DRAFT" | "PUBLISHED";

export interface LandingPageSummary {
  id: string;
  name: string;
  slug: string;
  status: LandingPageStatus;
  templateKey: string | null;
  productId: string;
  productName: string;
  productSlug: string;
  productStatus: string;
  /** The working copy differs from what is live. */
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface LandingPageDetail extends LandingPageSummary {
  content: LandingPageContent;
  version: number;
}

/** What the storefront renders: the published content (or, for an admin preview, the working copy). */
export interface PublicLandingPage {
  id: string;
  name: string;
  slug: string;
  productSlug: string;
  /** A collection page's other products that are on sale now, in the page's order (unpublished ones are left out). */
  extraProductSlugs: string[];
  content: LandingPageContent;
}

/* ── Templates ───────────────────────────────────────────────────────────────────────────────────────────────────── */

let seq = 0;
/** A section id unique within a page (time + counter: two sections added in one tick still differ). */
export function newLandingSectionId(type: string): string {
  seq = (seq + 1) % 1296;
  return `${type.slice(0, 6)}-${Date.now().toString(36)}${seq.toString(36)}`;
}

/** A fresh section of a type, with copy a Bangla page can go live with. */
export function defaultLandingSection(type: LandingSectionType): LandingSection {
  const id = newLandingSectionId(type);
  const common = { id, enabled: true, background: "canvas" as const };
  switch (type) {
    case "hero":
      return { ...common, type, headline: "নতুন কালেকশন, সীমিত স্টক", subheadline: "পছন্দের কালার ও সাইজ বেছে এখনই অর্ডার করুন।", ctaText: "এখনই অর্ডার করুন", align: "start" };
    case "product":
      return { ...common, type, showRating: true, showShortDescription: true, showPromises: true };
    case "colors":
      return { ...common, type, title: "আপনার পছন্দের কালার বেছে নিন", subtitle: "প্রতিটি কালারের আসল ছবি দেখুন" };
    case "features":
      return {
        ...common,
        type,
        title: "কেন এটি আলাদা",
        items: [
          { icon: "sparkles", title: "প্রিমিয়াম কাপড়", text: "আরামদায়ক ও টেকসই" },
          { icon: "ruler", title: "নিখুঁত মাপ", text: "প্রতিটি সাইজ যত্ন করে মাপা" },
          { icon: "badge", title: "নিজস্ব মান নিয়ন্ত্রণ", text: "পাঠানোর আগে প্রতিটি পণ্য যাচাই" },
        ],
      };
    case "specs":
      return { ...common, type, title: "বিস্তারিত তথ্য", rows: [{ label: "কাপড়", value: "—" }] };
    case "offer":
      return { ...common, type, background: "muted", badge: "সীমিত সময়", title: "বিশেষ অফার চলছে", text: "স্টক শেষ হওয়ার আগেই অর্ডার করুন।" };
    case "description":
      return { ...common, type, title: "পণ্যের বিবরণ" };
    case "reviews":
      return { ...common, type };
    case "delivery":
      return { ...common, type, title: "ডেলিভারি ও পেমেন্ট" };
    case "faq":
      return { ...common, type, title: "যা জানতে চান", items: [], includeStandard: true };
    case "trust":
      return {
        ...common,
        type,
        items: [
          { icon: "truck", title: "সারা দেশে হোম ডেলিভারি" },
          { icon: "banknote", title: "ক্যাশ অন ডেলিভারি" },
          { icon: "shield", title: "আসল পণ্যের নিশ্চয়তা" },
        ],
      };
    case "order":
      return { ...common, type, background: "surface", title: "এখনই অর্ডার করুন", subtitle: "নাম, মোবাইল নম্বর ও ঠিকানা দিন। আমাদের প্রতিনিধি ফোন করে অর্ডারটি নিশ্চিত করবেন।", ctaText: "অর্ডার কনফার্ম করুন" };
    case "moreProducts":
      return { ...common, type };
  }
}

export const LANDING_SECTION_LABELS: Record<LandingSectionType, { label: string; hint: string }> = {
  hero: { label: "Hero banner", hint: "Headline over a photo, with a button to the order form" },
  product: { label: "Gallery & price", hint: "Photos that follow the chosen colour, name, price and rating" },
  colors: { label: "Colour showcase", hint: "One tile per colour with its own photo" },
  features: { label: "Features", hint: "Up to 8 short points with icons" },
  specs: { label: "Specifications", hint: "A table of details: fabric, fit, care…" },
  offer: { label: "Offer", hint: "Words and an optional countdown — never changes the price" },
  description: { label: "Description", hint: "The product's own description" },
  reviews: { label: "Reviews", hint: "Approved customer reviews (hidden while there are none)" },
  delivery: { label: "Delivery & payment", hint: "Days and fees from your store settings" },
  faq: { label: "FAQ", hint: "Your questions, plus the standard ones if you like" },
  trust: { label: "Trust badges", hint: "A row of short promises" },
  order: { label: "Order form", hint: "Colour, size, quantity and the Cash on Delivery form" },
  moreProducts: { label: "More products", hint: "Other products from the same category" },
};

export const LANDING_TEMPLATES: Record<LandingTemplateKey, { name: string; description: string; sections: LandingSectionType[] }> = {
  single: {
    name: "Single product",
    description: "Gallery and price first, the order form right after — the shortest way from ad to order.",
    sections: ["product", "trust", "order", "description", "delivery", "faq", "reviews", "moreProducts"],
  },
  colors: {
    name: "Multiple colours",
    description: "A colour showcase up top so shoppers pick their colour before anything else.",
    sections: ["hero", "colors", "product", "order", "features", "delivery", "faq", "reviews"],
  },
  launch: {
    name: "Product launch",
    description: "A hero headline, features and specifications to introduce something new.",
    sections: ["hero", "product", "features", "specs", "order", "description", "faq", "reviews"],
  },
  offer: {
    name: "Promotional offer",
    description: "An offer band with a countdown above the product and the order form.",
    sections: ["offer", "product", "trust", "order", "delivery", "faq", "reviews", "moreProducts"],
  },
};

/** A template's content for a product: a fresh copy each time, so editing a page never changes the template. */
export function landingTemplateContent(key: LandingTemplateKey, productId: string): LandingPageContent {
  return {
    productId,
    extraProductIds: [],
    variantIds: [],
    design: { headingFont: "display", stickyCta: true, headerCall: true },
    sections: LANDING_TEMPLATES[key].sections.map(defaultLandingSection),
  };
}

/** The variants a page offers: its chosen ones that still exist and are active, or all active ones when none of its
 * choice is left (a deleted or deactivated variant never empties a live page). */
export function landingVariants<V extends { id: string; isActive?: boolean }>(variants: V[], variantIds: string[]): V[] {
  const active = variants.filter((v) => v.isActive !== false);
  if (!variantIds.length) return active;
  const chosen = new Set(variantIds);
  const picked = active.filter((v) => chosen.has(v.id));
  return picked.length ? picked : active;
}
