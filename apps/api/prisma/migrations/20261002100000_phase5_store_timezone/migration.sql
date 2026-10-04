-- Phase 5 (docs/METRICS_REGISTRY.md §1): the store's business timezone becomes configuration. ADDITIVE ONLY — one
-- defaulted column; the default reproduces today's hard-coded behaviour. No existing row or column is changed otherwise.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka';
