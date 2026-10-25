-- Material purchase units (docs/MANUFACTURING.md §3): how a material is bought — a litre = 1,000 ml, a dozen = 12 pcs.
CREATE TABLE "MaterialPurchaseUnit" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPurchaseUnit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MaterialPurchaseUnit_factor_positive" CHECK ("factor" > 0)
);

CREATE UNIQUE INDEX "MaterialPurchaseUnit_productId_label_key" ON "MaterialPurchaseUnit"("productId", "label");

ALTER TABLE "MaterialPurchaseUnit" ADD CONSTRAINT "MaterialPurchaseUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
