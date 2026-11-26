-- TikTok ad spend (owner's books §5.2): days brought in from TikTok's reporting API carry source TIKTOK_API, next to
-- Meta's META_API. Only the allowed list grows; existing rows are untouched.
ALTER TABLE "AdSpendDay" DROP CONSTRAINT "AdSpendDay_values";
ALTER TABLE "AdSpendDay" ADD CONSTRAINT "AdSpendDay_values" CHECK ("amount" >= 0 AND "source" IN ('META_API', 'TIKTOK_API', 'MANUAL', 'CSV', 'PERIOD'));
