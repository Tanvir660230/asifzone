import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";

const RUN = Date.now();
const CSRF = "vitest-csrf";
let ownerId: string;
let staffId: string;
let categoryId: string;
let typeId: string;
const TYPE_CODE = `D${String(RUN).slice(-4)}`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function as(role: "OWNER" | "STAFF" | null) {
  const cookie = role ? [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`] : [`csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
    upload: (url: string) => auth(request(app).post(url)).attach("images", PNG, "vitest.png"),
  };
}
const owner = () => as("OWNER");
const staff = () => as("STAFF");

const products: string[] = [];
const materialIds: string[] = [];
const files = new Set<string>();
let n = 0;

const fileOf = (url: string) => path.join(process.cwd(), "uploads", "products", path.basename(url));
const exists = (url: string) => fs.access(fileOf(url)).then(() => true, () => false);

type P = {
  id: string;
  slug: string;
  name: string;
  status: string;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string | null;
  canonicalUrl: string | null;
  faqs: { question: string; answer: string }[];
  sectionOverrides: { sectionKey: string }[];
  relations: { kind: string; productIds: string[] }[];
  materials: { materialId: string | null; customName: string | null; percentage: number | null }[];
  variants: { id: string; sku: string; barcode: string | null; size: string; color: string; stock: number; price: string | null; imageId: string | null; images: { imageId: string; sortOrder: number }[] }[];
  images: { id: string; url: string; altText: string | null; caption: string | null; sortOrder: number }[];
};

async function createProduct(over: Record<string, unknown> = {}): Promise<P> {
  n += 1;
  const res = await owner().post("/api/products", {
    name: `Vitest Dup ${RUN} ${n}`,
    categoryId,
    typeId,
    basePrice: 900,
    brand: "Vitest Brand",
    description: "<p>Original description</p>",
    isFeatured: true,
    variants: [
      { sku: `VT-DUP-${RUN}-${n}-A`, barcode: `BC-${RUN}-${n}-A`, size: "M", color: "Black", stock: 7, price: 850 },
      { sku: `VT-DUP-${RUN}-${n}-B`, size: "L", color: "White", stock: 3 },
    ],
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  products.push(res.body.product.id);
  return res.body.product;
}

const get = async (id: string): Promise<P> => (await owner().get(`/api/products/${id}`)).body.product;

async function withImages(p: P, count = 2): Promise<P> {
  for (let i = 0; i < count; i++) {
    const res = await owner().upload(`/api/products/${p.id}/images`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const fresh = await get(p.id);
  for (const img of fresh.images) files.add(fileOf(img.url));
  return fresh;
}

describe("duplicating a product", () => {
  beforeAll(async () => {
    const [o, s, c] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_dup_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_dup_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Dup Cat ${RUN}`, slug: `vitest-dup-cat-${RUN}` } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    const tpl = await prisma.productTemplate.create({ data: { name: `Dup template ${RUN}` } });
    const type = await prisma.productTypeDef.create({ data: { key: `dup-type-${RUN}`, name: `Dup type ${RUN}`, templateId: tpl.id, skuCode: TYPE_CODE, sortOrder: 9999 } });
    typeId = type.id;
  });

  afterAll(async () => {
    // Rows first (the tests delete some through the API, which already removes those files).
    await prisma.product.deleteMany({ where: { OR: [{ id: { in: products } }, { categoryId }] } });
    await Promise.all([...files].map((f) => fs.unlink(f).catch(() => undefined)));
    await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
    await prisma.productTypeDef.deleteMany({ where: { id: typeId } });
    await prisma.productTemplate.deleteMany({ where: { name: `Dup template ${RUN}` } });
    await prisma.skuCounter.deleteMany({ where: { scope: TYPE_CODE } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("what is always true of a copy", () => {
    it("is a draft with its own slug, fresh SKUs, no barcode, no stock, and never featured — and leaves the original alone", async () => {
      const source = await createProduct();
      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      products.push(res.body.productId);

      const copy = await get(res.body.productId);
      expect(copy.name).toBe(`${source.name} (copy)`);
      expect(copy.slug).not.toBe(source.slug);
      expect(copy.status).toBe("DRAFT");
      expect(copy.isActive).toBe(false);
      expect(copy.isFeatured).toBe(false);
      expect(copy.variants).toHaveLength(2);
      // SKUs come from the generator: unique, not derived from the original's, and never the original's own.
      const skus = copy.variants.map((v) => v.sku);
      expect(new Set(skus).size).toBe(2);
      for (const sku of skus) expect(source.variants.map((v) => v.sku)).not.toContain(sku);
      expect(skus.every((s) => s.includes(TYPE_CODE))).toBe(true); // rendered by the SKU generator for this type, not typed or derived
      expect(copy.variants.every((v) => v.barcode === null)).toBe(true);
      expect(copy.variants.every((v) => v.stock === 0)).toBe(true); // default: stock is not copied
      // Options and prices come across.
      expect(copy.variants.map((v) => [v.size, v.color]).sort()).toEqual([["L", "White"], ["M", "Black"]]);
      expect(Number(copy.variants.find((v) => v.size === "M")!.price)).toBe(850);

      const untouched = await get(source.id);
      expect(untouched.variants.map((v) => [v.sku, v.stock, v.barcode])).toEqual(source.variants.map((v) => [v.sku, v.stock, v.barcode]));
      expect(untouched.status).toBe(source.status);
    });

    it("takes a chosen name and gives two copies distinct slugs", async () => {
      const source = await createProduct();
      const a = await owner().post(`/api/products/${source.id}/duplicate`, { name: `Vitest Dup Named ${RUN}` });
      const b = await owner().post(`/api/products/${source.id}/duplicate`, { name: `Vitest Dup Named ${RUN}` });
      products.push(a.body.productId, b.body.productId);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.name).toBe(`Vitest Dup Named ${RUN}`);
      expect(a.body.slug).not.toBe(b.body.slug);
    });

    it("can be done by staff, needs a login, 404s for a missing product and refuses one in Trash", async () => {
      const source = await createProduct();
      const byStaff = await staff().post(`/api/products/${source.id}/duplicate`);
      expect(byStaff.status).toBe(201);
      products.push(byStaff.body.productId);
      expect((await as(null).post(`/api/products/${source.id}/duplicate`)).status).toBe(401);
      expect((await owner().post(`/api/products/nope/duplicate`)).status).toBe(404);
      await owner().delete(`/api/products/${source.id}`);
      const trashed = await owner().post(`/api/products/${source.id}/duplicate`);
      expect(trashed.status).toBe(400);
      expect(trashed.body.error ?? trashed.body.message).toMatch(/Trash/);
    });

    it("rejects an unknown option instead of silently ignoring it", async () => {
      const source = await createProduct();
      expect((await owner().post(`/api/products/${source.id}/duplicate`, { copy: { reviews: true } })).status).toBe(400);
    });
  });

  describe("the options", () => {
    it("copies stock only when asked, and the opening stock lands in the ledger", async () => {
      const source = await createProduct();
      const res = await owner().post(`/api/products/${source.id}/duplicate`, { copy: { stock: true } });
      products.push(res.body.productId);
      const copy = await get(res.body.productId);
      expect(copy.variants.map((v) => v.stock).sort()).toEqual([3, 7]);
      const moves = await prisma.stockMovement.findMany({ where: { variantId: { in: copy.variants.map((v) => v.id) } } });
      expect(moves.reduce((sum, m) => sum + m.change, 0)).toBe(10);
    });

    it("by default brings FAQ and section settings, but not hand-picked lists or SEO text; never the canonical URL", async () => {
      const other = await createProduct();
      const source = await createProduct({
        seoTitle: "Original SEO title",
        seoDescription: "Original meta",
        canonicalUrl: "https://example.com/original",
        faqs: [{ question: "Q1?", answer: "A1" }],
        sections: [{ sectionKey: "highlights", enabled: true, content: "Line one\nLine two" }],
        relations: [{ kind: "RELATED", productIds: [other.id] }],
      });
      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      products.push(res.body.productId);
      const copy = await get(res.body.productId);
      expect(copy.faqs).toEqual([{ question: "Q1?", answer: "A1" }]);
      expect(copy.sectionOverrides.map((s) => s.sectionKey)).toEqual(["highlights"]);
      expect(copy.relations).toEqual([]);
      expect(copy.seoTitle).toBeNull();
      expect(copy.canonicalUrl).toBeNull();

      const all = await owner().post(`/api/products/${source.id}/duplicate`, { copy: { relations: true, seo: true } });
      products.push(all.body.productId);
      const full = await get(all.body.productId);
      expect(full.relations.map((r) => [r.kind, r.productIds])).toEqual([["RELATED", [other.id]]]);
      expect(full.seoTitle).toBe("Original SEO title");
      expect(full.canonicalUrl).toBeNull(); // pointing the copy's canonical at the original would de-index it

      const bare = await owner().post(`/api/products/${source.id}/duplicate`, { copy: { faqs: false, sections: false } });
      products.push(bare.body.productId);
      const none = await get(bare.body.productId);
      expect(none.faqs).toEqual([]);
      expect(none.sectionOverrides).toEqual([]);
    });

    it("carries materials over, and an archived material as plain text with a warning", async () => {
      const live = await prisma.material.create({ data: { name: `Vitest Cotton ${RUN}` } });
      const old = await prisma.material.create({ data: { name: `Vitest Linen ${RUN}`, isArchived: true } });
      materialIds.push(live.id, old.id);
      const source = await createProduct({ materials: [{ materialId: live.id, percentage: 60 }] });
      // Archive after the product uses it — the legitimate way a product ends up on an archived material.
      await prisma.productMaterial.create({ data: { productId: source.id, materialId: old.id, percentage: 40, sortOrder: 1 } });

      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      products.push(res.body.productId);
      const copy = await get(res.body.productId);
      expect(copy.materials).toEqual([
        { materialId: live.id, customName: null, percentage: 60 },
        { materialId: null, customName: `Vitest Linen ${RUN}`, percentage: 40 },
      ]);
      expect(res.body.warnings.join(" ")).toMatch(/archived/);

      const without = await owner().post(`/api/products/${source.id}/duplicate`, { copy: { materialsAndCare: false } });
      products.push(without.body.productId);
      expect((await get(without.body.productId)).materials).toEqual([]);
    });
  });

  describe("images", () => {
    it("copies the files so the two products never share a photo, and rebuilds each variant's gallery", async () => {
      const source = await withImages(await createProduct(), 2);
      const [first, second] = source.images;
      // Variant A shows the second image first, then the first; variant B has none of its own.
      const a = source.variants.find((v) => v.size === "M")!;
      const b = source.variants.find((v) => v.size === "L")!;
      // Send both variants: a variant left out of an update is deleted.
      await owner().patch(`/api/products/${source.id}`, {
        variants: [
          { id: a.id, sku: a.sku, size: "M", color: "Black", stock: 7, imageIds: [second!.id, first!.id] },
          { id: b.id, sku: b.sku, size: "L", color: "White", stock: 3 },
        ],
      });

      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      products.push(res.body.productId);
      expect(res.body.copied.images).toBe(2);
      const copy = await get(res.body.productId);
      for (const img of copy.images) files.add(fileOf(img.url));

      expect(copy.images).toHaveLength(2);
      for (const img of copy.images) {
        expect(source.images.map((s) => s.url)).not.toContain(img.url); // separate files
        expect(await exists(img.url)).toBe(true);
      }
      // Same order and captions; the variant's gallery points at the copy's own images, in the same order.
      expect(copy.images.map((i) => i.altText)).toEqual(source.images.map((i) => i.altText));
      const copyA = copy.variants.find((v) => v.size === "M")!;
      expect(copyA.images.map((g) => g.imageId)).toEqual([copy.images[1]!.id, copy.images[0]!.id]);
      expect(copyA.imageId).toBe(copy.images[1]!.id);
      expect(copy.variants.find((v) => v.size === "L")!.images).toEqual([]);
    });

    it("deleting an image from one product never removes the other product's file", async () => {
      const source = await withImages(await createProduct(), 1);
      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      products.push(res.body.productId);
      const copy = await get(res.body.productId);
      files.add(fileOf(copy.images[0]!.url));

      expect((await owner().delete(`/api/products/${source.id}/images/${source.images[0]!.id}`)).status).toBe(204);
      expect(await exists(source.images[0]!.url)).toBe(false);
      expect(await exists(copy.images[0]!.url)).toBe(true);
    });

    it("skips images with nothing to copy when images is off", async () => {
      const source = await withImages(await createProduct(), 1);
      const res = await owner().post(`/api/products/${source.id}/duplicate`, { copy: { images: false } });
      products.push(res.body.productId);
      expect((await get(res.body.productId)).images).toEqual([]);
    });

    it("reports an image whose files are missing and copies the rest", async () => {
      const source = await withImages(await createProduct(), 2);
      await fs.unlink(fileOf(source.images[0]!.url));
      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      products.push(res.body.productId);
      expect(res.body.copied.images).toBe(1);
      expect(res.body.warnings.join(" ")).toMatch(/missing from storage/);
      const copy = await get(res.body.productId);
      for (const img of copy.images) files.add(fileOf(img.url));
    });
  });

  describe("history", () => {
    it("records the duplication on both products", async () => {
      const source = await createProduct();
      const res = await owner().post(`/api/products/${source.id}/duplicate`);
      products.push(res.body.productId);
      await new Promise((r) => setTimeout(r, 200)); // the audit write is fire-and-forget

      const onCopy = (await owner().get(`/api/products/${res.body.productId}/history`)).body.items.map((i: { action: string }) => i.action);
      expect(onCopy).toContain("product.duplicated");
      expect(onCopy).toContain("product.created");
      const onSource = (await owner().get(`/api/products/${source.id}/history`)).body.items.map((i: { action: string }) => i.action);
      expect(onSource).toContain("product.copied");
    });
  });

  describe("permanent delete", () => {
    it("is the owner's call: staff get 403, the owner can", async () => {
      const p = await createProduct();
      await owner().delete(`/api/products/${p.id}`);
      expect((await staff().delete(`/api/products/${p.id}/permanent`)).status).toBe(403);
      expect((await owner().get(`/api/products/${p.id}`)).status).toBe(200); // still there
      expect((await owner().delete(`/api/products/${p.id}/permanent`)).status).toBe(204);
      expect((await owner().get(`/api/products/${p.id}`)).status).toBe(404);
    });

    it("keeps the files while another image row still uses them", async () => {
      const a = await withImages(await createProduct(), 1);
      const b = await createProduct();
      // Two rows on one URL (data that predates copy-on-duplicate could look like this).
      await prisma.productImage.create({ data: { productId: b.id, url: a.images[0]!.url, altText: "shared", sortOrder: 0 } });

      await owner().delete(`/api/products/${a.id}/images/${a.images[0]!.id}`);
      expect(await exists(a.images[0]!.url)).toBe(true); // b still points at it

      await owner().delete(`/api/products/${b.id}`);
      expect((await owner().delete(`/api/products/${b.id}/permanent`)).status).toBe(204);
      expect(await exists(a.images[0]!.url)).toBe(false); // last reference gone
    });
  });
});
