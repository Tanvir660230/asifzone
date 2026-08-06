import { z } from "zod";

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushUnsubscribeQuerySchema = z.object({
  endpoint: z.string().url(),
});

export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;
export type PushUnsubscribeQuery = z.infer<typeof pushUnsubscribeQuerySchema>;
