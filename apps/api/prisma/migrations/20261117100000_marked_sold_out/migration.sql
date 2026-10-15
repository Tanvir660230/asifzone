-- "Show as sold out" for a whole product or one variant, independent of stock (stock is never changed by it).
ALTER TABLE "Product" ADD COLUMN "markedSoldOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductVariant" ADD COLUMN "markedSoldOut" BOOLEAN NOT NULL DEFAULT false;
