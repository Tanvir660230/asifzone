import { z, type ZodTypeAny } from "zod";
import { nullableString, nullableUrl } from "./common";

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
]);

export type HomepageSectionType = z.infer<typeof homepageSectionTypeEnum>;

/** Types the builder allows more than one instance of — every other type is a singleton, seeded
 * once and toggle-only (enforced in homepage-section.service.ts, not by the schema). */
export const REPEATABLE_SECTION_TYPES: HomepageSectionType[] = ["PRODUCT_CAROUSEL", "PROMO_BANNER"];

const emptyConfigSchema = z.object({}).strict();

const trustStripItemSchema = z.object({
  icon: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
});
export const trustStripConfigSchema = z.object({
  items: z.array(trustStripItemSchema).min(1).max(8),
});

const valuesGridItemSchema = z.object({
  icon: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
});
export const valuesGridConfigSchema = z.object({
  items: z.array(valuesGridItemSchema).min(1).max(8),
});

export const brandStoryConfigSchema = z.object({
  heading: nullableString(200),
  bodyText: nullableString(1000),
  ctaLabel: nullableString(60),
  ctaHref: nullableString(300),
});

export const categoryGridConfigSchema = z.object({
  heading: nullableString(200),
});

export const productCarouselSourceEnum = z.enum(["featured", "new", "category"]);

export const productCarouselConfigSchema = z
  .object({
    heading: z.string().min(1).max(200),
    subtitle: nullableString(300),
    source: productCarouselSourceEnum.default("featured"),
    // A Category *slug* (matching `listStorefrontProducts({ category })`), not an id — the
    // storefront product-listing endpoint filters by slug, so storing an id here would need an
    // extra lookup at render time for no benefit.
    category: nullableString(160),
    itemCount: z.number().int().min(1).max(24).default(8),
  })
  .refine((data) => data.source !== "category" || !!data.category, {
    message: "category is required when source is \"category\"",
    path: ["category"],
  });

export const promoBannerConfigSchema = z.object({
  heading: nullableString(200),
  bodyText: nullableString(500),
  imageUrl: z.string().url(),
  mobileImageUrl: nullableUrl(),
  linkUrl: nullableString(500),
  ctaLabel: nullableString(60),
});

/** The `config` JSON column's shape depends on `type` — this is the lookup both the admin forms
 * and the backend service validate against, since a real discriminated union doesn't fit a flat
 * Prisma row where `type` and `config` are separate columns. */
export const configSchemaByType: Record<HomepageSectionType, ZodTypeAny> = {
  HERO: emptyConfigSchema,
  TRUST_STRIP: trustStripConfigSchema,
  PERSONALIZED_LEAD: emptyConfigSchema,
  PRODUCT_CAROUSEL: productCarouselConfigSchema,
  FLASH_SALE: emptyConfigSchema,
  CATEGORY_GRID: categoryGridConfigSchema,
  BRAND_STORY: brandStoryConfigSchema,
  VALUES_GRID: valuesGridConfigSchema,
  SMART_RECOMMENDATIONS: emptyConfigSchema,
  PROMO_BANNER: promoBannerConfigSchema,
};

export const createHomepageSectionSchema = z.object({
  type: homepageSectionTypeEnum,
  config: z.unknown().optional(),
  isActive: z.boolean().default(true),
});

/** No `type` here — a section's type never changes after creation, and PATCH targets an existing
 * row by id, so `config`'s shape is validated against that row's own type in the service, not here. */
export const updateHomepageSectionSchema = z.object({
  config: z.unknown().optional(),
  isActive: z.boolean().optional(),
});

export const reorderHomepageSectionsSchema = z.object({
  ids: z.array(z.string().cuid()).min(1),
});

export type CreateHomepageSectionInput = z.infer<typeof createHomepageSectionSchema>;
export type UpdateHomepageSectionInput = z.infer<typeof updateHomepageSectionSchema>;
export type ReorderHomepageSectionsInput = z.infer<typeof reorderHomepageSectionsSchema>;
export type TrustStripConfig = z.infer<typeof trustStripConfigSchema>;
export type ValuesGridConfig = z.infer<typeof valuesGridConfigSchema>;
export type BrandStoryConfig = z.infer<typeof brandStoryConfigSchema>;
export type CategoryGridConfig = z.infer<typeof categoryGridConfigSchema>;
export type ProductCarouselConfig = z.infer<typeof productCarouselConfigSchema>;
export type PromoBannerConfig = z.infer<typeof promoBannerConfigSchema>;
