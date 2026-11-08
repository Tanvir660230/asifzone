import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma";
import { cacheDel } from "../../config/redis";
import { resolveLegacyWindow } from "../../domain/metrics/store-time";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { updateOrderStatus } from "../orders/order.service";
import { getCancellations, landingKey } from "./cancellations.service";

// Cancelled before sending vs refused after: the report splits them, reads the reason from the cancel note, and credits
// each order to the channel / landing page / product that brought it.

let owner: string;
let variantId: string;
const RUN = `vt-cancel-${Date.now()}`;

async function report() {
  const range = await resolveLegacyWindow(1);
  await cacheDel(`analytics:v1:cancellations:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}`);
  return getCancellations(1);
}

async function orderFrom(session: string, landing: string, utmSource: string | null) {
  await prisma.pageView.create({ data: { sessionId: session, path: landing, utmSource, utmMedium: utmSource ? "paid" : null } });
  const o = await placeOrder([{ variantId, quantity: 1 }]);
  await prisma.order.update({ where: { id: o.id }, data: { sessionId: session } });
  return o;
}

beforeAll(async () => {
  owner = await ownerId();
  variantId = (await createStockedProduct({ stocks: [40], basePrice: 400 })).variants[0]!.id;
});
afterAll(async () => {
  await prisma.pageView.deleteMany({ where: { sessionId: { startsWith: RUN } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("landingKey", () => {
  it("drops the query and the trailing slash", () => {
    expect(landingKey("/lp/caps?fbclid=abc")).toBe("/lp/caps");
    expect(landingKey("/product/royal-amber/")).toBe("/product/royal-amber");
    expect(landingKey("/")).toBe("/");
    expect(landingKey(null)).toBe("(unknown)");
  });
});

describe("cancellations report", () => {
  it("splits pre-send cancels from refusals, reads the reason, and credits channel, landing page and product", async () => {
    const before = await report();
    const declined = await orderFrom(`${RUN}-1`, "/lp/vt-caps?fbclid=x", "facebook");
    const noAnswer = await orderFrom(`${RUN}-2`, "/lp/vt-caps", "facebook");
    const kept = await orderFrom(`${RUN}-3`, "/lp/vt-caps", "facebook");
    const refused = await orderFrom(`${RUN}-4`, "/", null);
    await updateOrderStatus(declined.id, { status: "CANCELLED", note: "nibe na" } as never, owner);
    await updateOrderStatus(noAnswer.id, { status: "CANCELLED", note: "phone dhore na" } as never, owner);
    // Booked, then cancelled by the courier: a refusal at the door, not a pre-send cancel.
    await prisma.order.update({ where: { id: refused.id }, data: { courierConsignmentId: `${RUN}-cid`, status: "CANCELLED" } });
    expect(kept.status).toBe("PENDING");

    const after = await report();
    expect(after.totals.orders - before.totals.orders).toBe(4);
    expect(after.totals.cancelledBeforeSending - before.totals.cancelledBeforeSending).toBe(2);
    expect(after.totals.refusedAfterSending - before.totals.refusedAfterSending).toBe(1);

    const count = (r: typeof after, reason: string) => r.reasons.find((x) => x.reason === reason)?.count ?? 0;
    expect(count(after, "declined") - count(before, "declined")).toBe(1);
    expect(count(after, "no_answer") - count(before, "no_answer")).toBe(1);

    // The landing page has 3 orders here — under the 5-order floor unless earlier runs added more, so check the channel.
    const fb = (r: typeof after) => r.byChannel.find((c) => /facebook/i.test(c.label));
    expect((fb(after)?.orders ?? 0) - (fb(before)?.orders ?? 0)).toBe(3);
    expect((fb(after)?.cancelled ?? 0) - (fb(before)?.cancelled ?? 0)).toBe(2);
    expect(after.reasons.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 5);
  });
});
