-- "Also show in": extra categories a product is listed in besides its home category (Product.categoryId).
CREATE TABLE "ProductCategoryListing" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategoryListing_pkey" PRIMARY KEY ("productId","categoryId")
);

CREATE INDEX "ProductCategoryListing_categoryId_idx" ON "ProductCategoryListing"("categoryId");

ALTER TABLE "ProductCategoryListing" ADD CONSTRAINT "ProductCategoryListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCategoryListing" ADD CONSTRAINT "ProductCategoryListing_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
