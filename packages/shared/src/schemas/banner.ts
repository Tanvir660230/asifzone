import { z } from "zod";
import { nullableString, nullableUrl } from "./common";

export const bannerPlacementEnum = z.enum(["HERO_CAROUSEL", "PROMO_STRIP"]);

export const createBannerSchema = z.object({
  placement: bannerPlacementEnum.default("HERO_CAROUSEL"),
  imageUrl: z.string().url(),
  mobileImageUrl: nullableUrl(),
  linkUrl: nullableString(500),
  title: nullableString(200),
  subtitle: nullableString(300),
  altText: nullableString(200),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateBannerSchema = createBannerSchema.partial();

export const activeBannersQuerySchema = z.object({
  placement: bannerPlacementEnum.default("HERO_CAROUSEL"),
});

export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
export type BannerPlacement = z.infer<typeof bannerPlacementEnum>;
export type ActiveBannersQuery = z.infer<typeof activeBannersQuerySchema>;
