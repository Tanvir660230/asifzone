-- Phase 4 (docs/PAYMENT_LEDGER.md §11): ledger backfill. INSERT ONLY — no existing row is updated or deleted, and no
-- Order column is touched. Each inserted Payment restates a fact the order's own record already asserts, and is marked
-- backfilled = true with a note:
--   (a) paymentStatus PAID/REFUNDED with no SUCCEEDED Payment row → one settlement of the order total. Provider COD when
--       the order is COD and its timeline shows DELIVERED (D1: delivered = collected; settled at that moment), else
--       MANUAL (the admin "mark paid", or a free exchange; settled at order creation).
--   (b) a COD order whose timeline shows DELIVERED but still reads UNPAID (pre-Phase-1 returned-after-delivery orders,
--       which refundOrderPayment already treated as collected) → a COD settlement of the total.
-- The Order.paymentStatus projection is NOT rewritten here: orders whose stored status now differs from the ledger
-- (legacy partial refunds stored as REFUNDED, case (b)) appear in the drift report and are fixed by the explicit
-- repair command (GET/POST /api/payment-admin/ledger/drift|repair, `pnpm --filter api payment-ledger:reconcile`).
-- Ids are deterministic ('p4bf' + md5(order id)), so re-running inserts nothing twice.

INSERT INTO "Payment" (
  "id", "orderId", "paymentSessionId", "provider", "status", "amount", "verifiedAmount",
  "note", "backfilled", "settledAt", "createdAt"
)
SELECT
  'p4bf' || md5(o."id"),
  o."id",
  NULL,
  CASE WHEN o."paymentMethod" = 'COD' AND d."deliveredAt" IS NOT NULL THEN 'COD'::"PaymentProvider" ELSE 'MANUAL'::"PaymentProvider" END,
  'SUCCEEDED'::"PaymentTxnStatus",
  o."total",
  NULL,
  CASE
    WHEN o."paymentStatus" = 'UNPAID' THEN 'Phase 4 backfill: delivered COD order — cash collected on delivery (D1), never recorded as paid'
    WHEN o."paymentMethod" = 'COD' AND d."deliveredAt" IS NOT NULL THEN 'Phase 4 backfill: COD collected on delivery (D1) before the payment ledger existed'
    ELSE 'Phase 4 backfill: order was marked paid before the payment ledger existed'
  END,
  true,
  COALESCE(d."deliveredAt", o."createdAt"),
  -- Stored like Prisma's own timestamps (UTC wall clock), whatever the session timezone (INVENTORY_INVARIANTS INV-8).
  (NOW() AT TIME ZONE 'UTC')
FROM "Order" o
LEFT JOIN LATERAL (
  SELECT MIN(h."createdAt") AS "deliveredAt"
  FROM "OrderStatusHistory" h
  WHERE h."orderId" = o."id" AND h."status" = 'DELIVERED'
) d ON true
WHERE NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" = 'SUCCEEDED')
  AND (
    o."paymentStatus" IN ('PAID', 'REFUNDED')
    OR (o."paymentMethod" = 'COD' AND o."paymentStatus" = 'UNPAID' AND d."deliveredAt" IS NOT NULL)
  )
ON CONFLICT ("id") DO NOTHING;
