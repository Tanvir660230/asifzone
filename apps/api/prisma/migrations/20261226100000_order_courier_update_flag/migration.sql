-- Customer details changed after the courier was booked: the courier still has the old ones until staff tell it.
ALTER TABLE "Order" ADD COLUMN "courierUpdateNeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "courierUpdateNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "courierUpdateAt" TIMESTAMP(3);
CREATE INDEX "Order_courierUpdateNeeded_idx" ON "Order"("courierUpdateNeeded") WHERE "courierUpdateNeeded";
