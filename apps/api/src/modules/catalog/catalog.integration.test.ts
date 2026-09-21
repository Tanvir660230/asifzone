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

/** Authenticated caller for one admin role — same cookie + double-submit CSRF pairing the real frontend uses. */
function as(role: "OWNER" | "STAFF") {
  const adminId = role === "OWNER" ? ownerId : staffId;
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const withAuth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => withAuth(request(app).get(url)),
    post: (url: string, body?: object) => withAuth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => withAuth(request(app).patch(url)).send(body),
    put: (url: string, body: object) => withAuth(request(app).put(url)).send(body),
    delete: (url: string) => withAuth(request(app).delete(url)),
  };
}

const owner = () => as("OWNER");
const staff = () => as("STAFF");

// Ids of everything a test created, for cleanup.
const made = { products: [] as string[], types: [] as string[], templates: [] as string[], attributes: [] as string[], presets: [] as string[] };

let embroideryId: string;
let capPresetId: string;
let capTemplateId: string;
let capTypeId: string;
let clothingTypeId: string;

function productBody(over: Record<string, unknown> = {}) {
  return {
    name: `Vitest Cap ${RUN}`,
    categoryId,
    basePrice: 250,
    typeId: capTypeId,
    attributes: { embroideryType: "Hand Embroidery" },
    variants: [{ sku: `VT-CAP-${RUN}-M`, size: "M", stock: 3 }],
    ...over,
  };
}

describe("catalog: product types, templates and attribute definitions", () => {
  beforeAll(async () => {
    const [o, s, c] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Cat ${RUN}`, slug: `vitest-cat-${RUN}` } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { OR: [{ id: { in: made.products } }, { categoryId }] } });
    await prisma.productTypeDef.deleteMany({ where: { id: { in: made.types } } });
    await prisma.productTemplate.deleteMany({ where: { id: { in: made.templates } } });
    await prisma.attributeDefinition.deleteMany({ where: { id: { in: made.attributes } } });
    await prisma.sizeGuidePreset.deleteMany({ where: { id: { in: made.presets } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("access control", () => {
    it("rejects unauthenticated callers", async () => {
      expect((await request(app).get("/api/catalog/types")).status).toBe(401);
    });

    it("lets STAFF read the type list but not change it", async () => {
      expect((await staff().get("/api/catalog/types")).status).toBe(200);
      const res = await staff().post("/api/catalog/attributes", { key: "nopeAttr", label: "Nope", dataType: "TEXT" });
      expect(res.status).toBe(403);
    });
  });

  describe("built-in types (seeded by the migration)", () => {
    it("serves all 8 legacy types with their template", async () => {
      const res = await staff().get("/api/catalog/types");
      const keys = res.body.types.map((t: { key: string }) => t.key);
      expect(keys).toEqual(expect.arrayContaining(["CLOTHING", "FRAGRANCE", "ACCESSORY", "WATCH", "SHOES", "COSMETICS", "ISLAMIC_PRODUCT", "HOME"]));
      clothingTypeId = res.body.types.find((t: { key: string }) => t.key === "CLOTHING").typeId;
    });

    it("reproduces the old Clothing config: fields, size+colour dimensions, size guide on by default", async () => {
      const res = await staff().get("/api/catalog/types");
      const clothing = res.body.types.find((t: { key: string }) => t.key === "CLOTHING");
      expect(clothing.fields.map((f: { key: string }) => f.key)).toEqual(["material", "fit", "fabric", "careInstructions"]);
      expect(clothing.variantDimensions.map((d: { targetField: string }) => d.targetField)).toEqual(["size", "color"]);
      expect(clothing.sizeGuide.mode).toBe("ON_BY_DEFAULT");
      expect(clothing.sizeGuide.chart.columns[0]).toBe("Size");
      expect(clothing.fields.find((f: { key: string }) => f.key === "fit").options).toEqual(["Regular", "Slim", "Relaxed"]);
    });

    it("gives Shoes the shoe chart and Fragrance no size guide", async () => {
      const res = await staff().get("/api/catalog/types");
      const byKey = Object.fromEntries(res.body.types.map((t: { key: string }) => [t.key, t]));
      expect(byKey.SHOES.sizeGuide.chart.columns).toContain("EU");
      expect(byKey.FRAGRANCE.sizeGuide.mode).toBe("NOT_APPLICABLE");
    });

    it("refuses to delete a built-in type", async () => {
      expect((await owner().delete(`/api/catalog/types/${clothingTypeId}`)).status).toBe(409);
    });
  });

  describe("an admin builds a brand-new product type with no code change", () => {
    it("validates attribute definitions", async () => {
      const noOptions = await owner().post("/api/catalog/attributes", { key: `emb${RUN}`, label: "X", dataType: "SELECT", options: [] });
      expect(noOptions.status).toBe(400);
      const badKey = await owner().post("/api/catalog/attributes", { key: "Bad Key", label: "X", dataType: "TEXT" });
      expect(badKey.status).toBe(400);
      const reserved = await owner().post("/api/catalog/attributes", { key: "sizeGuide", label: "X", dataType: "TEXT" });
      expect(reserved.status).toBe(400);
    });

    it("creates a select attribute and rejects a duplicate key", async () => {
      const key = `embroideryType${RUN}`;
      const res = await owner().post("/api/catalog/attributes", {
        key,
        label: "Embroidery Type",
        dataType: "SELECT",
        options: ["Hand Embroidery", "Machine Embroidery", "None"],
      });
      expect(res.status).toBe(201);
      embroideryId = res.body.attribute.id;
      made.attributes.push(embroideryId);
      expect(res.body.attribute.options.map((o: { value: string }) => o.value)).toEqual(["Hand Embroidery", "Machine Embroidery", "None"]);

      const dup = await owner().post("/api/catalog/attributes", { key, label: "Again", dataType: "TEXT" });
      expect(dup.status).toBe(409);
    });

    it("creates a cap size guide with its own column structure, and can duplicate and archive it", async () => {
      const res = await owner().post("/api/catalog/size-guides", {
        name: `Cap size guide ${RUN}`,
        unit: "cm",
        columns: ["Size", "Head circumference"],
        rows: [["S", "54–56"], ["M", "56–58"], ["L", "58–60"], ["XL", "60–62"]],
      });
      expect(res.status).toBe(201);
      capPresetId = res.body.sizeGuide.id;
      made.presets.push(capPresetId);

      const ragged = await owner().post("/api/catalog/size-guides", { name: `Ragged ${RUN}`, columns: ["A", "B"], rows: [["1"]] });
      expect(ragged.status).toBe(400);

      const copy = await owner().post(`/api/catalog/size-guides/${capPresetId}/duplicate`);
      expect(copy.status).toBe(201);
      made.presets.push(copy.body.sizeGuide.id);
      expect(copy.body.sizeGuide.name).toBe(`Cap size guide ${RUN} copy`);

      const archived = await owner().patch(`/api/catalog/size-guides/${copy.body.sizeGuide.id}/archive`, { isArchived: true });
      expect(archived.body.sizeGuide.isArchived).toBe(true);
    });

    it("creates a template and a type that uses it", async () => {
      const tpl = await owner().post("/api/catalog/templates", {
        name: `Cap template ${RUN}`,
        variantDimensions: [{ targetField: "size", label: "Cap size", options: ["S", "M", "L", "XL"] }],
        sizeGuideMode: "ON_BY_DEFAULT",
        sizeGuidePresetId: capPresetId,
        attributes: [{ definitionId: embroideryId, required: true }],
      });
      expect(tpl.status).toBe(201);
      capTemplateId = tpl.body.template.id;
      made.templates.push(capTemplateId);

      const type = await owner().post("/api/catalog/types", { name: `Cap ${RUN}`, templateId: capTemplateId });
      expect(type.status).toBe(201);
      capTypeId = type.body.type.id;
      made.types.push(capTypeId);
      expect(type.body.type.legacyType).toBe("CUSTOM");
      // Goes after every existing type, so it never becomes the editor's default for new products.
      const all = (await staff().get("/api/catalog/types")).body.types as { typeId: string; key: string }[];
      expect(all[all.length - 1]!.typeId).toBe(capTypeId);
      expect(all[0]!.key).toBe("CLOTHING");
    });

    it("offers the new type, fully resolved, to the product editor", async () => {
      const res = await staff().get("/api/catalog/types");
      const cap = res.body.types.find((t: { typeId: string }) => t.typeId === capTypeId);
      expect(cap.fields).toHaveLength(1);
      expect(cap.fields[0]).toMatchObject({ label: "Embroidery Type", dataType: "SELECT", required: true });
      expect(cap.variantDimensions).toEqual([{ targetField: "size", label: "Cap size", options: ["S", "M", "L", "XL"] }]);
      expect(cap.sizeGuide.chart.columns).toEqual(["Size", "Head circumference"]);
    });

    it("a partial update leaves everything it didn't mention alone (no zod defaults sneaking in)", async () => {
      const renamed = await owner().patch(`/api/catalog/templates/${capTemplateId}`, { description: "Caps and kufis" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.template.attributes).toHaveLength(1);
      expect(renamed.body.template.variantDimensions).toHaveLength(1);
      expect(renamed.body.template.sizeGuideMode).toBe("ON_BY_DEFAULT");
      expect(renamed.body.template.sizeGuidePresetId).toBe(capPresetId);

      const archivedType = await owner().patch(`/api/catalog/types/${capTypeId}`, { isActive: false });
      expect(archivedType.body.type.isActive).toBe(false);
      const renamedType = await owner().patch(`/api/catalog/types/${capTypeId}`, { description: "Headwear" });
      expect(renamedType.body.type.isActive).toBe(false); // still archived: `isActive` wasn't sent, so it wasn't reset to true
      await owner().patch(`/api/catalog/types/${capTypeId}`, { isActive: true });
    });

    it("keeps an archived type out of the create flow but lets its existing products keep saving", async () => {
      // (exercised below with a product; here just the API contract for creating on an archived type)
      await owner().patch(`/api/catalog/types/${capTypeId}`, { isActive: false });
      const res = await owner().post("/api/products", productBody({ attributes: { [`embroideryType${RUN}`]: "None" }, variants: [{ sku: `VT-ARCH-${RUN}`, size: "M", stock: 1 }] }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("archived");
      await owner().patch(`/api/catalog/types/${capTypeId}`, { isActive: true });
    });

    it("refuses to delete a template or attribute that is in use", async () => {
      expect((await owner().delete(`/api/catalog/templates/${capTemplateId}`)).status).toBe(409);
      expect((await owner().delete(`/api/catalog/attributes/${embroideryId}`)).status).toBe(409);
    });
  });

  describe("products of a data-defined type", () => {
    let productId: string;
    let slug: string;

    it("enforces the template's required attribute and option list", async () => {
      const missing = await owner().post("/api/products", productBody({ attributes: {} }));
      expect(missing.status).toBe(400);
      expect(JSON.stringify(missing.body.details)).toContain("Embroidery Type is required");

      const badOption = await owner().post("/api/products", productBody({ attributes: { [`embroideryType${RUN}`]: "Laser" } }));
      expect(badOption.status).toBe(400);
      expect(JSON.stringify(badOption.body.details)).toContain("one of the listed options");
    });

    it("requires the type's own variant dimension (Cap size)", async () => {
      const res = await owner().post("/api/products", productBody({ attributes: { [`embroideryType${RUN}`]: "None" }, variants: [{ sku: `VT-NOSIZE-${RUN}`, stock: 1 }] }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain("Cap size is required");
    });

    it("rejects an attribute key that no template defines", async () => {
      const res = await owner().post("/api/products", productBody({ attributes: { [`embroideryType${RUN}`]: "None", bogus: "x" } }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain("Unknown attribute");
    });

    it("creates the product and returns attributes, type and legacy mirror", async () => {
      const res = await owner().post("/api/products", productBody({ attributes: { [`embroideryType${RUN}`]: "Hand Embroidery" } }));
      expect(res.status).toBe(201);
      const p = res.body.product;
      productId = p.id;
      slug = p.slug;
      made.products.push(productId);
      expect(p.typeId).toBe(capTypeId);
      expect(p.productType).toBe("CUSTOM");
      expect(p.status).toBe("DRAFT"); // new products start as drafts
      expect(p.attributes[`embroideryType${RUN}`]).toBe("Hand Embroidery");
      expect(await prisma.productAttributeValue.count({ where: { productId } })).toBe(1);
    });

    it("can't go live without an image, and can once it has one", async () => {
      const blocked = await owner().patch(`/api/products/${productId}`, { status: "PUBLISHED" });
      expect(blocked.status).toBe(400);
      expect(JSON.stringify(blocked.body.details.blockers)).toContain("Images");

      await prisma.productImage.create({ data: { productId, url: "http://localhost:4000/uploads/products/vitest-full.webp", altText: "test" } });
      const published = await owner().patch(`/api/products/${productId}`, { status: "PUBLISHED" });
      expect(published.status).toBe(200);
      expect(published.body.product.status).toBe("PUBLISHED");
    });

    it("renders the product page data from the template: specs, size guide, variant dimensions", async () => {
      const res = await request(app).get(`/api/products/slug/${slug}`);
      expect(res.status).toBe(200);
      const { resolved } = res.body.product;
      expect(resolved.type.name).toBe(`Cap ${RUN}`);
      expect(resolved.specGroups).toEqual([
        { name: "Specifications", items: [expect.objectContaining({ label: "Embroidery Type", value: "Hand Embroidery" })] },
      ]);
      expect(resolved.sizeGuide.show).toBe(true);
      expect(resolved.sizeGuide.chart.columns).toEqual(["Size", "Head circumference"]);
      expect(resolved.variantDimensions[0].label).toBe("Cap size");
    });

    it("does not leak internal fields on the public read", async () => {
      const res = await request(app).get(`/api/products/slug/${slug}`);
      expect(res.body.product.costPrice).toBeUndefined();
      expect(res.body.product.attributeValues).toBeUndefined();
      expect(res.body.product.type).toBeUndefined();
    });

    it("updates a single attribute value and refuses to clear a required one", async () => {
      const attr = `embroideryType${RUN}`;
      const upd = await owner().patch(`/api/products/${productId}`, { attributes: { [attr]: "Machine Embroidery" } });
      expect(upd.status).toBe(200);
      expect(upd.body.product.attributes[attr]).toBe("Machine Embroidery");
      expect(await prisma.productAttributeValue.count({ where: { productId } })).toBe(1);

      const clear = await owner().patch(`/api/products/${productId}`, { attributes: { [attr]: "" } });
      expect(clear.status).toBe(400);
    });

    it("saves unrelated fields without re-validating attributes it wasn't sent", async () => {
      const res = await owner().patch(`/api/products/${productId}`, { basePrice: 275 });
      expect(res.status).toBe(200);
      expect(res.body.product.attributes[`embroideryType${RUN}`]).toBe("Machine Embroidery");
    });

    it("refuses to remove an option that a product is using", async () => {
      const res = await owner().patch(`/api/catalog/attributes/${embroideryId}`, { options: ["Hand Embroidery", "None"] });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("Machine Embroidery");
    });

    it("keeps values when the product moves to another type, and brings them back on return", async () => {
      const attr = `embroideryType${RUN}`;
      const moved = await owner().patch(`/api/products/${productId}`, {
        typeId: clothingTypeId,
        variants: [{ id: (await prisma.productVariant.findFirstOrThrow({ where: { productId } })).id, sku: `VT-CAP-${RUN}-M`, size: "M", color: "Black", stock: 3 }],
      });
      expect(moved.status).toBe(200);
      expect(moved.body.product.productType).toBe("CLOTHING");
      expect(moved.body.product.attributes[attr]).toBeUndefined(); // hidden: Clothing has no such field
      expect(await prisma.productAttributeValue.count({ where: { productId } })).toBe(1); // …but not deleted

      const back = await owner().patch(`/api/products/${productId}`, { typeId: capTypeId });
      expect(back.status).toBe(200);
      expect(back.body.product.attributes[attr]).toBe("Machine Embroidery");
    });

    it("blocks deleting a type that products use", async () => {
      expect((await owner().delete(`/api/catalog/types/${capTypeId}`)).status).toBe(409);
    });

    it("clearing everything with null removes the rows", async () => {
      // Required attributes make this invalid on the Cap type, so move to a type where it is optional first.
      const shoes = (await staff().get("/api/catalog/types")).body.types.find((t: { key: string }) => t.key === "ACCESSORY");
      const variantId = (await prisma.productVariant.findFirstOrThrow({ where: { productId } })).id;
      const res = await owner().patch(`/api/products/${productId}`, {
        typeId: shoes.typeId,
        attributes: null,
        variants: [{ id: variantId, sku: `VT-CAP-${RUN}-M`, color: "Black", stock: 3 }],
      });
      expect(res.status).toBe(200);
      expect(res.body.product.attributes).toEqual({});
    });
  });

  describe("existing products keep working", () => {
    it("a legacy row with no typeId and JSON-only attributes still resolves its type and shows its values", async () => {
      const legacy = await prisma.product.create({
        data: {
          name: `Legacy Panjabi ${RUN}`,
          slug: `legacy-panjabi-${RUN}`,
          categoryId,
          basePrice: 1000,
          productType: "CLOTHING",
          attributes: { material: "100% Cotton", fit: "Slim", sizeGuide: { enabled: true, columns: ["Size", "Chest"], rows: [["M", "40"]] } },
          variants: { create: [{ sku: `VT-LEG-${RUN}`, size: "M", color: "Black", stock: 2 }] },
        },
      });
      made.products.push(legacy.id);

      const res = await request(app).get(`/api/products/slug/${legacy.slug}`);
      expect(res.status).toBe(200);
      const { resolved, attributes } = res.body.product;
      expect(resolved.type.key).toBe("CLOTHING");
      expect(attributes.material).toBe("100% Cotton");
      // The product's own saved size guide still wins over the type's preset.
      expect(resolved.sizeGuide).toMatchObject({ show: true, chart: { columns: ["Size", "Chest"] } });
      expect(resolved.specGroups[0].name).toBe("Specifications & Care");
      expect(resolved.specGroups[0].items.map((i: { label: string }) => i.label)).toEqual(["Material", "Fit"]);
    });

    it("saving a legacy product moves its values into typed rows and keeps its size guide", async () => {
      const legacy = await prisma.product.findFirstOrThrow({ where: { slug: `legacy-panjabi-${RUN}` } });
      const res = await owner().patch(`/api/products/${legacy.id}`, {
        attributes: { material: "Linen", fit: "Slim", sizeGuide: { enabled: true, columns: ["Size", "Chest"], rows: [["M", "40"]] } },
      });
      expect(res.status).toBe(200);
      expect(res.body.product.typeId).toBeTruthy();
      expect(res.body.product.attributes.material).toBe("Linen");
      const rows = await prisma.productAttributeValue.findMany({ where: { productId: legacy.id }, include: { definition: true } });
      expect(rows.map((r) => r.definition.key).sort()).toEqual(["fit", "material"]);
      const stored = await prisma.product.findUniqueOrThrow({ where: { id: legacy.id }, select: { attributes: true } });
      expect(Object.keys(stored.attributes as object)).toEqual(["sizeGuide"]);
    });
  });
});
