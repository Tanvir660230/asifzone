-- Order Operations phase 2: the Orders list's default order is "last status change", so an order placed days ago and
-- confirmed or booked today is found at the top, not pages back. Additive: a new column, its index and a trigger.

ALTER TABLE "Order" ADD COLUMN "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing orders: the time of their latest status-history entry (the order's own creation time when there is none).
UPDATE "Order" o
SET "statusChangedAt" = COALESCE((SELECT MAX(h."createdAt") FROM "OrderStatusHistory" h WHERE h."orderId" = o."id"), o."createdAt");

CREATE INDEX "Order_statusChangedAt_idx" ON "Order"("statusChangedAt");

-- Every status change stamps the time, whichever code path (admin, courier sync, customer cancel, job) made it.
CREATE OR REPLACE FUNCTION order_status_changed_at() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusChangedAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Order_status_changed_at" BEFORE UPDATE OF "status" ON "Order"
FOR EACH ROW EXECUTE FUNCTION order_status_changed_at();
