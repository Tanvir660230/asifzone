import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { RUN, asOwner, cleanupFixtures, createStockedProduct } from "../../test-fixtures";
import { syncFlashSaleActivation } from "./flash-sale.service";
import { loadFlashOffers } from "../../domain/pricing/pricing.service";
import { isOfferLive } from "@clothing-brand/shared";

// TARGET_ARCHITECTURE §16a — the admin's switch (`enabled`) is separate from the schedule window, and the
// scheduler only ever derives `isActive` from both. Before Phase 1 the admin API dropped `isActive` (it wasn't in
// the schema) and the scheduler switched on every sale inside its window, so a running sale couldn't be stopped.

const MIN = 60_000;
let productId: string;
const saleIds: string[] = [];

async function createSale(body: Record<string, unknown>) {
  const res = await (await asOwner()).post("/api/flash-sales", { name: `Vitest P1 Flash ${RUN}`, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  saleIds.push(res.body.flashSale.id);
  await (await asOwner()).post(`/api/flash-sales/${res.body.flashSale.id}/items`, { productId, discountType: "PERCENTAGE", discountValue: 20 });
  return res.body.flashSale as { id: string; isActive: boolean; enabled: boolean };
}
async function patch(id: string, body: Record<string, unknown>) {
  return (await asOwner()).patch(`/api/flash-sales/${id}`, body);
}
async function state(id: string) {
  const s = await prisma.flashSale.findUniqueOrThrow({ where: { id } });
  return { enabled: s.enabled, isActive: s.isActive };
}
async function pricedLive() {
  // What the pricing engine would apply right now (the same loader every quote uses).
  const now = new Date();
  return ((await loadFlashOffers([productId], now)).get(productId) ?? []).some((o) => isOfferLive(o, now));
}

beforeAll(async () => {
  productId = (await createStockedProduct({ stocks: [5] })).product.id;
});
afterAll(async () => {
  await prisma.flashSale.deleteMany({ where: { id: { in: saleIds } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("flash sale lifecycle: schedule window vs admin switch", () => {
  it("manual activation inside the window is live immediately (no scheduler lag)", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() - MIN), endsAt: new Date(Date.now() + 60 * MIN) });
    expect(sale).toMatchObject({ enabled: true, isActive: true });
    expect(await pricedLive()).toBe(true);
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });

  it("manual disable stops a running sale, and the scheduler never turns it back on", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() - MIN), endsAt: new Date(Date.now() + 60 * MIN) });
    const res = await patch(sale.id, { enabled: false });
    expect(res.status).toBe(200);
    expect(await state(sale.id)).toEqual({ enabled: false, isActive: false });
    expect(await pricedLive()).toBe(false);

    await syncFlashSaleActivation();
    await syncFlashSaleActivation();
    expect(await state(sale.id)).toEqual({ enabled: false, isActive: false });
    expect(await pricedLive()).toBe(false);

    // Restart after a manual disable: only an admin can.
    await patch(sale.id, { enabled: true });
    expect(await state(sale.id)).toEqual({ enabled: true, isActive: true });
    expect(await pricedLive()).toBe(true);
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });

  it("the deprecated isActive field from an older admin client maps onto the switch", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() - MIN), endsAt: new Date(Date.now() + 60 * MIN) });
    await patch(sale.id, { isActive: false });
    expect(await state(sale.id)).toEqual({ enabled: false, isActive: false });
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });

  it("scheduled activation: an enabled future sale is not live until its window opens, then the scheduler marks it live", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() + 30 * MIN), endsAt: new Date(Date.now() + 90 * MIN) });
    expect(await state(sale.id)).toEqual({ enabled: true, isActive: false });
    expect(await pricedLive()).toBe(false);
    // The window opens (simulated by moving it — the scheduler reads the clock, so this is what "time passing" looks like).
    await prisma.flashSale.update({ where: { id: sale.id }, data: { startsAt: new Date(Date.now() - MIN) } });
    expect(await pricedLive()).toBe(true); // pricing reads enabled + window directly
    await syncFlashSaleActivation();
    expect(await state(sale.id)).toEqual({ enabled: true, isActive: true });
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });

  it("a sale disabled before its window opens stays off when the window opens", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() + 30 * MIN), endsAt: new Date(Date.now() + 90 * MIN), enabled: false });
    await prisma.flashSale.update({ where: { id: sale.id }, data: { startsAt: new Date(Date.now() - MIN) } });
    await syncFlashSaleActivation();
    expect(await state(sale.id)).toEqual({ enabled: false, isActive: false });
    expect(await pricedLive()).toBe(false);
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });

  it("expired: an enabled sale past endsAt is not live; editing endsAt into the future reactivates it", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() - 60 * MIN), endsAt: new Date(Date.now() + 30 * MIN) });
    await prisma.flashSale.update({ where: { id: sale.id }, data: { endsAt: new Date(Date.now() - MIN) } });
    expect(await pricedLive()).toBe(false);
    await syncFlashSaleActivation();
    expect(await state(sale.id)).toEqual({ enabled: true, isActive: false });

    const res = await patch(sale.id, { endsAt: new Date(Date.now() + 30 * MIN) });
    expect(res.status).toBe(200);
    expect(await state(sale.id)).toEqual({ enabled: true, isActive: true });
    expect(await pricedLive()).toBe(true);
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });

  it("editing the window recomputes the live state on save and refuses an end before the start", async () => {
    const sale = await createSale({ startsAt: new Date(Date.now() - MIN), endsAt: new Date(Date.now() + 60 * MIN) });
    await patch(sale.id, { startsAt: new Date(Date.now() + 10 * MIN) });
    expect(await state(sale.id)).toEqual({ enabled: true, isActive: false });
    const bad = await patch(sale.id, { endsAt: new Date(Date.now() + 5 * MIN) });
    expect(bad.status).toBe(400);
    await prisma.flashSale.delete({ where: { id: sale.id } });
  });
});
