import { z } from "zod";
import { nullableEmail, nullableString, paginationQuerySchema } from "./common";

export const createFeedbackSchema = z.object({
  name: z.string().min(1).max(120),
  email: nullableEmail(),
  phone: nullableString(32),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
});

export const feedbackStatusFilterEnum = z.enum(["all", "unread", "read"]);

export const feedbackListQuerySchema = paginationQuerySchema.extend({
  status: feedbackStatusFilterEnum.optional(),
  search: z.string().max(200).optional(),
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type FeedbackStatusFilter = z.infer<typeof feedbackStatusFilterEnum>;
export type FeedbackListQuery = z.infer<typeof feedbackListQuerySchema>;
