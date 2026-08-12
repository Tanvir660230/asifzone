import { z } from "zod";

export const createSmsTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(1000),
});

export const updateSmsTemplateSchema = createSmsTemplateSchema.partial();

export const bulkSendSmsSchema = z.object({
  customerIds: z.array(z.string().cuid()).min(1).max(500),
  body: z.string().min(1).max(1000),
});

export type CreateSmsTemplateInput = z.infer<typeof createSmsTemplateSchema>;
export type UpdateSmsTemplateInput = z.infer<typeof updateSmsTemplateSchema>;
export type BulkSendSmsInput = z.infer<typeof bulkSendSmsSchema>;
