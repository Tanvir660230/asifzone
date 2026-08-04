-- Enable trigram matching so ILIKE/"contains" product-name search can use an index instead of a full table scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
