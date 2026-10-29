-- Blueprint P0.2 (owner decisions Q3 = A, Q-D): a third cost policy. Roll-forward only: an older API build cannot read a
-- business set to this value, so it is set (with approval) only after the release that knows it is live.
ALTER TYPE "FinanceCostPolicy" ADD VALUE IF NOT EXISTS 'AUTO_ESTIMATE';
