-- CreateTable
CREATE TABLE "SmsNotificationSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "adminAlertPhones" TEXT NOT NULL DEFAULT '',
    "adminOrderAlertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerOrderPlacedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerOrderConfirmedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerOrderShippedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerOrderDeliveredEnabled" BOOLEAN NOT NULL DEFAULT true,
    "customerOrderCancelledEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsNotificationSetting_pkey" PRIMARY KEY ("id")
);
