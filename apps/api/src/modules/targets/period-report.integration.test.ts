import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma";
import { getProviders } from "../../providers/registry";
import { getSmsSettings, updateSmsSettings } from "../sms-settings/sms-settings.service";
import { sendPeriodReport } from "./period-report.service";

// Weekly / monthly reports by SMS (docs/superpowers/plans/2026-11-18-business-reports.md, Part 4). A fixed past date so
// the once-a-day marker never meets a real one.
const SATURDAY = new Date("2011-08-13T06:00:00Z"); // Sat 13 Aug 2011, noon in Dhaka
const FIRST = new Date("2011-09-01T06:00:00Z"); // 1 Sep 2011

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { type: { in: ["analytics.weekly_report", "analytics.monthly_report"] }, OR: [{ createdAt: { lt: new Date("2012-01-01") } }, { title: { contains: "2011" } }] } });
  await prisma.$disconnect();
});

describe("weekly and monthly reports", () => {
  it("sends nothing until the owner switches a report on, then once a day to every alert phone", async () => {
    const before = await getSmsSettings();
    const send = vi.spyOn(getProviders().sms, "send").mockResolvedValue(undefined as never);
    try {
      await updateSmsSettings({ adminAlertPhones: "01711000001,01811000002", adminWeeklyReportEnabled: false, adminMonthlyReportEnabled: false });
      expect(await sendPeriodReport("week", SATURDAY)).toBeNull();
      expect(send).not.toHaveBeenCalled();

      await updateSmsSettings({ adminWeeklyReportEnabled: true });
      const text = await sendPeriodReport("week", SATURDAY);
      expect(text).toMatch(/^.+ - Aug so far \(day 13\/31\): Sales BDT [\d,]+/);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0]![0]).toMatchObject({ to: "01711000001", body: text });

      // a retry the same day sends nothing again
      expect(await sendPeriodReport("week", SATURDAY)).toBeNull();
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      send.mockRestore();
      await updateSmsSettings({ adminAlertPhones: before.adminAlertPhones, adminWeeklyReportEnabled: before.adminWeeklyReportEnabled, adminMonthlyReportEnabled: before.adminMonthlyReportEnabled });
    }
  });

  it("the monthly report on the 1st closes the month just ended", async () => {
    const before = await getSmsSettings();
    const send = vi.spyOn(getProviders().sms, "send").mockResolvedValue(undefined as never);
    try {
      await updateSmsSettings({ adminAlertPhones: "01711000001", adminMonthlyReportEnabled: true });
      const text = await sendPeriodReport("month", FIRST);
      expect(text).toMatch(/^.+ - August 2011: Sales BDT [\d,]+/);
      expect(send).toHaveBeenCalledTimes(1);
      // and it lands in the bell too
      expect(await prisma.notification.count({ where: { type: "analytics.monthly_report", title: { contains: "August 2011" } } })).toBe(1);
    } finally {
      send.mockRestore();
      await updateSmsSettings({ adminAlertPhones: before.adminAlertPhones, adminMonthlyReportEnabled: before.adminMonthlyReportEnabled });
    }
  });

  it("a failed text never throws", async () => {
    const before = await getSmsSettings();
    const send = vi.spyOn(getProviders().sms, "send").mockRejectedValue(new Error("sms down"));
    try {
      await updateSmsSettings({ adminAlertPhones: "01711000001", adminMonthlyReportEnabled: true });
      await prisma.notification.deleteMany({ where: { type: "analytics.monthly_report", title: { contains: "August 2011" } } });
      await expect(sendPeriodReport("month", FIRST)).resolves.toEqual(expect.any(String));
    } finally {
      send.mockRestore();
      await updateSmsSettings({ adminAlertPhones: before.adminAlertPhones, adminMonthlyReportEnabled: before.adminMonthlyReportEnabled });
    }
  });
});
