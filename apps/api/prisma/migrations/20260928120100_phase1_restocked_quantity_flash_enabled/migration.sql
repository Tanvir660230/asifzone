-- Phase 1: additive columns + projection backfills. No order money field (subtotal/discount/total/
-- priceSnapshot/...) is read-modified-written here: historical financial snapshots stay untouched.

-- 1. Per-line restock idempotency (docs/INVENTORY_INVARIANTS.md).
ALTER TABLE "OrderItem" ADD COLUMN "restockedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the ledger: every positive, order-linked movement (old cancellations were ADJUSTMENT,
-- returns/partial deliveries/exchanges RETURN, trash ADJUSTMENT) put units of that line back.
UPDATE "OrderItem" oi
SET "restockedQuantity" = LEAST(oi.quantity, GREATEST(0, s.restocked))
FROM (
  SELECT sm."orderId", sm."variantId", SUM(sm.change)::int AS restocked
  FROM "StockMovement" sm
  WHERE sm."orderId" IS NOT NULL AND sm.change > 0
  GROUP BY sm."orderId", sm."variantId"
) s
WHERE s."orderId" = oi."orderId" AND s."variantId" = oi."variantId";

-- Orders the old code already treated as "stock put back" (it restocked on any move into CANCELLED or
-- REFUNDED), including rows from before the ledger recorded order movements: never restock them again.
UPDATE "OrderItem" oi
SET "restockedQuantity" = oi.quantity
FROM "Order" o
WHERE o.id = oi."orderId" AND o.status IN ('CANCELLED', 'REFUNDED');

-- A RETURNED order's restocked units came back from the customer.
UPDATE "OrderItem" oi
SET "returnedQuantity" = GREATEST(oi."returnedQuantity", oi."restockedQuantity")
FROM "Order" o
WHERE o.id = oi."orderId" AND o.status = 'RETURNED';

-- 2. Flash sale: separate the admin's switch from the derived "live" cache. Every existing sale starts
-- enabled — before this column, the scheduler activated every sale inside its window regardless.
ALTER TABLE "FlashSale" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

-- 3. D1: a delivered COD order's cash was collected at the door. paymentStatus is a projection (not a
-- money snapshot); totals are not touched.
UPDATE "Order"
SET "paymentStatus" = 'PAID'
WHERE "paymentMethod" = 'COD' AND status = 'DELIVERED' AND "paymentStatus" = 'UNPAID';
