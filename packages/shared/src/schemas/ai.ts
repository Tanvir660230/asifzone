import { z } from "zod";

export const aiContentTypeEnum = z.enum([
  "product_description",
  "seo_title",
  "meta_description",
  "seo_keywords",
  "marketing_copy",
  "email_copy",
  "campaign_suggestion",
]);

/** Every field here is optional at the schema level — which ones are actually required for a
 * given `type` is enforced in ai.service.ts's prompt builder, not here, since the required set
 * differs per type. */
export const generateAiContentSchema = z.object({
  type: aiContentTypeEnum,
  productName: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  keyPoints: z.string().max(1000).optional(),
  tone: z.string().max(60).optional(),
  topic: z.string().max(500).optional(),
  audience: z.string().max(200).optional(),
});

export const generateImageAltTextSchema = z.object({
  imageUrl: z.string().min(1).max(500),
});

export type AiContentType = z.infer<typeof aiContentTypeEnum>;
export type GenerateAiContentInput = z.infer<typeof generateAiContentSchema>;
export type GenerateImageAltTextInput = z.infer<typeof generateImageAltTextSchema>;
