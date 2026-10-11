-- Financial Core Phase 4F — supplier payments (docs/FINANCE_PHASE_4F.md). The new movement kind on its own: Postgres can't
-- use an enum value in the transaction that adds it, so the constraints that name it follow in the next migration.
ALTER TYPE "TreasuryMovementKind" ADD VALUE 'SUPPLIER_PAYMENT';
