-- Supplier refunds (docs/FINANCE_PHASE_4F.md): the enum value alone — Postgres can't use a new enum value in the transaction
-- that adds it, so the shape check and guard that use it come in the next migration.
ALTER TYPE "TreasuryMovementKind" ADD VALUE 'SUPPLIER_REFUND';
