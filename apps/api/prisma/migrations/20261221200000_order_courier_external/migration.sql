-- Parcels booked on a courier account this store cannot read (see Order.courierExternal).
ALTER TABLE "Order" ADD COLUMN "courierExternal" BOOLEAN NOT NULL DEFAULT false;
