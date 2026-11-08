import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { addDays } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getProviders } from "../../providers/registry";
import { getSmsSettings, updateSmsSettings } from "../sms-settings/sms-settings.service";
import { getAnomalies, getDailyBrief, sendMorningBrief } from "./anomalies.service";

// A fixed Dhaka Wednesday long ago, with four earlier Wednesdays of 12 orders each, and only 2 orders on the day.
const DAY = "2008-06-25";
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+06:00`);
const NEXT_NOON = at(addDays(DAY, 1), "12:00");
let n = 0;

async function placeOn(date: string, count: number, variantId: string, admin: string) {
  for (let i = 0; i < count; i++) {
    const o = await createManualOrder(
      {
        items: [{ variantId, quantity: 1 }],
        customerName: "Vitest Anomaly",
        customerPhone: `0166${String(++n).padStart(7, "0")}`,
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Area",
        shippingAddressLine: "House 1",
        paymentMethod: "COD",
      } as never,
      admin,
    );
    trackOrder(o.id);
    const placed = at(date, `${String(9 + (i % 10)).padStart(2, "0")}:00`);
    await prisma.orderStatusHistory.updateMany({ where: { orderId: o.id }, data: { createdAt: placed } });
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: placed } });
  }
}

beforeAll(async () => {
  const admin = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [200], basePrice: 700 });
  for (const w of [7, 14, 21, 28]) await placeOn(addDays(DAY, -w), 12, variants[0]!.id, admin);
  await placeOn(DAY, 2, variants[0]!.id, admin);
}, 120_000);

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { type: "analytics.daily_brief", title: { startsWith: "Wednesday:" }, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("anomalies and the daily brief", () => {
  it("flags orders falling far below the usual weekday", async () => {
    const r = await getAnomalies(DAY, NEXT_NOON);
    expect(r.partialDay).toBe(false);
    const orders = r.anomalies.find((a) => a.key === "placed");
    expect(orders).toMatchObject({ direction: "down", value: 2, expected: 12 });
  });

  it("writes the brief for a day, and the morning job puts yesterday's in the bell", async () => {
    const b = await getDailyBrief(DAY, NEXT_NOON);
    expect(b.headline).toMatch(/^Wednesday: 2 orders \(usual 12, −83%\)/);
    expect(b.watch[0]).toBe("Orders were down: 2 against a usual 12");

    expect(await sendMorningBrief(NEXT_NOON)).not.toBeNull();
    const note = await prisma.notification.findFirst({ where: { type: "analytics.daily_brief" }, orderBy: { createdAt: "desc" } });
    expect(note).toMatchObject({ title: b.headline, link: "/admin/analytics/operations" });
    expect(note!.body).toContain("Watch: Orders were down");
  });

  it("sends one brief per store day, so the job's retry after a success sends nothing", async () => {
    // Real time: the written row lands inside the day the check looks at. The first call may find one already sent today.
    const since = new Date(Date.now() - 2 * 86_400_000);
    await sendMorningBrief();
    const after = await prisma.notification.count({ where: { type: "analytics.daily_brief", createdAt: { gte: since } } });
    expect(await sendMorningBrief()).toBeNull();
    expect(await prisma.notification.count({ where: { type: "analytics.daily_brief", createdAt: { gte: since } } })).toBe(after);
    await prisma.notification.deleteMany({ where: { type: "analytics.daily_brief", createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
  });

  it("texts the brief to the alert phones only when the owner switched it on", async () => {
    const before = await getSmsSettings();
    const send = vi.spyOn(getProviders().sms, "send").mockResolvedValue(undefined as never);
    try {
      await updateSmsSettings({ adminAlertPhones: "01711000001,01811000002", adminDailyBriefEnabled: false });
      await sendMorningBrief(NEXT_NOON);
      expect(send).not.toHaveBeenCalled();

      await updateSmsSettings({ adminDailyBriefEnabled: true });
      await sendMorningBrief(NEXT_NOON);
      expect(send).toHaveBeenCalledTimes(2);
      const body = send.mock.calls[0]![0].body;
      expect(body).toMatch(/: Wed: 2 orders, BDT [\d,]+ sales/);
      expect(body.length).toBeLessThanOrEqual(160);

      // A failed text never fails the brief.
      send.mockRejectedValueOnce(new Error("sms down"));
      await expect(sendMorningBrief(NEXT_NOON)).resolves.not.toBeNull();
    } finally {
      send.mockRestore();
      await updateSmsSettings({ adminAlertPhones: before.adminAlertPhones, adminDailyBriefEnabled: before.adminDailyBriefEnabled });
    }
  });

  it("is reachable over the API", async () => {
    const agent = await asOwner();
    const a = await agent.get(`/api/analytics/anomalies?date=${DAY}`);
    expect(a.status).toBe(200);
    expect(a.body.anomalies.some((x: { key: string }) => x.key === "placed")).toBe(true);
    expect((await agent.get(`/api/analytics/daily-brief?date=${DAY}`)).body.headline).toMatch(/^Wednesday: 2 orders/);
    expect((await agent.get("/api/analytics/anomalies?date=2999-01-01")).status).toBe(400);
  });
});
