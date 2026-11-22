-- The cash-on-delivery amount as Steadfast last reported it (facts only; existing orders stay null).
ALTER TABLE "Order" ADD COLUMN "courierCodBooked" DECIMAL(10,2),
  ADD COLUMN "courierCodNow" DECIMAL(10,2),
  ADD COLUMN "courierCodSource" TEXT,
  ADD COLUMN "courierCodAt" TIMESTAMP(3);
