import { z } from "zod";

// orderId comes from the route param (/orders/:id/refunds), not the body. No gateway refund API
// exists for either EPS or SSLCommerz (see Refund's schema comment) — this records what an admin
// actually did (their own bKash/bank transfer), it never triggers a real money movement itself.
export const recordRefundSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
  // Free text — "bKash", "Bank transfer", "Cash", ... — the set of real-world methods isn't fixed.
  method: z.string().max(100).optional(),
});

export type RecordRefundInput = z.infer<typeof recordRefundSchema>;
