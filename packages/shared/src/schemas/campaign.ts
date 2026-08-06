import { z } from "zod";
import { paginationQuerySchema, nullableDate } from "./common";

export const campaignChannelEnum = z.enum(["EMAIL", "SMS", "PUSH"]);
export const campaignStatusEnum = z.enum(["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED"]);

/** Each maps to a predefined audience query in campaign.service.ts — kept as a closed enum
 * rather than a free-form filter builder for this first version of the campaign engine. */
export const segmentTypeEnum = z.enum([
  "ALL_CUSTOMERS",
  "NEWSLETTER_SUBSCRIBERS",
  "CUSTOMERS_WITH_ORDERS",
  "CUSTOMERS_NO_ORDER_30D",
]);

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  channel: campaignChannelEnum,
  subject: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  body: z.string().min(1),
  segmentType: segmentTypeEnum,
  scheduledAt: nullableDate(),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  channel: campaignChannelEnum.optional(),
  subject: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  body: z.string().min(1).optional(),
  segmentType: segmentTypeEnum.optional(),
});

export const campaignListQuerySchema = paginationQuerySchema.extend({
  status: campaignStatusEnum.optional(),
});

export const scheduleCampaignSchema = z.object({
  scheduledAt: z.coerce.date(),
});

export type CampaignChannel = z.infer<typeof campaignChannelEnum>;
export type CampaignStatus = z.infer<typeof campaignStatusEnum>;
export type SegmentType = z.infer<typeof segmentTypeEnum>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;
export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;
