-- Clean up any pre-existing double-defaults (possible under the old race-prone app logic) before
-- adding the constraint that prevents new ones: keep only the most recently created default per
-- customer, unset the rest.
WITH ranked AS (
  SELECT id, "customerId",
    ROW_NUMBER() OVER (PARTITION BY "customerId" ORDER BY "createdAt" DESC) AS rn
  FROM "Address"
  WHERE "isDefault" = true
)
UPDATE "Address" a
SET "isDefault" = false
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;

-- Prisma's schema DSL can't express a partial/conditional unique constraint, so this exists only
-- as raw SQL, not as an `@@unique` in schema.prisma (see the comment on the Address model).
CREATE UNIQUE INDEX IF NOT EXISTS "Address_customerId_default_key" ON "Address" ("customerId") WHERE "isDefault" = true;
