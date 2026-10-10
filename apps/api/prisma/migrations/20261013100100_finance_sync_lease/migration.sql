-- Financial Core Phase 3 (docs/FINANCE_PHASE_3.md §2): the commerce sweep is serialised per business by a lease on its
-- sync-state row instead of a session advisory lock. A session lock taken and released through a connection pool can be
-- released on a different connection and leak, blocking every later sweep; a lease row is atomic, needs no particular
-- connection, and expires on its own if the process holding it dies.
ALTER TABLE "FinanceSyncState" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "FinanceSyncState" ADD COLUMN "leaseUntil" TIMESTAMP(3);
