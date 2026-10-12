import { z, type ZodTypeAny } from "zod";
import { mediaUrlSchema, nullableDate, nullableMediaUrl, nullableString } from "./common";

export const homepageSectionTypeEnum = z.enum([
  "HERO",
  "TRUST_STRIP",
  "PERSONALIZED_LEAD",
  "PRODUCT_CAROUSEL",
  "FLASH_SALE",
  "CATEGORY_GRID",
  "BRAND_STORY",
  "VALUES_GRID",
  "SMART_RECOMMENDATIONS",
  "PROMO_BANNER",
  "RICH_TEXT",
  "TESTIMONIALS",
  "NEWSLETTER",
  "IMAGE_GALLERY",
]);

export type HomepageSectionType = z.infer<typeof homepageSectionTypeEnum>;

/** Types the builder allows more than one instance of — every other type is a singleton, seeded
 * once and toggle-only (enforced in homepage-section.service.ts, not by the schema). */
export const REPEATABLE_SECTION_TYPES: HomepageSectionType[] = [
  "PRODUCT_CAROUSEL",
  "PROMO_BANNER",
  "BRAND_STORY",
  "VALUES_GRID",
  "RICH_TEXT",
  "TESTIMONIALS",
  "NEWSLETTER",
  "IMAGE_GALLERY",
];

/* ── Appearance ──────────────────────────────────────────────────────────────────────────────────────────────────────
   How a section looks, chosen in the Storefront Studio's Style tab. Every option is rendered through theme tokens
   (apps/web/components/storefront/home/section-frame.tsx and the section components): spacing scales the theme's
   `--section-rhythm`, `tone` mirrors a dark band's palette, `background` uses the muted surface role — so a choice made
   here looks right in every brand theme. Everything is optional; an absent value keeps the theme's own design. */

export const sectionSpacingEnum = z.enum(["compact", "default", "spacious"]);
export const sectionShowOnEnum = z.enum(["all", "desktop", "mobile"]);
/** For the sections designed as a dark band (hero, brand story, text-only promo): the theme's choice, or forced. */
export const bandToneEnum = z.enum(["theme", "dark", "light"]);
export const sectionBackgroundEnum = z.enum(["default", "muted"]);

const appearanceBase = {
  spacing: sectionSpacingEnum.optional(),
  showOn: sectionShowOnEnum.optional(),
};

function appearance<T extends z.ZodRawShape>(extra: T) {
  return z.object({ ...appearanceBase, ...extra }).strict().optional();
}

const baseAppearanceSchema = appearance({});
const backgroundAppearanceSchema = appearance({ background: sectionBackgroundEnum.optional() });

export const heroAppearanceSchema = appearance({
  tone: bandToneEnum.optional(),
  /** With an image: the theme's composition, copy above the image, or copy beside it (from 1024px). */
  layout: z.enum(["theme", "stacked", "split"]).optional(),
});
export const brandStoryAppearanceSchema = appearance({
  tone: bandToneEnum.optional(),
  /** With an image: beside the copy on either side, or behind it as a full-bleed photograph. */
  layout: z.enum(["image-right", "image-left", "backdrop"]).optional(),
});
export const promoBannerAppearanceSchema = appearance({
  tone: bandToneEnum.optional(),
  width: z.enum(["contained", "full"]).optional(),
  align: z.enum(["center", "start"]).optional(),
});
export const productCarouselAppearanceSchema = appearance({
  rows: z.union([z.literal(1), z.literal(2)]).optional(),
});

export type SectionAppearance = {
  spacing?: z.infer<typeof sectionSpacingEnum>;
  showOn?: z.infer<typeof sectionShowOnEnum>;
  background?: z.infer<typeof sectionBackgroundEnum>;
  tone?: z.infer<typeof bandToneEnum>;
  layout?: string;
  width?: "contained" | "full";
  align?: "center" | "start";
  rows?: 1 | 2;
};

/* ── Section configs ─────────────────────────────────────────────────────────────────────────────────────────────── */

const emptyConfigSchema = z.object({ appearance: baseAppearanceSchema }).strict();

const trustStripItemSchema = z.object({
  icon: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});
export const trustStripConfigSchema = z.object({
  items: z.array(trustStripItemSchema).min(1).max(8),
  appearance: baseAppearanceSchema,
});

const valuesGridItemSchema = z.object({
  icon: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
});
export const valuesGridConfigSchema = z.object({
  /** Optional editorial copy; blank keeps the built-in "Why {store name}" / "What We Stand For". */
  eyebrow: nullableString(60),
  heading: nullableString(200),
  items: z.array(valuesGridItemSchema).min(1).max(8),
  appearance: backgroundAppearanceSchema,
});

export const brandStoryConfigSchema = z.object({
  /** Optional kicker above the heading; blank keeps "Our Philosophy". */
  eyebrow: nullableString(60),
  heading: nullableString(200),
  bodyText: nullableString(1000),
  ctaLabel: nullableString(60),
  ctaHref: nullableString(300),
  imageUrl: nullableMediaUrl(),
  imageAltText: nullableString(200),
  appearance: brandStoryAppearanceSchema,
});

export const heroConfigSchema = z.object({
  headline: nullableString(200),
  subtext: nullableString(300),
  /** Optional supporting line under the headline. */
  bodyText: nullableString(300),
  ctaLabel: nullableString(60),
  ctaHref: nullableString(300),
  /** Optional second, quieter action next to the primary one. */
  secondaryCtaLabel: nullableString(60),
  secondaryCtaHref: nullableString(300),
  /** Optional large image shown with the copy (the hero is otherwise a typographic band). */
  imageUrl: nullableMediaUrl(),
  imageAltText: nullableString(200),
  appearance: heroAppearanceSchema,
});

export const personalizedLeadConfigSchema = z.object({
  eyebrow: nullableString(60),
  // `{category}` is replaced with the visitor's most-recently-viewed category name at render time.
  titleTemplate: nullableString(200),
  appearance: baseAppearanceSchema,
});

export const smartRecommendationsConfigSchema = z.object({
  title: nullableString(200),
  appearance: baseAppearanceSchema,
});

export const categoryGridConfigSchema = z.object({
  heading: nullableString(200),
  /** Optional supporting line under the heading. */
  subtitle: nullableString(300),
  appearance: backgroundAppearanceSchema,
});

export const productCarouselSourceEnum = z.enum(["featured", "new", "category"]);

export const productCarouselConfigSchema = z
  .object({
    heading: z.string().min(1, "Add a heading").max(200),
    subtitle: nullableString(300),
    source: productCarouselSourceEnum.default("featured"),
    // A Category *slug* (matching `listStorefrontProducts({ category })`), not an id — the
    // storefront product-listing endpoint filters by slug, so storing an id here would need an
    // extra lookup at render time for no benefit.
    category: nullableString(160),
    itemCount: z.number().int().min(1).max(24).default(8),
    appearance: productCarouselAppearanceSchema,
  })
  .refine((data) => data.source !== "category" || !!data.category, {
    message: "Pick a category",
    path: ["category"],
  });

export const promoBannerConfigSchema = z
  .object({
    heading: nullableString(200),
    bodyText: nullableString(500),
    /** Without an image the banner is a typographic band in the theme's dark section color (an editorial callout). */
    imageUrl: nullableMediaUrl(),
    mobileImageUrl: nullableMediaUrl(),
    imageAltText: nullableString(200),
    linkUrl: nullableString(500),
    ctaLabel: nullableString(60),
    appearance: promoBannerAppearanceSchema,
  })
  .refine((data) => !!data.imageUrl || !!data.heading, {
    message: "Add an image, or a heading for a text-only banner",
    path: ["imageUrl"],
  });

/** A short editorial text block: a statement, an announcement, a size or delivery note. */
export const richTextConfigSchema = z.object({
  eyebrow: nullableString(60),
  heading: z.string().min(1, "Add a heading").max(200),
  bodyText: nullableString(2000),
  ctaLabel: nullableString(60),
  ctaHref: nullableString(300),
  align: z.enum(["start", "center"]).optional(),
  appearance: backgroundAppearanceSchema,
});

/** Real, approved customer reviews (with written text) — never authored copy. */
export const testimonialsConfigSchema = z.object({
  eyebrow: nullableString(60),
  heading: nullableString(200),
  count: z.number().int().min(3).max(12).default(6),
  minRating: z.number().int().min(3).max(5).default(4),
  appearance: backgroundAppearanceSchema,
});

export const newsletterConfigSchema = z.object({
  heading: nullableString(200),
  bodyText: nullableString(400),
  appearance: backgroundAppearanceSchema,
});

const galleryItemSchema = z.object({
  imageUrl: mediaUrlSchema,
  altText: nullableString(200),
  caption: nullableString(80),
  linkUrl: nullableString(500),
});
/** A lookbook: 2–8 photographs, each optionally linking to a product, category or collection. */
export const imageGalleryConfigSchema = z.object({
  eyebrow: nullableString(60),
  heading: nullableString(200),
  layout: z.enum(["grid", "mosaic"]).default("mosaic"),
  items: z.array(galleryItemSchema).min(2, "Add at least two photos").max(8),
  appearance: backgroundAppearanceSchema,
});

/** The `config` JSON column's shape depends on `type` — this is the lookup both the admin forms
 * and the backend service validate against, since a real discriminated union doesn't fit a flat
 * Prisma row where `type` and `config` are separate columns. */
export const configSchemaByType: Record<HomepageSectionType, ZodTypeAny> = {
  HERO: heroConfigSchema,
  TRUST_STRIP: trustStripConfigSchema,
  PERSONALIZED_LEAD: personalizedLeadConfigSchema,
  PRODUCT_CAROUSEL: productCarouselConfigSchema,
  FLASH_SALE: emptyConfigSchema,
  CATEGORY_GRID: categoryGridConfigSchema,
  BRAND_STORY: brandStoryConfigSchema,
  VALUES_GRID: valuesGridConfigSchema,
  SMART_RECOMMENDATIONS: smartRecommendationsConfigSchema,
  PROMO_BANNER: promoBannerConfigSchema,
  RICH_TEXT: richTextConfigSchema,
  TESTIMONIALS: testimonialsConfigSchema,
  NEWSLETTER: newsletterConfigSchema,
  IMAGE_GALLERY: imageGalleryConfigSchema,
};

export const createHomepageSectionSchema = z.object({
  type: homepageSectionTypeEnum,
  config: z.unknown().optional(),
  isActive: z.boolean().default(true),
  startsAt: nullableDate(),
  endsAt: nullableDate(),
});

/** No `type` here — a section's type never changes after creation, and PATCH targets an existing
 * row by id, so `config`'s shape is validated against that row's own type in the service, not here. */
export const updateHomepageSectionSchema = z.object({
  config: z.unknown().optional(),
  isActive: z.boolean().optional(),
  startsAt: nullableDate(),
  endsAt: nullableDate(),
});

// Not .cuid(): the default sections are created with fixed ids ("seed-hero", …). The service checks the list is exactly
// the existing sections, which is the real guard.
export const reorderHomepageSectionsSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
});

/* ── Storefront Studio documents ─────────────────────────────────────────────────────────────────────────────────── */

/** One section of the Studio's draft. `id` is the live row's id, or `new-…` for a section not yet published. The config
 * is stored as typed (it may be half-filled while the admin works) and validated strictly only on publish. */
export const studioSectionSchema = z.object({
  id: z.string().min(1).max(64),
  type: homepageSectionTypeEnum,
  isActive: z.boolean(),
  config: z.record(z.unknown()),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
});

export const saveStudioDraftSchema = z.object({
  /** The draft version this edit was made on; a mismatch means someone else saved in between (409). */
  version: z.number().int().min(0),
  sections: z.array(studioSectionSchema).max(60),
});

export const publishStudioDraftSchema = z.object({
  version: z.number().int().min(0),
});

export type CreateHomepageSectionInput = z.infer<typeof createHomepageSectionSchema>;
export type UpdateHomepageSectionInput = z.infer<typeof updateHomepageSectionSchema>;
export type ReorderHomepageSectionsInput = z.infer<typeof reorderHomepageSectionsSchema>;
export type StudioSection = z.infer<typeof studioSectionSchema>;
export type SaveStudioDraftInput = z.infer<typeof saveStudioDraftSchema>;
export type PublishStudioDraftInput = z.infer<typeof publishStudioDraftSchema>;
export type TrustStripConfig = z.infer<typeof trustStripConfigSchema>;
export type ValuesGridConfig = z.infer<typeof valuesGridConfigSchema>;
export type BrandStoryConfig = z.infer<typeof brandStoryConfigSchema>;
export type CategoryGridConfig = z.infer<typeof categoryGridConfigSchema>;
export type ProductCarouselConfig = z.infer<typeof productCarouselConfigSchema>;
export type PromoBannerConfig = z.infer<typeof promoBannerConfigSchema>;
export type HeroConfig = z.infer<typeof heroConfigSchema>;
export type PersonalizedLeadConfig = z.infer<typeof personalizedLeadConfigSchema>;
export type SmartRecommendationsConfig = z.infer<typeof smartRecommendationsConfigSchema>;
export type RichTextConfig = z.infer<typeof richTextConfigSchema>;
export type TestimonialsConfig = z.infer<typeof testimonialsConfigSchema>;
export type NewsletterConfig = z.infer<typeof newsletterConfigSchema>;
export type ImageGalleryConfig = z.infer<typeof imageGalleryConfigSchema>;
