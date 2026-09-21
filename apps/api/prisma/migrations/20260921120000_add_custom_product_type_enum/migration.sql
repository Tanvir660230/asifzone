-- AlterEnum
-- Own migration: Postgres cannot use a newly added enum value in the transaction that adds it,
-- and the next migration defaults ProductTypeDef.legacyType to CUSTOM.
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'CUSTOM';
