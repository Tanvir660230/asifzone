import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";

const RUN = Date.now();
const CSRF = "vitest-csrf";
let ownerId: string;
let staffId: string;
let categoryId: string;
let clothingTypeId: string;

function as(role: "OWNER" | "STAFF") {
  const cookie = [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
    put: (url: string, body: object) => auth(request(app).put(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}
const owner = () => as("OWNER");
const staff = () => as("STAFF");

const made = { products: [] as string[], templates: [] as string[], types: [] as string[], care: [] as string[], materials: [] as string[] };

let n = 0;
function body(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    name: `Vitest Workflow ${RUN} ${n}`,
    categoryId,
    basePrice: 500,
    typeId: clothingTypeId,
    attributes: {},
    variants: [{ sku: `VT-WF-${RUN}-${n}`, size: "M", color: "Black", stock: 4 }],
    ...over,
  };
}

async function createProduct(over: Record<string, unknown> = {}) {
  const res = await owner().post("/api/products", body(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  made.products.push(res.body.product.id);
  return res.body.product as { id: string; slug: string; status: string };
}

const addImage = (productId: string) =>
  prisma.productImage.create({ data: { productId, url: `http://localhost:4000/uploads/products/vt-${RUN}-${productId}-full.webp`, altText: "vitest" } });

describe("product workflow: status, completeness, SEO, care, materials, history", () => {
  beforeAll(async () => {
    const [o, s, c, clothing] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_wf_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_wf_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest WF Cat ${RUN}`, slug: `vitest-wf-cat-${RUN}` } }),
      prisma.productTypeDef.findUniqueOrThrow({ where: { key: "CLOTHING" } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    clothingTypeId = clothing.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { OR: [{ id: { in: made.products } }, { categoryId }] } });
    await prisma.productTypeDef.deleteMany({ where: { id: { in: made.types } } });
    await prisma.productTemplate.deleteMany({ where: { id: { in: made.templates } } });
    await prisma.careGuidePreset.deleteMany({ where: { id: { in: made.care } } });
    await prisma.material.deleteMany({ where: { id: { in: made.materials } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("status workflow and the publish gate", () => {
    let p: { id: string; slug: string };

    it("creates a draft that is not visible on the storefront", async () => {
      p = await createProduct();
      const admin = await owner().get(`/api/products/${p.id}`);
      expect(admin.body.product.status).toBe("DRAFT");
      expect(admin.body.product.isActive).toBe(false);
      expect((await request(app).get(`/api/products/slug/${p.slug}`)).status).toBe(404);
    });

    it("reports completeness with what is missing", async () => {
      const { completeness } = (await owner().get(`/api/products/${p.id}`)).body.product;
      const byKey = Object.fromEntries(completeness.checks.map((c: { key: string; status: string }) => [c.key, c.status]));
      expect(byKey).toMatchObject({ basics: "ok", pricing: "ok", variants: "ok", images: "missing", inventory: "ok" });
      expect(completeness.blockers.map((b: { key: string }) => b.key)).toEqual(["images"]);
      expect(completeness.score).toBeGreaterThan(0);
      expect(completeness.score).toBeLessThan(100);
    });

    it("refuses to mark ready or publish while a required check is missing — and changes nothing", async () => {
      for (const status of ["READY", "PUBLISHED"]) {
        const res = await owner().patch(`/api/products/${p.id}`, { status, basePrice: 999 });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain("Images");
      }
      // The refused save rolled back entirely, including the price edit that rode along with it.
      const after = (await owner().get(`/api/products/${p.id}`)).body.product;
      expect(after.status).toBe("DRAFT");
      expect(Number(after.basePrice)).toBe(500);
    });

    it("walks draft → ready → published → unpublished", async () => {
      await addImage(p.id);
      const ready = await owner().patch(`/api/products/${p.id}`, { status: "READY" });
      expect(ready.body.product).toMatchObject({ status: "READY", isActive: false });
      expect((await request(app).get(`/api/products/slug/${p.slug}`)).status).toBe(404); // ready is still not live

      const live = await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      expect(live.body.product).toMatchObject({ status: "PUBLISHED", isActive: true });
      expect((await request(app).get(`/api/products/slug/${p.slug}`)).status).toBe(200);

      const down = await owner().patch(`/api/products/${p.id}`, { status: "UNPUBLISHED" });
      expect(down.body.product).toMatchObject({ status: "UNPUBLISHED", isActive: false });
      expect((await request(app).get(`/api/products/slug/${p.slug}`)).status).toBe(404);
    });

    it("keeps isActive in step with status for stale clients that only send the old flag", async () => {
      expect((await owner().patch(`/api/products/${p.id}`, { isActive: true })).body.product.status).toBe("PUBLISHED");
      expect((await owner().patch(`/api/products/${p.id}`, { isActive: false })).body.product.status).toBe("UNPUBLISHED");
      const draft = await createProduct();
      // "isActive: false" must not turn a draft into "unpublished".
      expect((await owner().patch(`/api/products/${draft.id}`, { isActive: false })).body.product.status).toBe("DRAFT");
    });

    it("a partial update changes only what it sends: fields with defaults are not reset", async () => {
      const q = await createProduct({
        description: "<p>Keep me</p>",
        brandTier: "LUXURY",
        trackInventory: false,
        lowStockThreshold: 11,
        isFeatured: true,
        sortOrder: 7,
      });
      const res = await owner().patch(`/api/products/${q.id}`, { basePrice: 640 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.product).toMatchObject({
        description: "<p>Keep me</p>",
        brandTier: "LUXURY",
        trackInventory: false,
        lowStockThreshold: 11,
        isFeatured: true,
        sortOrder: 7,
      });
      expect(Number(res.body.product.basePrice)).toBe(640);
    });

    it("a variant listed without stock or option links keeps them (and an existing variant needn't repeat its SKU)", async () => {
      const attr = await prisma.attribute.create({ data: { name: `Vitest Option ${RUN}`, slug: `vitest-option-${RUN}` } });
      const value = await prisma.attributeValue.create({ data: { attributeId: attr.id, value: "Tall" } });
      try {
        const q = await createProduct({
          variants: [
            { sku: `VT-KEEP-${RUN}-1`, size: "M", color: "Black", stock: 9, attributeValueIds: [value.id] },
            { sku: `VT-KEEP-${RUN}-2`, size: "L", color: "Black", stock: 4 },
          ],
        });
        const [a, b] = (await owner().get(`/api/products/${q.id}`)).body.product.variants as { id: string; sku: string }[];
        // Change only a price on the first; the second is listed by id alone (it must stay).
        const res = await owner().patch(`/api/products/${q.id}`, { variants: [{ id: a!.id, price: 777 }, { id: b!.id }] });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const after = res.body.product.variants as { id: string; sku: string; stock: number; price: string | null; attributeValues: { attributeValueId: string }[] }[];
        const first = after.find((v) => v.id === a!.id)!;
        expect(Number(first.price)).toBe(777);
        expect(first.stock).toBe(9); // not reset to 0
        expect(first.sku).toBe(`VT-KEEP-${RUN}-1`);
        expect(first.attributeValues.map((x) => x.attributeValueId)).toEqual([value.id]); // links not cleared
        expect(after.find((v) => v.id === b!.id)!.stock).toBe(4);

        // Sending the links explicitly still replaces them, and [] still clears them.
        const cleared = await owner().patch(`/api/products/${q.id}`, { variants: [{ id: a!.id, attributeValueIds: [] }, { id: b!.id }] });
        expect(cleared.body.product.variants.find((v: { id: string }) => v.id === a!.id).attributeValues).toEqual([]);

        // A new variant still needs a SKU.
        const noSku = await owner().patch(`/api/products/${q.id}`, { variants: [{ id: a!.id }, { id: b!.id }, { size: "XL", color: "Black" }] });
        expect(noSku.status).toBe(400);
      } finally {
        await prisma.attribute.delete({ where: { id: attr.id } });
      }
    });

    it("saving an already-live product never re-checks it", async () => {
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      await prisma.productImage.deleteMany({ where: { productId: p.id } }); // e.g. an image removed after publishing
      const res = await owner().patch(`/api/products/${p.id}`, { basePrice: 520 });
      expect(res.status).toBe(200);
      expect(res.body.product.status).toBe("PUBLISHED");
      await addImage(p.id);
    });

    it("a template can require more before publish (description)", async () => {
      const tpl = await owner().post("/api/catalog/templates", {
        name: `WF template ${RUN}`,
        variantDimensions: [{ targetField: "size", label: "Size", options: [] }],
        requiredChecks: ["description", "seo"],
      });
      expect(tpl.status).toBe(201);
      made.templates.push(tpl.body.template.id);
      const type = await owner().post("/api/catalog/types", { name: `WF type ${RUN}`, templateId: tpl.body.template.id });
      made.types.push(type.body.type.id);

      const strict = await createProduct({ typeId: type.body.type.id, variants: [{ sku: `VT-WF-S-${RUN}`, size: "M", stock: 1 }] });
      await addImage(strict.id);
      const blocked = await owner().patch(`/api/products/${strict.id}`, { status: "PUBLISHED" });
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toContain("Description");
      expect(blocked.body.error).toContain("SEO description");

      const ok = await owner().patch(`/api/products/${strict.id}`, { status: "PUBLISHED", description: "<p>A proper description.</p>", seoDescription: "Meta." });
      expect(ok.status).toBe(200);
    });

    it("rejects an unknown status value", async () => {
      expect((await owner().patch(`/api/products/${p.id}`, { status: "LIVE" })).status).toBe(400);
    });
  });

  describe("bulk status", () => {
    it("moves what passes and reports what is blocked, instead of failing the batch", async () => {
      const complete = await createProduct();
      await addImage(complete.id);
      const incomplete = await createProduct();

      const res = await owner().post("/api/products/bulk/status", { ids: [complete.id, incomplete.id], status: "PUBLISHED" });
      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);
      expect(res.body.blocked).toEqual([expect.objectContaining({ id: incomplete.id, missing: expect.arrayContaining(["Images"]) })]);

      expect((await request(app).get(`/api/products/slug/${complete.slug}`)).status).toBe(200);
      expect((await request(app).get(`/api/products/slug/${incomplete.slug}`)).status).toBe(404);

      // The legacy { isActive: false } body still works and unpublishes.
      const legacy = await owner().post("/api/products/bulk/status", { ids: [complete.id], isActive: false });
      expect(legacy.body.updated).toBe(1);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: complete.id } })).status).toBe("UNPUBLISHED");
    });
  });

  describe("admin list filters", () => {
    it("filters by status and by type", async () => {
      const drafts = await owner().get(`/api/products?status=DRAFT&pageSize=100`);
      expect(drafts.status).toBe(200);
      expect(drafts.body.items.length).toBeGreaterThan(0);
      expect(drafts.body.items.every((i: { status: string }) => i.status === "DRAFT")).toBe(true);
      expect(drafts.body.items[0].type).toMatchObject({ id: expect.any(String), name: expect.any(String) });

      const byType = await owner().get(`/api/products?typeId=${clothingTypeId}&pageSize=100`);
      expect(byType.body.items.every((i: { typeId: string }) => i.typeId === clothingTypeId)).toBe(true);
      expect((await owner().get(`/api/products?status=NOPE`)).status).toBe(400);
    });
  });

  describe("SEO fields", () => {
    it("stores them, exposes the public ones and keeps the focus keyword admin-only", async () => {
      const p = await createProduct({
        seoTitle: "Custom title", seoDescription: "Custom meta", focusKeyword: "black panjabi",
        ogTitle: "OG title", ogDescription: "OG description", ogImageUrl: "https://cdn.example.com/og.jpg", canonicalUrl: "https://example.com/canonical",
      });
      await addImage(p.id);
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });

      const admin = (await owner().get(`/api/products/${p.id}`)).body.product;
      expect(admin).toMatchObject({ focusKeyword: "black panjabi", ogTitle: "OG title", canonicalUrl: "https://example.com/canonical" });

      const pub = (await request(app).get(`/api/products/slug/${p.slug}`)).body.product;
      expect(pub).toMatchObject({ ogTitle: "OG title", ogDescription: "OG description", ogImageUrl: "https://cdn.example.com/og.jpg", canonicalUrl: "https://example.com/canonical" });
      expect(pub.focusKeyword).toBeUndefined();
      expect(pub.completeness).toBeUndefined();
    });

    it("only accepts http(s) URLs for canonical and OG image", async () => {
      expect((await owner().post("/api/products", body({ canonicalUrl: "javascript:alert(1)" }))).status).toBe(400);
      expect((await owner().post("/api/products", body({ ogImageUrl: "not a url" }))).status).toBe(400);
    });

    it("clears a field when it is sent blank", async () => {
      const p = await createProduct({ canonicalUrl: "https://example.com/x" });
      const res = await owner().patch(`/api/products/${p.id}`, { canonicalUrl: "" });
      expect(res.body.product.canonicalUrl).toBeNull();
    });
  });

  describe("care guides", () => {
    let presetId: string;
    let templateCareId: string;

    it("STAFF can read but not create care guides", async () => {
      expect((await staff().get("/api/catalog/care-guides")).status).toBe(200);
      expect((await staff().post("/api/catalog/care-guides", { name: "Nope", steps: ["x"] })).status).toBe(403);
    });

    it("creates, duplicates and validates care guides", async () => {
      const res = await owner().post("/api/catalog/care-guides", { name: `Cotton care ${RUN}`, steps: ["Machine wash cold", "Do not bleach", "Iron on low heat"] });
      expect(res.status).toBe(201);
      presetId = res.body.careGuide.id;
      made.care.push(presetId);
      expect((await owner().post("/api/catalog/care-guides", { name: `Empty ${RUN}`, steps: [] })).status).toBe(400);
      expect((await owner().post("/api/catalog/care-guides", { name: `Cotton care ${RUN}`, steps: ["x"] })).status).toBe(409);
      const copy = await owner().post(`/api/catalog/care-guides/${presetId}/duplicate`);
      made.care.push(copy.body.careGuide.id);
      expect(copy.body.careGuide.name).toBe(`Cotton care ${RUN} copy`);
    });

    it("resolves care most-specific-first: product override, then product preset, then the template's", async () => {
      const t = await owner().post("/api/catalog/care-guides", { name: `Template care ${RUN}`, steps: ["Template step"] });
      templateCareId = t.body.careGuide.id;
      made.care.push(templateCareId);
      const tpl = await owner().post("/api/catalog/templates", { name: `Care template ${RUN}`, carePresetId: templateCareId });
      made.templates.push(tpl.body.template.id);
      const type = await owner().post("/api/catalog/types", { name: `Care type ${RUN}`, templateId: tpl.body.template.id });
      made.types.push(type.body.type.id);

      const p = await createProduct({ typeId: type.body.type.id, variants: [{ sku: `VT-CARE-${RUN}`, stock: 1 }] });
      await addImage(p.id);
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      const care = async () => (await request(app).get(`/api/products/slug/${p.slug}`)).body.product.resolved.care;

      expect(await care()).toEqual({ title: `Template care ${RUN}`, steps: ["Template step"], source: "template" });

      await owner().patch(`/api/products/${p.id}`, { carePresetId: presetId });
      expect(await care()).toMatchObject({ title: `Cotton care ${RUN}`, source: "preset", steps: ["Machine wash cold", "Do not bleach", "Iron on low heat"] });

      await owner().patch(`/api/products/${p.id}`, { careOverride: ["Dry clean only"] });
      expect(await care()).toEqual({ title: "Care", steps: ["Dry clean only"], source: "product" });

      // Clearing the override falls back to the preset again.
      await owner().patch(`/api/products/${p.id}`, { careOverride: [] });
      expect((await care())?.source).toBe("preset");
    });

    it("editing a preset updates every product that uses it", async () => {
      const p = await createProduct({ carePresetId: presetId });
      await addImage(p.id);
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      await owner().put(`/api/catalog/care-guides/${presetId}`, { name: `Cotton care ${RUN}`, steps: ["Hand wash only"] });
      const pub = (await request(app).get(`/api/products/slug/${p.slug}`)).body.product;
      expect(pub.resolved.care.steps).toEqual(["Hand wash only"]);
    });

    it("refuses a care guide that doesn't exist or is archived", async () => {
      expect((await owner().post("/api/products", body({ carePresetId: "nope" }))).status).toBe(400);
      const arch = await owner().post("/api/catalog/care-guides", { name: `Archived care ${RUN}`, steps: ["x"] });
      made.care.push(arch.body.careGuide.id);
      await owner().patch(`/api/catalog/care-guides/${arch.body.careGuide.id}/archive`, { isArchived: true });
      const res = await owner().post("/api/products", body({ carePresetId: arch.body.careGuide.id }));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("archived");
    });
  });

  describe("materials", () => {
    let cottonId: string;
    let polyId: string;

    it("creates materials and rejects duplicates", async () => {
      const cotton = await owner().post("/api/catalog/materials", { name: `Cotton ${RUN}` });
      const poly = await owner().post("/api/catalog/materials", { name: `Polyester ${RUN}` });
      expect([cotton.status, poly.status]).toEqual([201, 201]);
      cottonId = cotton.body.material.id;
      polyId = poly.body.material.id;
      made.materials.push(cottonId, polyId);
      expect((await owner().post("/api/catalog/materials", { name: `Cotton ${RUN}` })).status).toBe(409);
      expect((await staff().post("/api/catalog/materials", { name: "Nope" })).status).toBe(403);
    });

    it("stores a composition (catalog + custom, with percentages) and serves it resolved", async () => {
      const p = await createProduct({
        materials: [{ materialId: cottonId, percentage: 80 }, { materialId: polyId, percentage: 15 }, { customName: "Hand-woven trim", percentage: 5 }],
      });
      await addImage(p.id);
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });

      const admin = (await owner().get(`/api/products/${p.id}`)).body.product;
      expect(admin.materials).toEqual([
        { materialId: cottonId, customName: null, percentage: 80 },
        { materialId: polyId, customName: null, percentage: 15 },
        { materialId: null, customName: "Hand-woven trim", percentage: 5 },
      ]);
      const pub = (await request(app).get(`/api/products/slug/${p.slug}`)).body.product;
      expect(pub.resolved.materials).toEqual([
        { name: `Cotton ${RUN}`, percentage: 80 },
        { name: `Polyester ${RUN}`, percentage: 15 },
        { name: "Hand-woven trim", percentage: 5 },
      ]);
    });

    it("validates the composition", async () => {
      const over = await owner().post("/api/products", body({ materials: [{ materialId: cottonId, percentage: 70 }, { materialId: polyId, percentage: 50 }] }));
      expect(over.status).toBe(400);
      expect(JSON.stringify(over.body.details)).toContain("more than 100%");
      expect((await owner().post("/api/products", body({ materials: [{}] }))).status).toBe(400);
      expect((await owner().post("/api/products", body({ materials: [{ materialId: cottonId, customName: "both" }] }))).status).toBe(400);
      expect((await owner().post("/api/products", body({ materials: [{ materialId: "missing" }] }))).status).toBe(400);
    });

    it("replaces the list on update and leaves it alone when not sent", async () => {
      const p = await createProduct({ materials: [{ materialId: cottonId, percentage: 100 }] });
      await owner().patch(`/api/products/${p.id}`, { basePrice: 510 });
      expect(await prisma.productMaterial.count({ where: { productId: p.id } })).toBe(1);
      await owner().patch(`/api/products/${p.id}`, { materials: [] });
      expect(await prisma.productMaterial.count({ where: { productId: p.id } })).toBe(0);
    });

    it("won't delete a material that products use, but can archive it", async () => {
      expect((await owner().delete(`/api/catalog/materials/${cottonId}`)).status).toBe(409);
      const arch = await owner().put(`/api/catalog/materials/${polyId}`, { name: `Polyester ${RUN}`, isArchived: true });
      expect(arch.body.material.isArchived).toBe(true);
      const res = await owner().post("/api/products", body({ materials: [{ materialId: polyId }] }));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("archived");
    });
  });

  describe("history", () => {
    it("records specific events with what changed, not just 'products.update'", async () => {
      const p = await createProduct();
      await addImage(p.id);
      const variantId = (await prisma.productVariant.findFirstOrThrow({ where: { productId: p.id } })).id;
      await owner().patch(`/api/products/${p.id}`, {
        basePrice: 650,
        description: "<p>New words</p>",
        seoTitle: "New SEO",
        variants: [{ id: variantId, sku: `VT-WF-H-${RUN}`, size: "M", color: "Black", stock: 9, price: 700 }],
      });
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      await owner().patch(`/api/products/${p.id}`, { status: "UNPUBLISHED" });

      // recordAudit is fire-and-forget; give the inserts a beat.
      await new Promise((r) => setTimeout(r, 300));
      const res = await owner().get(`/api/products/${p.id}/history`);
      expect(res.status).toBe(200);
      const actions: string[] = res.body.items.map((i: { action: string }) => i.action);
      expect(actions).toEqual(expect.arrayContaining([
        "product.created", "product.price_changed", "product.stock_changed", "product.description_updated",
        "product.seo_updated", "product.variants_changed", "product.published", "product.unpublished",
      ]));
      expect(actions).not.toContain("products.update"); // the generic row is suppressed for handled routes

      const price = res.body.items.find((i: { action: string }) => i.action === "product.price_changed");
      expect(price.metadata.changes).toEqual(expect.arrayContaining([{ field: "basePrice", from: 500, to: 650 }]));
      expect(price.admin.name).toBe("Vitest Owner");
      const stock = res.body.items.find((i: { action: string }) => i.action === "product.stock_changed");
      expect(stock.metadata.changes).toEqual([{ field: `variant VT-WF-H-${RUN} stock`, from: 4, to: 9 }]);
      // newest first
      expect(actions[0]).toBe("product.unpublished");
    });

    it("records nothing for a save that changes nothing", async () => {
      const p = await createProduct();
      await new Promise((r) => setTimeout(r, 200));
      const before = (await owner().get(`/api/products/${p.id}/history`)).body.total;
      await owner().patch(`/api/products/${p.id}`, { name: (await owner().get(`/api/products/${p.id}`)).body.product.name });
      await new Promise((r) => setTimeout(r, 200));
      expect((await owner().get(`/api/products/${p.id}/history`)).body.total).toBe(before);
    });

    it("requires an admin session and an existing product", async () => {
      expect((await request(app).get(`/api/products/x/history`)).status).toBe(401);
      expect((await owner().get(`/api/products/nope/history`)).status).toBe(404);
    });
  });
});
