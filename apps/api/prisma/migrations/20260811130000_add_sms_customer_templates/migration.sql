-- AlterTable
ALTER TABLE "SmsNotificationSetting"
ADD COLUMN "customerOrderPlacedTemplate" TEXT,
ADD COLUMN "customerOrderConfirmedTemplate" TEXT,
ADD COLUMN "customerOrderShippedTemplate" TEXT,
ADD COLUMN "customerOrderDeliveredTemplate" TEXT,
ADD COLUMN "customerOrderCancelledTemplate" TEXT;
