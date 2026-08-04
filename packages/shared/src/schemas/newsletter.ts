import { z } from "zod";

export const subscribeNewsletterSchema = z.object({
  email: z.string().email(),
});

export type SubscribeNewsletterInput = z.infer<typeof subscribeNewsletterSchema>;
