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
let tplId: string;
let tplTypeId: string;

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

const made: string[] = [];
let n = 0;

async function publishedProduct(over: Record<string, unknown> = {}) {
  n += 1;
  const res = await owner().post("/api/products", {
    name: `Vitest Sections ${RUN} ${n}`,
    categoryId,
    basePrice: 500 + n,
    typeId: clothingTypeId,
    variants: [{ sku: `VT-SEC-${RUN}-${n}`, size: "M", color: "Black", stock: 5 }],
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const p = res.body.product as { id: string; slug: string };
  made.push(p.id);
  await prisma.productImage.create({ data: { productId: p.id, url: `http://localhost:4000/uploads/products/vt-${RUN}-${p.id}-full.webp`, altText: "x" } });
  const pub = await owner().patch(`/api/products/${p.id}`, { status: "PUBLISHED" });
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return p;
}

const publicSections = async (slug: string) => (await request(app).get(`/api/products/slug/${slug}`)).body.product.resolved.sections as { key: string; title: string; content: string | null; order: number }[];
const sectionByKey = (list: { key: string }[], key: string) => list.find((s) => s.key === key) as { key: string; title: string; content: string | null } | undefined;

describe("page sections, FAQ, curated lists and preview", () => {
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
    clothingTypeId = clothing.id;
    const tpl = await prisma.productTemplate.create({ data: { name: `Sections template ${RUN}`, variantDimensions: [{ targetField: "size", label: "Size", options: [] }] } });
    tplId = tpl.id;
    const type = await prisma.productTypeDef.create({ data: { key: `sections-type-${RUN}`, name: `Sections type ${RUN}`, templateId: tpl.id, sortOrder: 9999 } });
    tplTypeId = type.id;
  });

  afterAll(async () => {
    await prisma.globalSection.deleteMany({});
    await prisma.product.deleteMany({ where: { OR: [{ id: { in: made } }, { categoryId }] } });
    await prisma.productTypeDef.deleteMany({ where: { id: tplTypeId } });
    await prisma.productTemplate.deleteMany({ where: { id: tplId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("defaults", () => {
    it("an untouched product resolves exactly the sections the page always had", async () => {
      const p = await publishedProduct();
      const sections = await publicSections(p.slug);
      const accordion = sections.filter((s) => ["description", "specifications", "material", "care", "shipping", "faq", "highlights", "returns", "warranty", "whatsIncluded", "video"].includes(s.key)).map((s) => s.key);
      expect(accordion).toEqual(["description", "specifications", "material", "care", "shipping", "faq"]);
      expect(sectionByKey(sections, "shipping")).toMatchObject({ title: "Shipping & Returns", content: expect.stringContaining("Dispatched within 1–2 business days") });
      // Text is only sent for text-type sections.
      expect(sectionByKey(sections, "care")!.content).toBeNull();
    });
  });

  describe("store-wide overrides", () => {
    it("are owner-only to write and readable by any admin", async () => {
      expect((await staff().get("/api/catalog/sections")).status).toBe(200);
      expect((await staff().put("/api/catalog/sections", { overrides: [] })).status).toBe(403);
      expect((await request(app).get("/api/catalog/sections")).status).toBe(401);
    });

    it("validates keys, duplicates and content", async () => {
      const put = (overrides: unknown) => owner().put("/api/catalog/sections", { overrides });
      expect((await put([{ sectionKey: "bogus", enabled: true }])).status).toBe(400);
      expect((await put([{ sectionKey: "care", enabled: true }, { sectionKey: "care", enabled: false }])).status).toBe(400);
      expect((await put([{ sectionKey: "care", content: "no text field here" }])).status).toBe(400);
      expect((await put([{ sectionKey: "video", content: "https://evil.com/x" }])).status).toBe(400);
    });

    it("change what every product shows, and storing nothing is the same as no override", async () => {
      const p = await publishedProduct();
      const res = await owner().put("/api/catalog/sections", {
        overrides: [
          { sectionKey: "shipping", content: "Free delivery over ৳3000.", title: "Delivery" },
          { sectionKey: "care", enabled: false },
          { sectionKey: "warranty", enabled: true, content: "One year." },
          { sectionKey: "material", enabled: null, title: "" }, // overrides nothing: must not be stored
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await prisma.globalSection.count()).toBe(3);

      const sections = await publicSections(p.slug);
      expect(sectionByKey(sections, "shipping")).toMatchObject({ title: "Delivery", content: "Free delivery over ৳3000." });
      expect(sectionByKey(sections, "care")).toBeUndefined();
      expect(sectionByKey(sections, "warranty")).toMatchObject({ title: "Warranty", content: "One year." });

      // The resolved list the settings page uses says where each value came from.
      const resolved = res.body.resolved.find((s: { key: string }) => s.key === "shipping");
      expect(resolved.source).toMatchObject({ title: "global", content: "global", enabled: "default" });
    });

    it("saving the whole layer replaces it: what isn't sent goes back to the default", async () => {
      await owner().put("/api/catalog/sections", { overrides: [] });
      expect(await prisma.globalSection.count()).toBe(0);
      const p = await publishedProduct();
      expect(sectionByKey(await publicSections(p.slug), "care")).toBeDefined();
    });
  });

  describe("template and product overrides", () => {
    it("layer product → template → global, field by field", async () => {
      await owner().put("/api/catalog/sections", { overrides: [{ sectionKey: "shipping", content: "Global shipping text.", title: "Global title" }] });
      const tpl = await owner().patch(`/api/catalog/templates/${tplId}`, { sections: [{ sectionKey: "shipping", title: "Template title" }, { sectionKey: "care", enabled: false }] });
      expect(tpl.status, JSON.stringify(tpl.body)).toBe(200);
      expect(tpl.body.template.sections).toHaveLength(2);

      const p = await publishedProduct({ typeId: tplTypeId, variants: [{ sku: `VT-SEC-T-${RUN}`, size: "M", stock: 3 }] });
      let sections = await publicSections(p.slug);
      // title from the template, text from the store, care hidden by the template
      expect(sectionByKey(sections, "shipping")).toMatchObject({ title: "Template title", content: "Global shipping text." });
      expect(sectionByKey(sections, "care")).toBeUndefined();

      // The product overrides just one field of one section and inherits the rest.
      await owner().patch(`/api/products/${p.id}`, { sections: [{ sectionKey: "shipping", content: "Made to order — allow 10 days." }, { sectionKey: "care", enabled: true }] });
      sections = await publicSections(p.slug);
      expect(sectionByKey(sections, "shipping")).toMatchObject({ title: "Template title", content: "Made to order — allow 10 days." });
      expect(sectionByKey(sections, "care")).toBeDefined();

      // The admin read exposes the product's own overrides and where each resolved value came from.
      const admin = (await owner().get(`/api/products/${p.id}`)).body.product;
      expect(admin.sectionOverrides).toHaveLength(2);
      const shipping = admin.sectionsResolved.find((s: { key: string }) => s.key === "shipping");
      expect(shipping.source).toMatchObject({ title: "template", content: "product" });

      // Removing the product's overrides makes it inherit again.
      await owner().patch(`/api/products/${p.id}`, { sections: [] });
      sections = await publicSections(p.slug);
      expect(sectionByKey(sections, "shipping")!.content).toBe("Global shipping text.");
      expect(sectionByKey(sections, "care")).toBeUndefined();
      expect(await prisma.productSection.count({ where: { productId: p.id } })).toBe(0);
    });

    it("a partial product update that doesn't mention sections leaves them alone", async () => {
      const p = await publishedProduct();
      await owner().patch(`/api/products/${p.id}`, { sections: [{ sectionKey: "care", title: "Looking after it" }] });
      await owner().patch(`/api/products/${p.id}`, { basePrice: 999 });
      expect(sectionByKey(await publicSections(p.slug), "care")!.title).toBe("Looking after it");
    });

    it("carries a product's own highlights, what's included, warranty and video", async () => {
      const p = await publishedProduct();
      const res = await owner().patch(`/api/products/${p.id}`, {
        sections: [
          { sectionKey: "highlights", enabled: true, content: "Breathable cotton\nHand-finished collar" },
          { sectionKey: "whatsIncluded", enabled: true, content: "Panjabi\nGift box" },
          { sectionKey: "video", enabled: true, content: "https://youtu.be/dQw4w9WgXcQ" },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const sections = await publicSections(p.slug);
      expect(sectionByKey(sections, "highlights")!.content).toBe("Breathable cotton\nHand-finished collar");
      expect(sectionByKey(sections, "video")!.content).toBe("https://youtu.be/dQw4w9WgXcQ");
      expect((await owner().patch(`/api/products/${p.id}`, { sections: [{ sectionKey: "video", content: "https://evil.com/x.html" }] })).status).toBe(400);
    });

    it("deleting a product removes its overrides, FAQ and lists with it", async () => {
      const p = await publishedProduct();
      const other = await publishedProduct();
      await owner().patch(`/api/products/${p.id}`, { sections: [{ sectionKey: "care", enabled: false }], faqs: [{ question: "Q?", answer: "A." }], relations: [{ kind: "RELATED", productIds: [other.id] }] });
      await prisma.product.delete({ where: { id: p.id } });
      expect(await prisma.productSection.count({ where: { productId: p.id } })).toBe(0);
      expect(await prisma.productFaq.count({ where: { productId: p.id } })).toBe(0);
      expect(await prisma.productRelation.count({ where: { productId: p.id } })).toBe(0);
    });
  });

  describe("FAQ", () => {
    it("keeps order, replaces on update, leaves alone when omitted, and reaches the public read", async () => {
      const p = await publishedProduct();
      await owner().patch(`/api/products/${p.id}`, { faqs: [{ question: "Is it pre-shrunk?", answer: "Yes." }, { question: "Can I return it?", answer: "Within 7 days." }] });
      const read = async () => (await request(app).get(`/api/products/slug/${p.slug}`)).body.product.resolved.faqs;
      expect((await read()).map((f: { question: string }) => f.question)).toEqual(["Is it pre-shrunk?", "Can I return it?"]);

      await owner().patch(`/api/products/${p.id}`, { basePrice: 777 });
      expect(await read()).toHaveLength(2);

      await owner().patch(`/api/products/${p.id}`, { faqs: [{ question: "Only one now?", answer: "Yes." }] });
      expect(await read()).toEqual([{ question: "Only one now?", answer: "Yes." }]);
      await owner().patch(`/api/products/${p.id}`, { faqs: [] });
      expect(await read()).toEqual([]);
    });

    it("rejects blank or oversized entries and more than 30", async () => {
      const p = await publishedProduct();
      const send = (faqs: unknown) => owner().patch(`/api/products/${p.id}`, { faqs });
      expect((await send([{ question: "", answer: "A" }])).status).toBe(400);
      expect((await send([{ question: "Q", answer: "x".repeat(2001) }])).status).toBe(400);
      expect((await send(Array.from({ length: 31 }, (_, i) => ({ question: `Q${i}`, answer: "A" })))).status).toBe(400);
    });
  });

  describe("hand-picked lists", () => {
    it("serve the picks in order, skip unpublished products, and fall back to the algorithm when empty", async () => {
      const main = await publishedProduct();
      const a = await publishedProduct();
      const b = await publishedProduct();
      const hidden = await publishedProduct();

      // Nothing picked: the automatic list (same category → the other test products qualify).
      const auto = await request(app).get(`/api/products/${main.id}/rail/related`);
      expect(auto.status).toBe(200);
      expect(auto.body.source).toBe("auto");

      const set = await owner().patch(`/api/products/${main.id}`, { relations: [{ kind: "RELATED", productIds: [b.id, hidden.id, a.id] }] });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(set.body.product.relations).toEqual([
        { kind: "RELATED", productIds: [b.id, hidden.id, a.id], products: [b, hidden, a].map((x) => ({ id: x.id, name: expect.stringContaining("Vitest Sections") })) },
      ]);

      let curated = await request(app).get(`/api/products/${main.id}/rail/related`);
      expect(curated.body.source).toBe("curated");
      expect(curated.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, hidden.id, a.id]);

      // An unpublished pick silently drops out of the storefront list (it stays in the admin's list).
      await owner().patch(`/api/products/${hidden.id}`, { status: "UNPUBLISHED" });
      curated = await request(app).get(`/api/products/${main.id}/rail/related`);
      expect(curated.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
      expect((await owner().get(`/api/products/${main.id}`)).body.product.relations[0].productIds).toHaveLength(3);
    });

    it("falls back to the automatic list when every pick has since been unpublished", async () => {
      const main = await publishedProduct();
      const a = await publishedProduct();
      await owner().patch(`/api/products/${main.id}`, { relations: [{ kind: "RELATED", productIds: [a.id] }] });
      expect((await request(app).get(`/api/products/${main.id}/rail/related`)).body.source).toBe("curated");

      await owner().patch(`/api/products/${a.id}`, { status: "UNPUBLISHED" });
      const rail = await request(app).get(`/api/products/${main.id}/rail/related`);
      expect(rail.status).toBe(200);
      expect(rail.body.source).toBe("auto"); // a section with picks that all vanished must not go blank
      expect(rail.body.items.map((i: { id: string }) => i.id)).not.toContain(a.id);
    });

    it("replaces only the kinds sent, and each list feeds its own rail", async () => {
      const main = await publishedProduct();
      const a = await publishedProduct();
      const b = await publishedProduct();
      await owner().patch(`/api/products/${main.id}`, { relations: [{ kind: "UPSELL", productIds: [a.id] }, { kind: "CROSS_SELL", productIds: [b.id] }] });
      await owner().patch(`/api/products/${main.id}`, { relations: [{ kind: "UPSELL", productIds: [b.id] }] });
      const rail = async (key: string) => (await request(app).get(`/api/products/${main.id}/rail/${key}`)).body;
      expect((await rail("upsell")).items.map((i: { id: string }) => i.id)).toEqual([b.id]);
      expect((await rail("crossSell")).items.map((i: { id: string }) => i.id)).toEqual([b.id]); // sent in the first patch, untouched by the second
      // Omitting `relations` leaves everything alone.
      await owner().patch(`/api/products/${main.id}`, { basePrice: 1234 });
      expect((await rail("upsell")).source).toBe("curated");
    });

    it("refuses itself, unknown or trashed products, duplicates and unknown lists", async () => {
      const main = await publishedProduct();
      const gone = await publishedProduct();
      await prisma.product.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      const send = (relations: unknown) => owner().patch(`/api/products/${main.id}`, { relations });
      expect((await send([{ kind: "RELATED", productIds: [main.id] }])).status).toBe(400);
      expect((await send([{ kind: "RELATED", productIds: ["nope"] }])).status).toBe(400);
      expect((await send([{ kind: "RELATED", productIds: [gone.id] }])).status).toBe(400);
      expect((await send([{ kind: "RELATED", productIds: [gone.id, gone.id] }])).status).toBe(400);
      expect((await request(app).get(`/api/products/${main.id}/rail/nope`)).status).toBe(404);
    });
  });

  describe("draft preview", () => {
    it("lets an admin see a draft exactly as the storefront resolves it, and nobody else", async () => {
      n += 1;
      const res = await owner().post("/api/products", {
        name: `Vitest Sections Draft ${RUN} ${n}`, categoryId, basePrice: 300, typeId: clothingTypeId,
        variants: [{ sku: `VT-SEC-D-${RUN}`, size: "M", color: "Black", stock: 2 }],
        sections: [{ sectionKey: "highlights", enabled: true, content: "Soft\nLight" }],
        faqs: [{ question: "Draft Q?", answer: "Draft A." }],
      });
      const draft = res.body.product as { id: string; slug: string };
      made.push(draft.id);
      expect(res.body.product.status).toBe("DRAFT");

      expect((await request(app).get(`/api/products/slug/${draft.slug}`)).status).toBe(404);
      expect((await request(app).get(`/api/products/${draft.id}/preview`)).status).toBe(401);

      const preview = await staff().get(`/api/products/${draft.id}/preview`);
      expect(preview.status).toBe(200);
      const p = preview.body.product;
      expect(p.previewStatus).toBe("DRAFT");
      expect(sectionByKey(p.resolved.sections, "highlights")!.content).toBe("Soft\nLight");
      expect(p.resolved.faqs).toEqual([{ question: "Draft Q?", answer: "Draft A." }]);
      // It is the public shape: no internal prices or admin-only data.
      expect(p.costPrice).toBeUndefined();
      expect(p.completeness).toBeUndefined();
      expect(p.sectionOverrides).toBeUndefined();
      expect((await owner().get(`/api/products/nope/preview`)).status).toBe(404);
    });
  });

  describe("history", () => {
    it("records section, FAQ and list changes", async () => {
      const a = await publishedProduct();
      const main = await publishedProduct();
      await owner().patch(`/api/products/${main.id}`, {
        sections: [{ sectionKey: "care", enabled: false }],
        faqs: [{ question: "Q?", answer: "A." }],
        relations: [{ kind: "RELATED", productIds: [a.id] }],
      });
      await new Promise((r) => setTimeout(r, 300));
      const actions = (await owner().get(`/api/products/${main.id}/history`)).body.items.map((i: { action: string }) => i.action);
      expect(actions).toEqual(expect.arrayContaining(["product.sections_updated", "product.faq_updated", "product.related_updated"]));
    });
  });
});
