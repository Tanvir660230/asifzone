-- AlterTable
ALTER TABLE "PageView" ADD COLUMN     "city" TEXT,
ADD COLUMN     "clickCount" INTEGER,
ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "isLoggedIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "scrollDepthPct" INTEGER;
