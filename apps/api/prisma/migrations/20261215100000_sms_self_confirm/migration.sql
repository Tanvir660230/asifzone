-- The order-placed SMS can carry a link where the customer confirms (or cancels) their own cash-on-delivery order.
-- Off by default: switching it on changes the message customers get.
ALTER TABLE "SmsNotificationSetting" ADD COLUMN "customerSelfConfirmEnabled" BOOLEAN NOT NULL DEFAULT false;
