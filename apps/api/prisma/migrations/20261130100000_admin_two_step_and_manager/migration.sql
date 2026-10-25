-- Admin audit phase 2: a MANAGER role (runs the store and the books, but not staff, settings or partner / payroll money)
-- and 2-step sign-in (an authenticator-app code after the password).
ALTER TYPE "AdminRole" ADD VALUE 'MANAGER';

ALTER TABLE "AdminUser"
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
  ADD COLUMN "totpLastStep" INTEGER,
  ADD COLUMN "totpRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "totpFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totpLockedUntil" TIMESTAMP(3);
