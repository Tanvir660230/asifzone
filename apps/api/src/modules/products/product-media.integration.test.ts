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
let testTypeId: string;
const TYPE_CODE = `T${String(RUN).slice(-4)}`; // unique per run so the SKU counter row is ours alone

// 1x1 PNG the upload pipeline accepts.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function as(role: "OWNER" | "STAFF") {
  const cookie = [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
    put: (url: string, body: object) => auth(request(app).put(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
    upload: (url: string) => auth(request(app).post(url)).attach("images", PNG, "vitest.png"),
  };
}
const owner = () => as("OWNER");
const staff = () => as("STAFF");

const products: string[] = [];
let n = 0;

async function createProduct(over: Record<string, unknown> = {}) {
  n += 1;
  const res = await owner().post("/api/products", {
    name: `Vitest Media ${RUN} ${n}`,
    categoryId,
    basePrice: 500,
    typeId: clothingTypeId,
    variants: [
      { sku: `VT-MEDIA-${RUN}-${n}-BM`, size: "M", color: "Black", stock: 5 },
      { sku: `VT-MEDIA-${RUN}-${n}-BL`, size: "L", color: "Black", stock: 5 },
      { sku: `VT-MEDIA-${RUN}-${n}-WM`, size: "M", color: "White", stock: 5 },
    ],
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  products.push(res.body.product.id);
  return res.body.product as { id: string; slug: string; variants: { id: string; sku: string; color: string; size: string }[] };
}

const addImages = async (productId: string, count: number) =>
  Promise.all(
    Array.from({ length: count }, (_, i) =>
      prisma.productImage.create({ data: { productId, url: `http://localhost:4000/uploads/products/vt-${RUN}-${productId}-${i}-full.webp`, altText: `img ${i}`, sortOrder: i } }),
    ),
  ).then((rows) => rows.sort((a, b) => a.sortOrder - b.sortOrder));

describe("variant galleries, image metadata, variant status, SKU generator", () => {
  beforeAll(async () => {
    const [o, s, c, clothing] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_media_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_media_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Media Cat ${RUN}`, slug: `vitest-media-cat-${RUN}` } }),
      prisma.productTypeDef.findUniqueOrThrow({ where: { key: "CLOTHING" } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    clothingTypeId = clothing.id;
    const tpl = await prisma.productTemplate.create({ data: { name: `Media template ${RUN}` } });
    const type = await prisma.productTypeDef.create({ data: { key: `media-type-${RUN}`, name: `Media type ${RUN}`, templateId: tpl.id, skuCode: TYPE_CODE, sortOrder: 9999 } });
    testTypeId = type.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { OR: [{ id: { in: products } }, { categoryId }] } });
    await prisma.productTypeDef.deleteMany({ where: { id: testTypeId } });
    await prisma.productTemplate.deleteMany({ where: { name: `Media template ${RUN}` } });
    await prisma.skuCounter.deleteMany({ where: { scope: TYPE_CODE } });
    await prisma.catalogSetting.updateMany({ data: { skuPrefix: "AZ", skuPattern: "{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}" } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("variant galleries", () => {
    it("assigns an ordered gallery, makes the first image primary, and serves it on reads", async () => {
      const p = await createProduct();
      const [a, b, c] = await addImages(p.id, 3);
      const black = p.variants.find((v) => v.sku.endsWith("-BM"))!;

      const res = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: black.id, sku: black.sku, size: "M", color: "Black", stock: 5, imageIds: [c!.id, a!.id] }] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const v = res.body.product.variants.find((x: { id: string }) => x.id === black.id);
      expect(v.imageId).toBe(c!.id);
      expect(v.images.map((i: { imageId: string }) => i.imageId)).toEqual([c!.id, a!.id]);
      void b;
    });

    it("a partial update that doesn't mention images leaves the gallery alone", async () => {
      const p = await createProduct();
      const [a, b] = await addImages(p.id, 2);
      const v0 = p.variants[0]!;
      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageIds: [a!.id, b!.id] }] });
      const res = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 9 }] });
      expect(res.body.product.variants.find((x: { id: string }) => x.id === v0.id).images).toHaveLength(2);
    });

    it("an older client sending only imageId means 'exactly this image'", async () => {
      const p = await createProduct();
      const [a, b] = await addImages(p.id, 2);
      const v0 = p.variants[0]!;
      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageIds: [a!.id, b!.id] }] });
      const res = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageId: b!.id }] });
      const v = res.body.product.variants.find((x: { id: string }) => x.id === v0.id);
      expect(v.images.map((i: { imageId: string }) => i.imageId)).toEqual([b!.id]);
      const cleared = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageId: null }] });
      expect(cleared.body.product.variants.find((x: { id: string }) => x.id === v0.id)).toMatchObject({ imageId: null, images: [] });
    });

    it("refuses another product's image and duplicate ids", async () => {
      const p = await createProduct();
      const other = await createProduct();
      const [foreign] = await addImages(other.id, 1);
      const [own] = await addImages(p.id, 1);
      const v0 = p.variants[0]!;
      const bad = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageIds: [foreign!.id] }] });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toContain("doesn't belong");
      const dup = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageIds: [own!.id, own!.id] }] });
      expect(dup.status).toBe(400);
    });

    it("deleting an image drops it from galleries, and a variant falls back to its next image", async () => {
      const p = await createProduct();
      const [a, b] = await addImages(p.id, 2);
      const v0 = p.variants[0]!;
      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageIds: [a!.id, b!.id] }] });
      expect((await owner().delete(`/api/products/${p.id}/images/${a!.id}`)).status).toBe(204);
      const v = (await owner().get(`/api/products/${p.id}`)).body.product.variants.find((x: { id: string }) => x.id === v0.id);
      expect(v.images.map((i: { imageId: string }) => i.imageId)).toEqual([b!.id]);
      expect(v.imageId).toBe(b!.id);
    });

    it("records the change in the product history", async () => {
      const p = await createProduct();
      const [a] = await addImages(p.id, 1);
      const v0 = p.variants[0]!;
      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, imageIds: [a!.id] }] });
      await new Promise((r) => setTimeout(r, 300));
      const history = (await owner().get(`/api/products/${p.id}/history`)).body.items;
      const changed = history.find((i: { action: string }) => i.action === "product.variants_changed");
      expect(JSON.stringify(changed.metadata.changes)).toContain("images");
    });
  });

  describe("image metadata", () => {
    it("records pixel size at upload and lets caption and alt text be edited independently", async () => {
      const p = await createProduct();
      const up = await staff().upload(`/api/products/${p.id}/images`);
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      const image = up.body.product.images[0];
      expect(image).toMatchObject({ width: 1, height: 1 });

      expect((await owner().patch(`/api/products/${p.id}/images/${image.id}`, { caption: "Front view" })).status).toBe(204);
      let after = (await owner().get(`/api/products/${p.id}`)).body.product.images[0];
      expect(after).toMatchObject({ caption: "Front view", altText: image.altText });

      await owner().patch(`/api/products/${p.id}/images/${image.id}`, { altText: "A black panjabi, front" });
      after = (await owner().get(`/api/products/${p.id}`)).body.product.images[0];
      expect(after).toMatchObject({ caption: "Front view", altText: "A black panjabi, front" });

      await owner().patch(`/api/products/${p.id}/images/${image.id}`, { caption: "" });
      expect((await owner().get(`/api/products/${p.id}`)).body.product.images[0].caption).toBeNull();

      expect((await owner().patch(`/api/products/${p.id}/images/${image.id}`, {})).status).toBe(400);
      // delete the uploaded files too
      await owner().delete(`/api/products/${p.id}/images/${image.id}`);
    });
  });

  describe("variant status and compare-at price", () => {
    it("hides an inactive variant from the storefront but not from the admin", async () => {
      const p = await createProduct();
      await addImages(p.id, 1);
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      const white = p.variants.find((v) => v.color === "White")!;
      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: white.id, sku: white.sku, size: "M", color: "White", stock: 5, isActive: false }] });

      const pub = (await request(app).get(`/api/products/slug/${p.slug}`)).body.product;
      expect(pub.variants.map((v: { color: string }) => v.color)).not.toContain("White");
      const admin = (await owner().get(`/api/products/${p.id}`)).body.product;
      expect(admin.variants.find((v: { id: string }) => v.id === white.id).isActive).toBe(false);
    });

    it("refuses to check out an inactive variant, without touching stock", async () => {
      const p = await createProduct();
      await addImages(p.id, 1);
      await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
      const v = p.variants[0]!;
      const checkout = (variantId: string) => request(app).post("/api/orders").send({
        items: [{ variantId, quantity: 1 }], customerName: "Vitest Media", customerPhone: "01712345678",
        shippingDivision: "Dhaka", shippingDistrict: "Dhaka", shippingArea: "Uttara", shippingAddressLine: "House 1", paymentMethod: "COD",
      });

      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v.id, sku: v.sku, size: "M", color: "Black", stock: 5, isActive: false }] });
      const blocked = await checkout(v.id);
      expect(blocked.status).toBe(400);
      expect(blocked.body.error).toContain("no longer available");
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(5);

      // Reactivated, the same variant sells again.
      await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v.id, sku: v.sku, size: "M", color: "Black", stock: 5, isActive: true }] });
      const ok = await checkout(v.id);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      await prisma.order.deleteMany({ where: { id: ok.body.order.id } });
    });

    it("keeps compare-at price only above the variant's own price", async () => {
      const p = await createProduct();
      const v0 = p.variants[0]!;
      const bad = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, price: 500, compareAtPrice: 400 }] });
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body.details)).toContain("higher than the variant price");
      const ok = await owner().patch(`/api/products/${p.id}`, { variants: [{ id: v0.id, sku: v0.sku, size: "M", color: "Black", stock: 5, price: 500, compareAtPrice: 650 }] });
      expect(ok.status).toBe(200);
      expect(Number(ok.body.product.variants.find((x: { id: string }) => x.id === v0.id).compareAtPrice)).toBe(650);
      // …and it is a tracked price change.
      await new Promise((r) => setTimeout(r, 300));
      const events = (await owner().get(`/api/products/${p.id}/history`)).body.items;
      expect(JSON.stringify(events)).toContain("compare-at price");
    });
  });

  describe("SKU generator", () => {
    it("serves default settings, and only the owner can change them", async () => {
      const res = await staff().get("/api/catalog/sku-settings");
      expect(res.status).toBe(200);
      expect(res.body.settings).toMatchObject({ skuPrefix: expect.any(String), skuPattern: expect.stringContaining("{SEQ") });
      expect((await staff().put("/api/catalog/sku-settings", { skuPrefix: "ZZ", skuPattern: "{PREFIX}-{SEQ:3}" })).status).toBe(403);
    });

    it("validates the pattern and prefix", async () => {
      expect((await owner().put("/api/catalog/sku-settings", { skuPrefix: "AZ", skuPattern: "{PREFIX}-{TYPE}" })).status).toBe(400);
      expect((await owner().put("/api/catalog/sku-settings", { skuPrefix: "A Z", skuPattern: "{PREFIX}-{SEQ}" })).status).toBe(400);
      expect((await owner().put("/api/catalog/sku-settings", { skuPrefix: "AZ", skuPattern: "{PREFIX}-{NOPE}-{SEQ}" })).status).toBe(400);
    });

    it("generates sequential, pattern-shaped SKUs per type from the configured pattern", async () => {
      await owner().put("/api/catalog/sku-settings", { skuPrefix: "az", skuPattern: "{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}" });
      const gen = async (body: object) => (await staff().post("/api/catalog/sku/generate", { typeId: testTypeId, ...body })).body.sku as string;
      expect(await gen({ color: "Black", size: "M" })).toBe(`AZ-${TYPE_CODE}-BLA-M-001`);
      expect(await gen({ color: "White", size: "L" })).toBe(`AZ-${TYPE_CODE}-WHI-L-002`);
      expect(await gen({})).toBe(`AZ-${TYPE_CODE}-003`); // no colour/size: separators collapse
    });

    it("never hands out the same SKU twice, even under concurrent requests", async () => {
      const results = await Promise.all(Array.from({ length: 12 }, () => staff().post("/api/catalog/sku/generate", { typeId: testTypeId, color: "Red", size: "S" })));
      const skus = results.map((r) => r.body.sku as string);
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(skus).size).toBe(12);
    });

    it("skips a SKU already used by a saved variant (database collision)", async () => {
      const counter = await prisma.skuCounter.findUniqueOrThrow({ where: { scope: TYPE_CODE } });
      const pad = (k: number) => String(k).padStart(3, "0");
      // Save a variant that owns exactly the number the counter is about to hand out.
      await createProduct({ typeId: testTypeId, variants: [{ sku: `AZ-${TYPE_CODE}-BLA-M-${pad(counter.next)}`, stock: 1 }] });
      const res = await staff().post("/api/catalog/sku/generate", { typeId: testTypeId, color: "Black", size: "M" });
      expect(res.body.sku).toBe(`AZ-${TYPE_CODE}-BLA-M-${pad(counter.next + 1)}`);
    });

    it("skips a SKU another row of the same unsaved form already holds", async () => {
      const counter = await prisma.skuCounter.findUniqueOrThrow({ where: { scope: TYPE_CODE } });
      const pad = (k: number) => String(k).padStart(3, "0");
      const heldByForm = `az-${TYPE_CODE}-blu-l-${pad(counter.next)}`; // case-insensitive match
      const res = await staff().post("/api/catalog/sku/generate", { typeId: testTypeId, color: "Blue", size: "L", taken: [heldByForm] });
      expect(res.body.sku).toBe(`AZ-${TYPE_CODE}-BLU-L-${pad(counter.next + 1)}`);
    });

    it("falls back to the type name's first letters when the type has no SKU code", async () => {
      const tpl = await prisma.productTemplate.create({ data: { name: `Media template2 ${RUN}` } });
      const type = await prisma.productTypeDef.create({ data: { key: `panjabi-${RUN}`, name: "Panjabi", templateId: tpl.id, sortOrder: 9998 } });
      const res = await staff().post("/api/catalog/sku/generate", { typeId: type.id, color: "Black", size: "M" });
      expect(res.body.sku).toMatch(/^AZ-PAN-BLA-M-\d{3}$/);
      await prisma.skuCounter.deleteMany({ where: { scope: "PAN" } });
      await prisma.productTypeDef.delete({ where: { id: type.id } });
      await prisma.productTemplate.delete({ where: { id: tpl.id } });
    });

    it("stores a SKU code on a type through the catalog API and validates it", async () => {
      const type = await owner().get("/api/catalog/types/manage");
      const mine = type.body.types.find((t: { id: string }) => t.id === testTypeId);
      expect(mine.skuCode).toBe(TYPE_CODE);
      expect((await owner().patch(`/api/catalog/types/${testTypeId}`, { skuCode: "x" })).status).toBe(400);
      const ok = await owner().patch(`/api/catalog/types/${testTypeId}`, { skuCode: TYPE_CODE.toLowerCase() });
      expect(ok.body.type.skuCode).toBe(TYPE_CODE); // normalised to upper case
    });

    it("rejects an unknown type", async () => {
      expect((await staff().post("/api/catalog/sku/generate", { typeId: "nope" })).status).toBe(400);
    });
  });
});
