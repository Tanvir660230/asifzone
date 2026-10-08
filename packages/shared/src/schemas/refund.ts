import { z } from "zod";
import { paginationQuerySchema } from "./common";

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

/** Finance › Transactions and Refunds (Blueprint V2 §M): read-only lists over the payment ledger. */
export const paymentProviderEnum = z.enum(["SSLCOMMERZ", "EPS_PG", "COD", "MANUAL", "STORE_CREDIT"]);
const ledgerListBase = paginationQuerySchema.extend({
  /** Order number, customer name or phone. */
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const paymentTransactionListQuerySchema = ledgerListBase.extend({
  provider: paymentProviderEnum.optional(),
  status: z.enum(["SUCCEEDED", "FAILED"]).optional(),
});
/** Finance › Online attempts (Blueprint V2 P5): gateway checkout sessions. */
export const paymentSessionStatusEnum = z.enum(["ACTIVE", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);
export const paymentSessionListQuerySchema = ledgerListBase.extend({
  status: paymentSessionStatusEnum.optional(),
  provider: z.enum(["SSLCOMMERZ", "EPS_PG"]).optional(),
});
export type PaymentSessionListQuery = z.infer<typeof paymentSessionListQuerySchema>;
export interface PaymentSessionRow {
  id: string;
  provider: "SSLCOMMERZ" | "EPS_PG";
  status: z.infer<typeof paymentSessionStatusEnum>;
  /** What the gateway was asked to collect; null for sessions from before that was recorded. */
  amount: number | null;
  gatewayRef: string;
  providerTransactionId: string | null;
  createdAt: string;
  expiresAt: string;
  /** Null for a storefront checkout that never became an order (failed / abandoned / still open). */
  order: { id: string; orderNumber: string } | null;
  customerName: string | null;
  customerPhone: string | null;
  /** What started it: a storefront checkout, a retry on an order, a payment link, or an order change's difference. */
  source: "checkout" | "order" | "payment_link" | "modification";
  lastEvent: { type: string; note: string | null; at: string } | null;
}

/** Administration › Audit log filters (Admin V2). */
export const auditLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  adminId: z.string().max(64).optional(),
  entityType: z.string().max(64).optional(),
  /** Matches the action's verb or full name ("delete", "orders.update"). */
  action: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  requestId: z.string().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

export const refundListQuerySchema = ledgerListBase.extend({
  status: z.enum(["REQUESTED", "COMPLETED"]).optional(),
});

export interface LedgerOrderRef {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
}

export interface PaymentTransactionRow {
  id: string;
  settledAt: string;
  provider: z.infer<typeof paymentProviderEnum>;
  status: "SUCCEEDED" | "FAILED";
  amount: number;
  providerTransactionId: string | null;
  note: string | null;
  recordedBy: string | null;
  order: LedgerOrderRef | null;
}

export interface RefundRow {
  id: string;
  createdAt: string;
  completedAt: string | null;
  status: "REQUESTED" | "COMPLETED";
  amount: number;
  reason: string | null;
  method: string | null;
  requestedBy: string | null;
  completedBy: string | null;
  order: LedgerOrderRef;
}

export type PaymentTransactionListQuery = z.infer<typeof paymentTransactionListQuerySchema>;
export type RefundListQuery = z.infer<typeof refundListQuerySchema>;
