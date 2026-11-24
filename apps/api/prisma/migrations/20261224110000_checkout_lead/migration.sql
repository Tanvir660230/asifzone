-- Incomplete orders (docs/INCOMPLETE_ORDERS.md): shoppers who typed a phone number and left without ordering.
CREATE TABLE "CheckoutLead" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "shippingDistrict" TEXT,
    "shippingArea" TEXT,
    "shippingAddressLine" TEXT,
    "items" JSONB NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "landingSlug" TEXT,
    "sessionId" TEXT,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "nextCallAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutLead_phone_idx" ON "CheckoutLead"("phone");
CREATE INDEX "CheckoutLead_status_nextCallAt_idx" ON "CheckoutLead"("status", "nextCallAt");
CREATE INDEX "CheckoutLead_createdAt_idx" ON "CheckoutLead"("createdAt");

-- One open lead per phone: a second capture updates it. Prisma's schema can't express a partial unique index (same
-- pattern as ReturnRequest_orderId_pending_key).
CREATE UNIQUE INDEX "CheckoutLead_phone_open_key" ON "CheckoutLead"("phone") WHERE "status" = 'OPEN';
