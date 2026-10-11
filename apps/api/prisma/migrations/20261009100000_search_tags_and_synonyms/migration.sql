-- Search: admin-entered product tags (YouTube-style) and store-wide synonym groups, both matched by storefront search.
ALTER TABLE "Product" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Product_tags_idx" ON "Product" USING GIN ("tags");

-- Store-wide synonym groups managed from Catalog → Search synonyms.
CREATE TABLE "SearchSynonym" (
    "id" TEXT NOT NULL,
    "terms" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSynonym_pkey" PRIMARY KEY ("id")
);
