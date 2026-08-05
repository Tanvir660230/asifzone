import { z } from "zod";
import { nullableString } from "./common";

export const socialPlatformEnum = z.enum([
  "FACEBOOK",
  "INSTAGRAM",
  "YOUTUBE",
  "TIKTOK",
  "LINKEDIN",
  "X",
  "WHATSAPP",
  "OTHER",
]);

export const createSocialLinkSchema = z
  .object({
    platform: socialPlatformEnum,
    url: z.string().url().max(500),
    label: nullableString(60),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
  })
  .refine((data) => data.platform !== "OTHER" || Boolean(data.label), {
    message: "Label is required for a custom (Other) link",
    path: ["label"],
  });

export const updateSocialLinkSchema = z.object({
  platform: socialPlatformEnum.optional(),
  url: z.string().url().max(500).optional(),
  label: nullableString(60),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export type SocialPlatform = z.infer<typeof socialPlatformEnum>;
export type CreateSocialLinkInput = z.infer<typeof createSocialLinkSchema>;
export type UpdateSocialLinkInput = z.infer<typeof updateSocialLinkSchema>;
