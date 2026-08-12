-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "codRisk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isBlocked" BOOLEAN NOT NULL DEFAULT false;
