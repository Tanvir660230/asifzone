-- Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3): links between existing products only.
-- CreateTable
CREATE TABLE "ProductFamily" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFamilyMember" (
    "familyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,

    CONSTRAINT "ProductFamilyMember_pkey" PRIMARY KEY ("familyId","productId")
);

-- CreateIndex
CREATE INDEX "ProductFamilyMember_productId_idx" ON "ProductFamilyMember"("productId");

-- AddForeignKey
ALTER TABLE "ProductFamilyMember" ADD CONSTRAINT "ProductFamilyMember_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFamilyMember" ADD CONSTRAINT "ProductFamilyMember_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
