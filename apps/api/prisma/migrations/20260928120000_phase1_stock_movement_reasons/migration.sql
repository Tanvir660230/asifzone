-- Phase 1 (docs/INVENTORY_INVARIANTS.md): distinguish cancellations, imports and write-offs in the stock
-- ledger. Additive only — existing rows keep their reason. Kept in its own migration because Postgres
-- does not allow a newly added enum value to be used in the same transaction that adds it.
ALTER TYPE "StockMovementReason" ADD VALUE IF NOT EXISTS 'CANCELLATION';
ALTER TYPE "StockMovementReason" ADD VALUE IF NOT EXISTS 'IMPORT';
ALTER TYPE "StockMovementReason" ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE "StockMovementReason" ADD VALUE IF NOT EXISTS 'LOST';
