import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { productListQuerySchema } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct } from "../../test-fixtures";
import { listProducts } from "./product.service";

// Blueprint V2 P4: the admin product list carries stock state + completeness, and filters / sorts by them.

let outId: string;
let lowId: string;
let inId: string;

beforeAll(async () => {
  const out = await createStockedProduct({ stocks: [0, 0], basePrice: 500 });
  const low = await createStockedProduct({ stocks: [2, 40], basePrice: 900 });
  const plenty = await createStockedProduct({ stocks: [40], basePrice: 100 });
  outId = out.product.id;
  lowId = low.product.id;
  inId = plenty.product.id;
  await prisma.product.update({ where: { id: lowId }, data: { lowStockThreshold: 5 } });
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

const q = (extra: Record<string, unknown>) => productListQuerySchema.parse({ page: 1, pageSize: 100, ...extra });

describe("admin product list (P4)", () => {
  it("rolls stock up to a state per product and reports completeness", async () => {
    const { items } = await listProducts(q({}));
    const byId = new Map(items.map((p) => [p.id, p]));
    expect(byId.get(outId)).toMatchObject({ stockState: "OUT_OF_STOCK", totalStock: 0 });
    expect(byId.get(lowId)).toMatchObject({ stockState: "LOW_STOCK", totalStock: 42 });
    expect(byId.get(inId)).toMatchObject({ stockState: "IN_STOCK", totalStock: 40 });
    const c = byId.get(inId)!.completeness!;
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(c.missing)).toBe(true);
  });

  it("filters out-of-stock and running-low products", async () => {
    const out = (await listProducts(q({ stock: "out" }))).items.map((p) => p.id);
    expect(out).toContain(outId);
    expect(out).not.toContain(lowId);
    const low = (await listProducts(q({ stock: "low" }))).items.map((p) => p.id);
    expect(low).toContain(lowId);
    expect(low).not.toContain(outId);
    expect(low).not.toContain(inId);
  });

  it("sorts by price", async () => {
    const ids = [outId, lowId, inId];
    const asc = (await listProducts(q({ sort: "price" }))).items.filter((p) => ids.includes(p.id)).map((p) => p.id);
    expect(asc).toEqual([inId, outId, lowId]);
    const desc = (await listProducts(q({ sort: "-price" }))).items.filter((p) => ids.includes(p.id)).map((p) => p.id);
    expect(desc).toEqual([lowId, outId, inId]);
  });
});
