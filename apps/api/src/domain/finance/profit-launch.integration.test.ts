import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext } from "./finance-context";
import { launchReport } from "./profit.service";

// The weeks before the books started (Profit page): a store whose books open before its first order has no such weeks.
// The live store (books open 1 Jul, first order 15 Aug) used to get a 400 PERIOD_RANGE on every Profit page load.

let businessId: string;
let openingBefore: Date | null;

async function setOpeningDate(date: Date | null) {
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: businessId }, data: { openingDate: date } });
    await tx.financeAuditEntry.create({ data: { businessId, actorType: "SYSTEM", actorLabel: "test", action: "business.update", entityType: "FinanceBusiness", entityId: businessId } });
  });
}

beforeAll(async () => {
  const { business } = await getFinanceContext();
  businessId = business.id;
  openingBefore = business.openingDate ? new Date(`${business.openingDate}T00:00:00Z`) : null;
  const { variants } = await createStockedProduct({ stocks: [5] });
  await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
});

afterAll(async () => {
  await setOpeningDate(openingBefore);
  await cleanupFixtures();
});

describe("launchReport", () => {
  it("is empty, not an error, when the books open before the first order", async () => {
    const first = await prisma.order.findFirstOrThrow({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    await setOpeningDate(new Date(first.createdAt.getTime() - 30 * 86_400_000));

    const report = await launchReport({});
    expect(report.period).toBeNull();
    expect(report).toMatchObject({ orders: { delivered: 0, returned: 0 }, sales: 0, cogs: 0, courier: 0, ads: 0, contribution: 0, missingCost: [] });
  });

  it("still refuses a range the caller typed backwards", async () => {
    await expect(launchReport({ from: "2026-05-02", to: "2026-05-01" })).rejects.toMatchObject({ statusCode: 400 });
  });
});
