-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "codEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onlinePaymentEnabled" BOOLEAN NOT NULL DEFAULT true;
