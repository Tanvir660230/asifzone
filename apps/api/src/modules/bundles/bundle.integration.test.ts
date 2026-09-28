import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { RUN, asOwner, cleanupFixtures, placeOrder } from "../../test-fixtures";
import { recordInitialStock } from "../inventory/inventory.service";
import { evaluateBundleForItems } from "./bundle.service";

// D2 (docs/PRICING_PIPELINE.md §2): a bundle discount works on the effective selling price after any flash sale —
// the same price the subtotal and the charged order lines use. It used to price lines at the regular price, so a
// 10% bundle on a flash-halved item discounted money the customer wasn't paying.

const made = { categoryIds: [] as string[], productIds: [] as string[], saleId: "", bundleId: "" };
let anchorVariant: string;
let suggestionVariant: string;
let suggestionProductId: string;

async function product(categoryId: string, price: number, label: string) {
  const p = await prisma.product.create({
    data: {
      name: `Vitest Bundle ${label} ${RUN}`,
      slug: `vitest-bundle-${label}-${RUN}`.toLowerCase(),
      categoryId,
      basePrice: price,
      status: "PUBLISHED",
      isActive: true,
      variants: { create: { sku: `VT-BND-${label}-${RUN}`, size: "M", color: "Black", stock: 0 } },
    },
    include: { variants: true },
  });
  made.productIds.push(p.id);
  await prisma.$transaction((tx) => recordInitialStock(tx, p.variants[0]!.id, 10, "RESTOCK"));
  return p;
}

beforeAll(async () => {
  const [anchorCat, suggestionCat] = await Promise.all(
    ["anchor", "suggest"].map((k) => prisma.category.create({ data: { name: `Vitest Bundle ${k} ${RUN}`, slug: `vitest-bundle-${k}-${RUN}` } })),
  );
  made.categoryIds.push(anchorCat!.id, suggestionCat!.id);
  const anchor = await product(anchorCat!.id, 1000, "A");
  const suggestion = await product(suggestionCat!.id, 500, "B");
  anchorVariant = anchor.variants[0]!.id;
  suggestionVariant = suggestion.variants[0]!.id;
  suggestionProductId = suggestion.id;

  const bundle = await prisma.bundle.create({
    data: {
      name: `Vitest Bundle ${RUN}`,
      anchorCategoryId: anchorCat!.id,
      discountType: "PERCENTAGE",
      discountValue: 10,
      minSuggestedCategories: 1,
      suggestions: { create: { categoryId: suggestionCat!.id } },
    },
  });
  made.bundleId = bundle.id;
  const sale = await prisma.flashSale.create({
    data: {
      name: `Vitest Bundle Flash ${RUN}`,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3600_000),
      enabled: true,
      isActive: true,
      items: { create: { productId: anchor.id, discountType: "PERCENTAGE", discountValue: 50 } },
    },
  });
  made.saleId = sale.id;
});

afterAll(async () => {
  await prisma.flashSale.deleteMany({ where: { id: made.saleId } });
  await prisma.bundle.deleteMany({ where: { id: made.bundleId } });
  await cleanupFixtures();
  await prisma.product.deleteMany({ where: { id: { in: made.productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: made.categoryIds } } });
  await prisma.$disconnect();
});

describe("bundle discounts use the post-flash selling price (D2)", () => {
  it("10% of (flash 500 + 500), not of (regular 1000 + 500)", async () => {
    const match = await evaluateBundleForItems([
      { variantId: anchorVariant, quantity: 1 },
      { variantId: suggestionVariant, quantity: 1 },
    ]);
    expect(match?.discount).toBe(100); // old code: 150
  });

  it("the order's snapshot agrees: subtotal 1000, bundle discount 100, total 900 + shipping", async () => {
    const order = await placeOrder([
      { variantId: anchorVariant, quantity: 1 },
      { variantId: suggestionVariant, quantity: 1 },
    ]);
    expect(Number(order.subtotal)).toBe(1000);
    expect(Number(order.bundleDiscount)).toBe(100);
    expect(Number(order.total)).toBe(900 + Number(order.shippingFee));
  });

  it("a trashed product can't unlock the bundle", async () => {
    expect((await (await asOwner()).delete(`/api/products/${suggestionProductId}`)).status).toBeLessThan(300);
    const match = await evaluateBundleForItems([
      { variantId: anchorVariant, quantity: 1 },
      { variantId: suggestionVariant, quantity: 1 },
    ]);
    expect(match).toBeNull();
  });
});
