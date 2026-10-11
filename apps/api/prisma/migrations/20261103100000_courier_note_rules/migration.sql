-- Courier notes: store-defined instructions for the courier (Catalog → Courier notes), ticked on products/categories or
-- triggered by a big discount, joined into the parcel note when an order is booked.
CREATE TYPE "CourierNoteTrigger" AS ENUM ('PRODUCT', 'DISCOUNT');

CREATE TABLE "CourierNoteRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "trigger" "CourierNoteTrigger" NOT NULL DEFAULT 'PRODUCT',
    "minDiscountPercent" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierNoteRule_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN "courierNoteRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Category" ADD COLUMN "courierNoteRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Order: staff's own wording of the courier note (null = built from the rules) and what was actually sent at booking.
ALTER TABLE "Order" ADD COLUMN "courierNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "courierNoteSent" TEXT;
