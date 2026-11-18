-- Weekly and monthly business reports by SMS to the admin alert phones (docs/superpowers/plans/2026-11-18-business-reports.md, Part 4). Off by default.
ALTER TABLE "SmsNotificationSetting" ADD COLUMN "adminWeeklyReportEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SmsNotificationSetting" ADD COLUMN "adminMonthlyReportEnabled" BOOLEAN NOT NULL DEFAULT false;
