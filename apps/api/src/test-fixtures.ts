import request from "supertest";
import type { CheckoutInput, OrderStatus } from "@clothing-brand/shared";
import { app } from "./app";
import { prisma } from "./config/prisma";
import { signAccessToken } from "./lib/jwt";
import { recordInitialStock } from "./modules/inventory/inventory.service";
import { createOrder } from "./modules/orders/order.service";

/** Shared setup for the Phase 1 correctness suites (order state machine, inventory, deleted products, flash
 * sales). Every row is created here with a per-run suffix and removed by `cleanupFixtures`, and stock is opened
 * through the inventory service so the ledger is complete from the first unit (INV-1 holds from the start). */

export const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const CSRF = "vitest-csrf";

const made = { productIds: [] as string[], orderIds: [] as string[] };

let ownerIdCache: string | null = null;
export async function ownerId(): Promise<string> {
  if (!ownerIdCache) {
    const owner = await prisma.adminUser.findFirst({ where: { role: "OWNER", isActive: true } });
    if (!owner) throw new Error("Seed an OWNER admin before running these tests");
    ownerIdCache = owner.id;
  }
  return ownerIdCache;
}

export async function asOwner() {
  const id = await ownerId();
  const cookie = [`access_token=${signAccessToken({ adminId: id, role: "OWNER" })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}

let seq = 0;
/** A published product with one variant per entry of `stocks`, each opened with that much stock via the ledger. */
export async function createStockedProduct(opts: { stocks?: number[]; basePrice?: number; variantPrices?: Array<number | null>; published?: boolean } = {}) {
  const category = await prisma.category.findFirst({ where: { deletedAt: null } });
  if (!category) throw new Error("Seed at least one category before running these tests");
  const n = ++seq;
  const stocks = opts.stocks ?? [10];
  const published = opts.published ?? true;
  const product = await prisma.product.create({
    data: {
      name: `Vitest P1 ${RUN} ${n}`,
      slug: `vitest-p1-${RUN}-${n}`,
      categoryId: category.id,
      basePrice: opts.basePrice ?? 500,
      status: published ? "PUBLISHED" : "DRAFT",
      isActive: published,
      variants: {
        create: stocks.map((_, i) => ({ sku: `VT-P1-${RUN}-${n}-${i}`, size: ["M", "L", "XL", "S"][i] ?? `X${i}`, color: "Black", stock: 0, price: opts.variantPrices?.[i] ?? null })),
      },
    },
    include: { variants: { orderBy: { sku: "asc" } } },
  });
  made.productIds.push(product.id);
  await prisma.$transaction(async (tx) => {
    for (const [i, v] of product.variants.entries()) await recordInitialStock(tx, v.id, stocks[i] ?? 0, "RESTOCK", { note: "test opening stock" });
  });
  return { product, variants: product.variants, categoryId: category.id };
}

export function checkout(items: Array<{ variantId: string; quantity: number }>, overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    items,
    customerName: "Vitest Phase1",
    customerPhone: "01712345678",
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    shippingArea: "Uttara",
    shippingAddressLine: "House 1, Road 2",
    paymentMethod: "COD",
    ...overrides,
  } as CheckoutInput;
}

export async function placeOrder(items: Array<{ variantId: string; quantity: number }>, overrides: Partial<CheckoutInput> = {}) {
  const order = await createOrder(checkout(items, overrides));
  made.orderIds.push(order.id);
  return order;
}

export function trackOrder(id: string) {
  made.orderIds.push(id);
}

export async function stockOf(variantId: string): Promise<number> {
  return (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stock: true } })).stock;
}

export async function ledgerSum(variantId: string): Promise<number> {
  const agg = await prisma.stockMovement.aggregate({ where: { variantId }, _sum: { change: true } });
  return agg._sum.change ?? 0;
}

/** INV-1 and INV-3 for one variant / its orders: stock = Σ ledger, and each order line's movements = −qty + restocked. */
export async function assertInventoryInvariants(variantId: string) {
  const [stock, ledger] = await Promise.all([stockOf(variantId), ledgerSum(variantId)]);
  if (stock !== ledger) throw new Error(`INV-1 broken for ${variantId}: stock ${stock} ≠ ledger ${ledger}`);
  const lines = await prisma.orderItem.findMany({ where: { variantId } });
  for (const line of lines) {
    if (line.restockedQuantity < 0 || line.restockedQuantity > line.quantity) throw new Error(`INV-2 broken on line ${line.id}`);
    if (line.returnedQuantity < 0 || line.returnedQuantity > line.quantity) throw new Error(`INV-2 broken on line ${line.id}`);
    const agg = await prisma.stockMovement.aggregate({ where: { variantId, orderId: line.orderId }, _sum: { change: true } });
    const net = agg._sum.change ?? 0;
    if (net !== -line.quantity + line.restockedQuantity) {
      throw new Error(`INV-3 broken on order ${line.orderId}: movements ${net} ≠ −${line.quantity} + ${line.restockedQuantity}`);
    }
  }
  return stock;
}

export async function historyStatuses(orderId: string): Promise<OrderStatus[]> {
  const rows = await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => r.status);
}

export async function cleanupFixtures() {
  if (made.orderIds.length) {
    await prisma.returnRequest.deleteMany({ where: { OR: [{ orderId: { in: made.orderIds } }, { exchangeOrderId: { in: made.orderIds } }] } });
    await prisma.order.deleteMany({ where: { id: { in: made.orderIds } } });
  }
  if (made.productIds.length) {
    await prisma.flashSaleItem.deleteMany({ where: { productId: { in: made.productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: made.productIds } } });
  }
}
