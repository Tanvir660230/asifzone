-- Landing page smart checkout (2026-11-24): exchange-only policy, size finder snapshot on orders, LP funnel stages,
-- utm_content on page views.
CREATE TYPE "ReturnPolicyKind" AS ENUM ('RETURN', 'EXCHANGE');
ALTER TABLE "StoreSetting" ADD COLUMN "returnPolicyKind" "ReturnPolicyKind" NOT NULL DEFAULT 'RETURN';
ALTER TABLE "Order" ADD COLUMN "sizeAssist" JSONB;
ALTER TYPE "FunnelEventType" ADD VALUE 'SIZE_ASSIST_OPENED';
ALTER TYPE "FunnelEventType" ADD VALUE 'SIZE_ASSIST_COMPLETED';
ALTER TYPE "FunnelEventType" ADD VALUE 'CHECKOUT_STARTED';
ALTER TYPE "FunnelEventType" ADD VALUE 'SHIPPING_INFO_ADDED';
ALTER TABLE "PageView" ADD COLUMN "utmContent" TEXT;
