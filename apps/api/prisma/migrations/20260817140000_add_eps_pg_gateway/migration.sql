-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'EPS_PG';

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "epsPaymentEnabled" BOOLEAN NOT NULL DEFAULT false;
