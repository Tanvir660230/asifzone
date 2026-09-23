import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";

/** The admin-only "sold in the last 7 days" figure shown on the storefront product page. */
const RUN = Date.now();
const CSRF = "vitest-csrf";
let ownerId: string;
let staffId: string;
let categoryId: string;
let productId: string;
let variants: { id: string; sku: string; size: string }[] = [];
const orderIds: string[] = [];

function as(role: "OWNER" | "STAFF" | null) {
  const cookie = role ? [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`] : [`csrf_token=${CSRF}`];
  return { get: (url: string) => request(app).get(url).set("Cookie", cookie).set("X-CSRF-Token", CSRF) };
}

let n = 0;
async function order(status: "PENDING" | "DELIVERED" | "CANCELLED" | "REFUNDED" | "SHIPPED", daysAgo: number, items: { variant: number; quantity: number }[]) {
  n += 1;
  const created = await prisma.order.create({
    data: {
      orderNumber: `VT-SALES-${RUN}-${n}`, status, paymentMethod: "COD", customerName: "Vitest", customerPhone: "01700000000",
      shippingDivision: "Dhaka", shippingDistrict: "Dhaka", shippingArea: "Dhanmondi", shippingAddressLine: "1",
      subtotal: 100, total: 100, createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      items: {
        create: items.map((i) => {
          const v = variants[i.variant]!;
          return { variantId: v.id, productNameSnapshot: "Vitest Sales", skuSnapshot: v.sku, sizeSnapshot: v.size, colorSnapshot: "Black", priceSnapshot: 100, quantity: i.quantity };
        }),
      },
    },
  });
  orderIds.push(created.id);
}

describe("GET /api/products/:id/sales-summary", () => {
  beforeAll(async () => {
    const [o, s, c] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_sales_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_sales_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Sales Cat ${RUN}`, slug: `vitest-sales-cat-${RUN}` } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    const clothing = await prisma.productTypeDef.findUniqueOrThrow({ where: { key: "CLOTHING" } });
    const p = await prisma.product.create({
      data: {
        name: `Vitest Sales ${RUN}`, slug: `vitest-sales-${RUN}`, categoryId, typeId: clothing.id, productType: "CLOTHING", basePrice: 100,
        variants: { create: [{ sku: `VT-SALES-${RUN}-M`, size: "M", color: "Black", stock: 50 }, { sku: `VT-SALES-${RUN}-L`, size: "L", color: "Black", stock: 50 }] },
      },
      include: { variants: { orderBy: { sortOrder: "asc" } } },
    });
    productId = p.id;
    variants = p.variants.sort((a, b) => a.sku.localeCompare(b.sku)).map((v) => ({ id: v.id, sku: v.sku, size: v.size }));
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  it("is zero for a product nobody bought", async () => {
    const res = await as("OWNER").get(`/api/products/${productId}/sales-summary`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ productId, days: 7, unitsSold: 0, orders: 0, byVariant: [] });
  });

  it("counts units and orders from the last 7 days, and only sales", async () => {
    await order("PENDING", 1, [{ variant: 0, quantity: 2 }]); // counts (placed, not yet delivered)
    await order("DELIVERED", 3, [{ variant: 0, quantity: 1 }, { variant: 1, quantity: 4 }]); // counts, two lines in one order
    await order("SHIPPED", 6.5, [{ variant: 1, quantity: 1 }]); // counts: inside the window
    await order("CANCELLED", 1, [{ variant: 0, quantity: 10 }]); // not a sale
    await order("REFUNDED", 2, [{ variant: 1, quantity: 10 }]); // not a sale
    await order("DELIVERED", 8, [{ variant: 0, quantity: 10 }]); // too old

    const res = await as("STAFF").get(`/api/products/${productId}/sales-summary`); // any admin, not only the owner
    expect(res.status).toBe(200);
    expect(res.body.unitsSold).toBe(2 + 1 + 4 + 1);
    expect(res.body.orders).toBe(3);
    // Per variant, biggest first, from what the order recorded at the time.
    expect(res.body.byVariant.map((v: { sku: string; units: number }) => [v.sku, v.units])).toEqual([
      [variants[1]!.sku, 5],
      [variants[0]!.sku, 3],
    ]);
    expect(new Date(res.body.since).getTime()).toBeLessThan(Date.now() - 6.9 * 24 * 60 * 60 * 1000);
  });

  it("agrees with the figure customers are shown (same rule)", async () => {
    const publicSignals = await request(app).get(`/api/products/${productId}/urgency-signals`);
    const admin = await as("OWNER").get(`/api/products/${productId}/sales-summary`);
    expect(publicSignals.status).toBe(200);
    expect(publicSignals.body.unitsSoldLast7Days).toBe(admin.body.unitsSold);
  });

  it("is admin-only: no session is refused, and an unknown product is a 404", async () => {
    expect((await as(null).get(`/api/products/${productId}/sales-summary`)).status).toBe(401);
    expect((await request(app).get(`/api/products/${productId}/sales-summary`)).status).toBe(401);
    expect((await as("OWNER").get("/api/products/does-not-exist/sales-summary")).status).toBe(404);
  });
});
