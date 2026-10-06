-- Phase 7: store content that belonged in configuration — the default social-sharing (Open Graph) image, the homepage's
-- search title and description, and the newsletter block's heading and text. All optional: empty keeps today's
-- behaviour (the logo as share image, store name and tagline for the homepage, the built-in newsletter copy).
ALTER TABLE "StoreSetting" ADD COLUMN "ogImageUrl" TEXT;
ALTER TABLE "StoreSetting" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "StoreSetting" ADD COLUMN "seoDescription" TEXT;
ALTER TABLE "StoreSetting" ADD COLUMN "newsletterHeading" TEXT;
ALTER TABLE "StoreSetting" ADD COLUMN "newsletterText" TEXT;
