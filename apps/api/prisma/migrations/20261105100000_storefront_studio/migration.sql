-- Storefront Studio: four new homepage section types, the homepage draft and the publish history.
ALTER TYPE "HomepageSectionType" ADD VALUE 'RICH_TEXT';
ALTER TYPE "HomepageSectionType" ADD VALUE 'TESTIMONIALS';
ALTER TYPE "HomepageSectionType" ADD VALUE 'NEWSLETTER';
ALTER TYPE "HomepageSectionType" ADD VALUE 'IMAGE_GALLERY';

CREATE TABLE "HomepageDraft" (
    "id" TEXT NOT NULL DEFAULT 'homepage',
    "version" INTEGER NOT NULL DEFAULT 0,
    "sections" JSONB,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HomepageRevision" (
    "id" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomepageRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HomepageRevision_publishedAt_idx" ON "HomepageRevision"("publishedAt");
