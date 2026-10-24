-- Inventory recovery phase 3: Stock › Filled runs as a stock hub entry (a lease, a fingerprint and the steps it made), so a
-- double tap waits, a retry resumes where it stopped and a replay writes nothing. Additive: a new entry kind only.
ALTER TYPE "StockHubEntryKind" ADD VALUE 'FILL';
