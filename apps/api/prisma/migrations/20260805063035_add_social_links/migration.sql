-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'TIKTOK', 'LINKEDIN', 'X', 'WHATSAPP', 'OTHER');

-- CreateTable
CREATE TABLE "SocialLink" (
    "id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialLink_isActive_sortOrder_idx" ON "SocialLink"("isActive", "sortOrder");

-- DataMigration: carry over any existing facebookUrl/whatsappNumber values on the singleton
-- StoreSetting row into the new SocialLink table before the old columns are dropped, so nothing
-- an admin already configured silently disappears. instagramUrl is included for symmetry even
-- though it was unset in every known environment at the time of this migration.
INSERT INTO "SocialLink" ("id", "platform", "url", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 25), 'FACEBOOK', "facebookUrl", 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StoreSetting" WHERE "facebookUrl" IS NOT NULL AND "facebookUrl" != '';

INSERT INTO "SocialLink" ("id", "platform", "url", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 25), 'INSTAGRAM', "instagramUrl", 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StoreSetting" WHERE "instagramUrl" IS NOT NULL AND "instagramUrl" != '';

INSERT INTO "SocialLink" ("id", "platform", "url", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT substr(md5(random()::text || clock_timestamp()::text), 1, 25), 'WHATSAPP', 'https://wa.me/' || regexp_replace("whatsappNumber", '\D', '', 'g'), 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StoreSetting" WHERE "whatsappNumber" IS NOT NULL AND "whatsappNumber" != '';

-- AlterTable
ALTER TABLE "StoreSetting" DROP COLUMN "facebookUrl",
DROP COLUMN "instagramUrl",
DROP COLUMN "whatsappNumber";
