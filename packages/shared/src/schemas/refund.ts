import { z } from "zod";

// orderId comes from the route param (/orders/:id/refunds), not the body. No gateway refund API
// exists for either EPS or SSLCommerz (see Refund's schema comment) — this records what an admin
// actually did (their own bKash/bank transfer), it never triggers a real money movement itself.
// Phase 4 (docs/PAYMENT_LEDGER.md): partial and repeated refunds are allowed, up to the order's `refundable` amount.
export const recordRefundSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
  // Free text — "bKash", "Bank transfer", "Cash", ... — the set of real-world methods isn't fixed.
  method: z.string().max(100).optional(),
});

export type RecordRefundInput = z.infer<typeof recordRefundSchema>;

/** Marks a REQUESTED refund (a D6 exchange downgrade) as paid out. */
export const completeRefundSchema = z.object({
  method: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export type CompleteRefundInput = z.infer<typeof completeRefundSchema>;

/** A payment staff record by hand (docs/PAYMENT_LEDGER.md §5): MANUAL = received out of band (bKash/bank/cash) before
 * dispatch; COD_COLLECTED = the cash the courier collected on a partially delivered COD order. */
export const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  kind: z.enum(["MANUAL", "COD_COLLECTED"]),
  method: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** Repair of the Order.paymentStatus projection from the ledger — a dry run unless `apply` is true. */
export const paymentLedgerRepairSchema = z.object({
  apply: z.boolean().optional().default(false),
});

export type PaymentLedgerRepairInput = z.infer<typeof paymentLedgerRepairSchema>;
