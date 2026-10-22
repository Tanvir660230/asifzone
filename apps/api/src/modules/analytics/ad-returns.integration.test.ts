import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { getAdReturns, type FinanceCampaignSpend } from "./ad-returns.service";

// A fixed week long ago (Dhaka): two ad campaigns tagged in utm_campaign, one of them recorded in Finance with spend.
const at = (date: string, hh = "12") => new Date(`${date}T${hh}:00:00+06:00`);
const RUN = `vt-ads-${Date.now()}`;
const FROM = at("2011-05-02", "00");
const TO = at("2011-05-08", "12");
const CAMP_A = `${RUN}-120001`;
const CAMP_B = `${RUN}-120002`;
let n = 0;
let price = 0;

async function visit(i: number, campaign: string) {
  await prisma.pageView.create({ data: { sessionId: `${RUN}-${campaign}-${i}`, path: "/", utmCampaign: campaign, utmSource: "fb", utmMedium: "paid", createdAt: at("2011-05-03", "10") } });
}

async function order(session: string, delivered: boolean, variantId: string) {
  const o = await createManualOrder(
    {
      items: [{ variantId, quantity: 1 }],
      customerName: "Vitest Ads",
      customerPhone: `0133${String(++n).padStart(7, "0")}`,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Area",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    await ownerId(),
  );
  trackOrder(o.id);
  price = Number(o.total) - Number(o.shippingFee);
  await prisma.orderStatusHistory.deleteMany({ where: { orderId: o.id } });
  await prisma.orderStatusHistory.createMany({
    data: [{ orderId: o.id, status: "PENDING", createdAt: at("2011-05-03", "11") }, ...(delivered ? [{ orderId: o.id, status: "DELIVERED" as const, createdAt: at("2011-05-05", "12") }] : [])],
  });
  await prisma.order.update({ where: { id: o.id }, data: { createdAt: at("2011-05-03", "11"), sessionId: session, status: delivered ? "DELIVERED" : "PENDING" } });
}

beforeAll(async () => {
  const { variants } = await createStockedProduct({ stocks: [50], basePrice: 1000 });
  await prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { costPrice: 400 } });
  const v = variants[0]!.id;
  for (let i = 0; i < 50; i++) await visit(i, CAMP_A);
  for (let i = 0; i < 20; i++) await visit(i, CAMP_B);
  await order(`${RUN}-${CAMP_A}-0`, true, v);
  await order(`${RUN}-${CAMP_A}-1`, true, v);
  await order(`${RUN}-${CAMP_A}-2`, false, v); // still open
  await order(`${RUN}-${CAMP_B}-0`, true, v);
}, 60_000);

afterAll(async () => {
  await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: RUN } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

const finance = async (): Promise<FinanceCampaignSpend[]> => [
  { id: "fc1", name: "Eid Panjabi — conversions", externalId: CAMP_A, spend: 1500, plannedSpend: 0 },
  { id: "fc2", name: "Old campaign", externalId: "nobody-visited", spend: 300, plannedSpend: 300 },
];

describe("ad returns", () => {
  it("credits orders to their session's campaign and judges spend on what was actually delivered", async () => {
    const r = await getAdReturns(undefined, FROM, TO, { campaignSpend: finance });
    const a = r.campaigns.find((c) => c.financeCampaignId === "fc1")!;
    expect(a).toMatchObject({ name: "Eid Panjabi — conversions", sessions: 50, orders: 3, realisedOrders: 2, spend: 1500 });
    expect(a.netSales).toBeCloseTo(price * 2, 2); // the open order isn't a sale yet
    expect(a.grossMargin).toBeCloseTo((price - 400) * 2, 2);
    expect(a.roas).toBeCloseTo((price * 2) / 1500, 6);
    expect(a.profitAfterAds).toBeCloseTo((price - 400) * 2 - 1500, 2);
    expect(a.costPerRealisedOrder).toBe(750);

    const b = r.campaigns.find((c) => c.key === CAMP_B.toLowerCase())!;
    expect(b).toMatchObject({ sessions: 20, orders: 1, realisedOrders: 1, spend: null, roas: null });
    expect(r.unmatchedSpend).toEqual([{ name: "Old campaign", spend: 300 }]);
    expect(r.financeConnected).toBe(true);
  });

  it("without Finance campaigns it still reports what each campaign brought", async () => {
    const r = await getAdReturns(undefined, FROM, TO, { campaignSpend: async () => null });
    expect(r.financeConnected).toBe(false);
    expect(r.totals).toMatchObject({ spend: 0, roas: null, profitAfterAds: null });
    expect(r.campaigns.filter((c) => c.key.startsWith(RUN.toLowerCase())).map((c) => c.orders).sort()).toEqual([1, 3]);
  });

  it("is reachable over the API", async () => {
    const res = await (await asOwner()).get(`/api/analytics/ad-returns?dateFrom=${FROM.toISOString()}&dateTo=${TO.toISOString()}`);
    expect(res.status).toBe(200);
    expect(res.body.campaigns.some((c: { key: string }) => c.key === CAMP_A.toLowerCase())).toBe(true);
  });
});
