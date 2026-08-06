-- A prior migration (20260804103405_add_product_search_index) is recorded as applied but the
-- index it defines is not actually present in the database. Re-create it defensively with
-- IF NOT EXISTS so this is a safe no-op wherever it already exists.
CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);
