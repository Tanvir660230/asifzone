-- Owner's books (docs/FINANCE_OWNER_BOOKS.md) — new enum values in their own migration, before anything uses them.
ALTER TYPE "FinancialAccountKind" ADD VALUE IF NOT EXISTS 'AD_PLATFORM';
ALTER TYPE "StockMovementReason" ADD VALUE IF NOT EXISTS 'PACKAGING_USE';
ALTER TYPE "ClearingSettlementSource" ADD VALUE IF NOT EXISTS 'API_IMPORT';
