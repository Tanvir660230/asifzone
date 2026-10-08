-- Blueprint V2 PERF-01/02: the customer list's read model and its sync watermark, plus the timestamp indexes the
-- incremental sync scans.
CREATE TABLE "CustomerFact" (
    "customerId" TEXT NOT NULL,
    "netSpend" DECIMAL(14,2) NOT NULL,
    "ordersPlaced" INTEGER NOT NULL,
    "ordersRealised" INTEGER NOT NULL,
    "ordersAll" INTEGER NOT NULL,
    "cancelledOrders" INTEGER NOT NULL,
    "holdOrders" INTEGER NOT NULL,
    "lastOrderAt" TIMESTAMP(3),
    "district" TEXT,
    "tags" TEXT[],
    "tagsExpireAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFact_pkey" PRIMARY KEY ("customerId")
);

CREATE TABLE "CustomerFactSync" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFactSync_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerFact_netSpend_idx" ON "CustomerFact"("netSpend");
CREATE INDEX "CustomerFact_ordersPlaced_idx" ON "CustomerFact"("ordersPlaced");
CREATE INDEX "CustomerFact_lastOrderAt_idx" ON "CustomerFact"("lastOrderAt");
CREATE INDEX "CustomerFact_district_idx" ON "CustomerFact"("district");
CREATE INDEX "CustomerFact_tagsExpireAt_idx" ON "CustomerFact"("tagsExpireAt");
CREATE INDEX "Customer_updatedAt_idx" ON "Customer"("updatedAt");
CREATE INDEX "Order_updatedAt_idx" ON "Order"("updatedAt");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");
CREATE INDEX "Refund_createdAt_idx" ON "Refund"("createdAt");
CREATE INDEX "ReturnRequest_updatedAt_idx" ON "ReturnRequest"("updatedAt");
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

ALTER TABLE "CustomerFact" ADD CONSTRAINT "CustomerFact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An order purged, or moved to another customer, leaves no timestamp on the previous customer's side: mark that customer
-- for recomputation. (Edits and new orders are found by the sync's timestamp scan.)
CREATE TABLE "CustomerFactDirty" (
    "customerId" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFactDirty_pkey" PRIMARY KEY ("customerId")
);

CREATE FUNCTION "customer_fact_mark_previous_customer"() RETURNS trigger AS $$
BEGIN
  IF OLD."customerId" IS NOT NULL AND (TG_OP = 'DELETE' OR OLD."customerId" IS DISTINCT FROM NEW."customerId") THEN
    INSERT INTO "CustomerFactDirty" ("customerId") VALUES (OLD."customerId")
    ON CONFLICT ("customerId") DO UPDATE SET "markedAt" = CURRENT_TIMESTAMP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_customer_fact_dirty"
AFTER DELETE OR UPDATE OF "customerId" ON "Order"
FOR EACH ROW EXECUTE FUNCTION "customer_fact_mark_previous_customer"();
