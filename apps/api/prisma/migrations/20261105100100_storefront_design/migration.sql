-- Storefront Studio → Site design: the published design on the store settings, and the draft / revision copies.
ALTER TABLE "StoreSetting" ADD COLUMN "storefrontDesign" JSONB;
ALTER TABLE "HomepageDraft" ADD COLUMN "design" JSONB;
ALTER TABLE "HomepageRevision" ADD COLUMN "design" JSONB;
