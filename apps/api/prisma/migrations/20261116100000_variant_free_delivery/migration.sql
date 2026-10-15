-- A variant may override its product's free-delivery setting; NULL = follow the product.
ALTER TABLE "ProductVariant" ADD COLUMN "freeDelivery" BOOLEAN;
