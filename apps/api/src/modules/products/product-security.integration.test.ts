import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";

/** Authorization, mass-assignment and data-exposure checks for the product and catalog APIs. */
const RUN = Date.now();
const CSRF = "vitest-csrf";
let ownerId: string;
let staffId: string;
let categoryId: string;
let typeId: string;

function as(role: "OWNER" | "STAFF" | null) {
  const cookie = role ? [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`] : [`csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
    put: (url: string, body: object) => auth(request(app).put(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}

/** Every `router.<method>("<path>", …)` call in a routes file, with the source text of its arguments. */
function routesOf(file: string, routerName: string) {
  const src = fs.readFileSync(path.join(__dirname, file), "utf-8");
  const re = new RegExp(`${routerName}\\.(get|post|put|patch|delete)\\(\\s*"([^"]+)"([\\s\\S]*?)\\);`, "g");
  return [...src.matchAll(re)].map((m) => ({ method: m[1]!.toUpperCase(), path: m[2]!, args: m[3]! }));
}

/** The storefront's own reads and the view counter: the only product routes that are meant to be public. */
const PUBLIC_PRODUCT_ROUTES = new Set([
  "GET /storefront", "GET /storefront/facets", "GET /storefront/by-ids", "GET /storefront/trending", "GET /storefront/recommended",
  "GET /storefront/suggest", "GET /storefront/popular-searches", "GET /slug/:slug", "GET /:id/similar", "GET /:id/rail/:key",
  "GET /:id/frequently-bought-together", "GET /:id/complete-your-look", "GET /:id/budget-alternatives", "GET /:id/upgrade-options",
  "GET /:id/premium-alternatives", "GET /:id/urgency-signals", "POST /:id/view",
]);

describe("product and catalog API security", () => {
  beforeAll(async () => {
    const [o, s, c, clothing] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_sec_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_sec_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Sec Cat ${RUN}`, slug: `vitest-sec-cat-${RUN}` } }),
      prisma.productTypeDef.findUniqueOrThrow({ where: { key: "CLOTHING" } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    typeId = clothing.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("no admin route is public by accident", () => {
    it("every product route except the storefront's own reads requires an admin session", () => {
      const routes = routesOf("product.routes.ts", "productRouter");
      expect(routes.length).toBeGreaterThan(30);
      const open = routes.filter((r) => !r.args.includes("requireAdmin")).map((r) => `${r.method} ${r.path}`);
      expect(open.filter((r) => !PUBLIC_PRODUCT_ROUTES.has(r)), "routes without requireAdmin that are not on the public list").toEqual([]);
      // …and the public list is real: nothing on it went missing (a renamed route would silently drop out of this guard).
      for (const r of PUBLIC_PRODUCT_ROUTES) expect(routes.map((x) => `${x.method} ${x.path}`), r).toContain(r);
    });

    it("every catalog write is owner-only, apart from generating a SKU", () => {
      const routes = routesOf("../catalog/catalog.routes.ts", "catalogRouter");
      const writes = routes.filter((r) => r.method !== "GET");
      expect(writes.length).toBeGreaterThan(15);
      const staffWritable = writes.filter((r) => !/ownerOnly|requireRole\("OWNER"\)/.test(r.args)).map((r) => `${r.method} ${r.path}`);
      expect(staffWritable).toEqual(["POST /sku/generate"]);
      // The whole router sits behind an admin session.
      expect(fs.readFileSync(path.join(__dirname, "../catalog/catalog.routes.ts"), "utf-8")).toMatch(/catalogRouter\.use\(requireAdmin\)/);
    });

    it("answers 401 without a session on a sample of admin reads and writes", async () => {
      const anon = as(null);
      const p = await prisma.product.create({ data: { name: `Vitest Sec ${RUN}`, slug: `vitest-sec-anon-${RUN}`, categoryId, basePrice: 10, typeId, productType: "CLOTHING" } });
      const cases: [string, string][] = [
        ["get", "/api/products"], ["get", `/api/products/${p.id}`], ["get", `/api/products/${p.id}/preview`], ["get", `/api/products/${p.id}/history`],
        ["get", "/api/products/export/full"], ["get", "/api/products/export/csv"], ["get", "/api/products/import/template"],
        ["post", "/api/products"], ["post", `/api/products/${p.id}/duplicate`], ["post", "/api/products/import/validate"], ["post", "/api/products/import/commit"],
        ["patch", `/api/products/${p.id}`], ["delete", `/api/products/${p.id}`], ["delete", `/api/products/${p.id}/permanent`],
        ["post", "/api/products/bulk/status"], ["get", "/api/catalog/types"], ["post", "/api/catalog/types"], ["put", "/api/catalog/sections"],
      ];
      for (const [method, url] of cases) {
        const res = await (anon as never as Record<string, (u: string, b?: object) => request.Test>)[method]!(url, {});
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(401);
      }
      expect(await prisma.product.findUnique({ where: { id: p.id } })).not.toBeNull(); // the unauthenticated delete did nothing
    });
  });

  describe("staff can edit products but not reshape the catalog or destroy data", () => {
    it("is refused on import, permanent delete and every catalog write, and allowed to create, edit, duplicate and generate SKUs", async () => {
      const staff = as("STAFF");
      const created = await staff.post("/api/products", { name: `Vitest Sec Staff ${RUN}`, categoryId, typeId, basePrice: 100, variants: [{ sku: `VT-SEC-${RUN}-1`, size: "M", color: "Black", stock: 1 }] });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.product.id as string;
      expect((await staff.patch(`/api/products/${id}`, { basePrice: 120 })).status).toBe(200);
      expect((await staff.post(`/api/products/${id}/duplicate`)).status).toBe(201);
      expect((await staff.post("/api/catalog/sku/generate", { typeId })).status).toBe(200);

      for (const [method, url, body] of [
        ["post", "/api/products/import/validate", { csv: "slug,variant_sku\nx,y\n" }], ["post", "/api/products/import/commit", { csv: "slug,variant_sku\nx,y\n" }],
        ["delete", `/api/products/${id}/permanent`, {}], ["post", "/api/catalog/types", { name: "Nope", templateId: "x" }],
        ["post", "/api/catalog/attributes", { key: "nopeAttr", label: "Nope", dataType: "TEXT" }], ["put", "/api/catalog/sections", { overrides: [] }],
        ["post", "/api/catalog/care-guides", { name: "Nope", steps: ["x"] }], ["post", "/api/catalog/materials", { name: "Nope" }],
      ] as const) {
        const res = await (staff as never as Record<string, (u: string, b: object) => request.Test>)[method]!(url, body);
        expect(res.status, `${method.toUpperCase()} ${url} as staff`).toBe(403);
      }
    });
  });

  describe("mass assignment", () => {
    it("ignores fields a client isn't meant to set (rating, counters, timestamps, ids, trash flag, internal status columns)", async () => {
      const owner = as("OWNER");
      const evil = { avgRating: 5, reviewCount: 9999, deletedAt: new Date().toISOString(), createdAt: "2001-01-01T00:00:00Z", id: "hijacked", viewCount: 1234, isActive: undefined };
      const created = await owner.post("/api/products", {
        name: `Vitest Sec Mass ${RUN}`, categoryId, typeId, basePrice: 100, ...evil,
        variants: [{ sku: `VT-SEC-${RUN}-M`, size: "M", color: "Black", stock: 1, id: "clientsetid", productId: "other", createdAt: "2001-01-01T00:00:00Z" }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const p = created.body.product;
      expect(p.id).not.toBe("hijacked");
      expect(p.deletedAt).toBeNull();
      expect(p.reviewCount).toBe(0);
      expect(Number(p.avgRating)).toBe(0);
      expect(new Date(p.createdAt).getFullYear()).toBeGreaterThan(2020);
      expect(p.variants[0].id).not.toBe("clientsetid");

      const patched = await owner.patch(`/api/products/${p.id}`, { avgRating: 1, reviewCount: 5, deletedAt: new Date().toISOString(), slug: undefined });
      expect(patched.status).toBe(200);
      expect(patched.body.product.deletedAt).toBeNull();
      expect(patched.body.product.reviewCount).toBe(0);
      // Status can only change through the gated field, never by sending the columns behind it.
      const sneaky = await owner.patch(`/api/products/${p.id}`, { isActive: true, status: "DRAFT" });
      expect(sneaky.body.product.status).toBe("DRAFT");
    });
  });

  describe("what customers can see", () => {
    it("the public product reads carry no cost, tax, completeness, admin-only content or drafts", async () => {
      const owner = as("OWNER");
      const created = await owner.post("/api/products", {
        name: `Vitest Sec Public ${RUN}`, categoryId, typeId, basePrice: 500, costPrice: 200, taxRate: 5,
        seoTitle: "Public SEO", focusKeyword: "internal keyword", faqs: [{ question: "Q?", answer: "A" }],
        variants: [{ sku: `VT-SEC-${RUN}-P`, size: "M", color: "Black", stock: 3, costPrice: 150 }],
      });
      const p = created.body.product as { id: string; slug: string };
      // A draft is invisible.
      expect((await request(app).get(`/api/products/slug/${p.slug}`)).status).toBe(404);
      expect((await request(app).get(`/api/products/${p.id}/preview`)).status).toBe(401);
      expect((await request(app).get(`/api/products/${p.id}/rail/related`)).status).toBe(200); // a rail of other products; no data about this one

      await prisma.productImage.create({ data: { productId: p.id, url: `http://localhost:4000/uploads/products/vt-${RUN}-full.webp`, altText: "x" } });
      expect((await owner.patch(`/api/products/${p.id}`, { status: "PUBLISHED" })).status).toBe(200);

      const pub = (await request(app).get(`/api/products/slug/${p.slug}`)).body.product;
      const text = JSON.stringify(pub);
      for (const secret of ["costPrice", "taxRate", "completeness", "sectionOverrides", "focusKeyword", "internal keyword", "careOverride\":[\"__"]) {
        expect(text, `public response leaks ${secret}`).not.toContain(secret);
      }
      expect(pub.variants[0]).not.toHaveProperty("costPrice");
      expect(pub).not.toHaveProperty("relations");
      expect(pub.resolved.faqs).toEqual([{ question: "Q?", answer: "A" }]); // what the page needs, and nothing more

      const list = (await request(app).get("/api/products/storefront?pageSize=50")).body;
      const listed = JSON.stringify(list.items);
      expect(listed).not.toContain("costPrice");
      expect(listed).not.toContain("taxRate");
    });

    /** Other public / customer-facing reads that return products must not leak the shop's margin either. */
    describe("the other places a product reaches a customer", () => {
      const made = { flashSaleId: "", customerEmail: `vt_sec_customer_${RUN}@example.com` };
      afterAll(async () => {
        if (made.flashSaleId) await prisma.flashSale.deleteMany({ where: { id: made.flashSaleId } });
        await prisma.customer.deleteMany({ where: { email: made.customerEmail } });
      });

      async function productWithCost() {
        const created = await as("OWNER").post("/api/products", {
          name: `Vitest Sec Cost ${RUN} ${Math.random().toString(36).slice(2, 6)}`, categoryId, typeId, basePrice: 500, costPrice: 211, taxRate: 7,
          variants: [{ sku: `VT-SEC-${RUN}-C${Math.random().toString(36).slice(2, 6)}`, size: "M", color: "Black", stock: 3, costPrice: 133 }],
        });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        return created.body.product as { id: string };
      }

      it("a customer's wishlist shows the storefront view of a product, without cost or tax", async () => {
        const p = await productWithCost();
        const register = await request(app).post("/api/customers/register").send({ name: "Vitest Sec Customer", email: made.customerEmail, password: "SomePass123" });
        const cookies = register.get("Set-Cookie")!;
        const csrf = cookies.find((c) => c.startsWith("csrf_token="))!.split(";")[0]!.split("=")[1]!;
        expect((await request(app).post("/api/wishlist").set("Cookie", cookies).set("X-CSRF-Token", csrf).send({ productId: p.id })).status).toBe(201);

        const list = await request(app).get("/api/wishlist").set("Cookie", cookies);
        const item = list.body.items.find((i: { product: { id: string } }) => i.product.id === p.id);
        expect(item, "the wishlisted product is listed").toBeTruthy();
        const text = JSON.stringify(item.product);
        expect(text).not.toContain("costPrice");
        expect(text).not.toContain("taxRate");
        // …and it still has what the wishlist page renders.
        expect(item.product).toMatchObject({ name: expect.any(String), slug: expect.any(String) });
        expect(item.product.variants[0]).toMatchObject({ sku: expect.any(String), stock: 3, size: "M" });
        expect(item.product.images).toBeInstanceOf(Array);
      });

      it("the anonymous flash-sale feed carries no cost either", async () => {
        const p = await productWithCost();
        const sale = await prisma.flashSale.create({
          data: {
            name: `Vitest Sec Sale ${RUN}`, isActive: true, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 5 * 60_000),
            items: { create: { productId: p.id, discountType: "PERCENTAGE", discountValue: 10 } },
          },
        });
        made.flashSaleId = sale.id;
        const feed = await request(app).get("/api/flash-sales/active");
        expect(feed.status).toBe(200);
        const mine = JSON.stringify(feed.body).includes(p.id);
        expect(mine, "the test sale is the active one (another real sale may end sooner)").toBe(true);
        expect(JSON.stringify(feed.body)).not.toContain("costPrice");
        expect(JSON.stringify(feed.body)).not.toContain("taxRate");
      });
    });
  });
});
