-- The morning brief by SMS to the admin alert phones (opt-in, off by default).
ALTER TABLE "SmsNotificationSetting" ADD COLUMN "adminDailyBriefEnabled" BOOLEAN NOT NULL DEFAULT false;
