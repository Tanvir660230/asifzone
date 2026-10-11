-- Admin V2 DR-15: per-admin notification read state.
CREATE TABLE "NotificationRead" (
    "notificationId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("notificationId","adminId")
);

CREATE INDEX "NotificationRead_adminId_idx" ON "NotificationRead"("adminId");

CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a notification someone already read stays read for every current admin (no old alerts reappear as unread).
INSERT INTO "NotificationRead" ("notificationId", "adminId", "readAt")
SELECT n."id", a."id", n."readAt"
FROM "Notification" n CROSS JOIN "AdminUser" a
WHERE n."readAt" IS NOT NULL;
