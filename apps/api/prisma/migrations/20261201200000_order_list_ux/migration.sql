-- Order Operations phase 2 (list UX): additive only.
-- Per-admin list display preferences (density, page size, hidden columns).
ALTER TABLE "AdminUser" ADD COLUMN "listPreferences" JSONB;

-- Exact search on a scanned/pasted label barcode.
CREATE INDEX "Order_trackingNumber_idx" ON "Order"("trackingNumber");
