import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { parseCsv, toCsv } from "../../lib/csv";

const RUN = Date.now();
const CSRF = "vitest-csrf";
let ownerId: string;
let staffId: string;
let categorySlug: string;
let categoryId: string;
let typeId: string;
let templateId: string;
const made = { attributes: [] as string[], materials: [] as string[] };
const ATTR = { finish: `finish${RUN}`, pieces: `pieces${RUN}`, gift: `gift${RUN}` };
const TYPE_CODE = `I${String(RUN).slice(-4)}`;

function as(role: "OWNER" | "STAFF" | null) {
  const cookie = role ? [`access_token=${signAccessToken({ adminId: role === "OWNER" ? ownerId : staffId, role })}`, `csrf_token=${CSRF}`] : [`csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
    delete: (url: string) => auth(request(app).delete(url)),
  };
}
const owner = () => as("OWNER");
const staff = () => as("STAFF");

/** Builds CSV text from row objects; the columns are the union of their keys, in first-seen order. */
function sheet(rows: Record<string, string | number>[]) {
  const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return toCsv(header, rows.map((r) => header.map((h) => r[h] ?? "")));
}

const slug = (label: string) => `vt-imp-${RUN}-${label}`;
const sku = (label: string) => `VTI-${RUN}-${label}`;

/** A complete, valid first row for a new product; the tests override or add to it. */
const newProduct = (label: string, over: Record<string, string | number> = {}) => ({
  slug: slug(label),
  name: `Vitest Import ${label} ${RUN}`,
  category: categorySlug,
  product_type: `imp-type-${RUN}`,
  base_price: 1200,
  variant_sku: sku(`${label}-M`),
  variant_size: "M",
  variant_stock: 5,
  [`attr:${ATTR.finish}`]: "Matte",
  [`attr:${ATTR.pieces}`]: 2,
  ...over,
});

const validate = (csv: string, who = owner()) => who.post("/api/products/import/validate", { csv });
const commit = (csv: string, skipInvalid?: boolean, who = owner()) => who.post("/api/products/import/commit", { csv, ...(skipInvalid !== undefined ? { skipInvalid } : {}) });

const bySlug = (s: string) =>
  prisma.product.findUnique({
    where: { slug: s },
    include: { variants: { orderBy: { sortOrder: "asc" } }, attributeValues: { include: { definition: true } }, materials: { include: { material: true } } },
  });

describe("CSV export and import", () => {
  beforeAll(async () => {
    const [o, s, c] = await Promise.all([
      prisma.adminUser.create({ data: { name: "Vitest Owner", email: `vt_imp_owner_${RUN}@example.com`, passwordHash: "x", role: "OWNER" } }),
      prisma.adminUser.create({ data: { name: "Vitest Staff", email: `vt_imp_staff_${RUN}@example.com`, passwordHash: "x", role: "STAFF" } }),
      prisma.category.create({ data: { name: `Vitest Imp Cat ${RUN}`, slug: `vitest-imp-cat-${RUN}` } }),
    ]);
    ownerId = o.id;
    staffId = s.id;
    categoryId = c.id;
    categorySlug = c.slug;

    const finish = await owner().post("/api/catalog/attributes", { key: ATTR.finish, label: "Finish", dataType: "SELECT", options: ["Matte", "Glossy"] });
    const pieces = await owner().post("/api/catalog/attributes", { key: ATTR.pieces, label: "Pieces", dataType: "NUMBER" });
    const gift = await owner().post("/api/catalog/attributes", { key: ATTR.gift, label: "Giftable", dataType: "BOOLEAN" });
    for (const r of [finish, pieces, gift]) {
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      made.attributes.push(r.body.attribute.id);
    }
    const tpl = await owner().post("/api/catalog/templates", {
      name: `Imp template ${RUN}`,
      variantDimensions: [{ targetField: "size", label: "Size", options: ["S", "M", "L"] }],
      attributes: [
        { definitionId: finish.body.attribute.id, required: true },
        { definitionId: pieces.body.attribute.id, required: false },
        { definitionId: gift.body.attribute.id, required: false },
      ],
    });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    templateId = tpl.body.template.id;
    const type = await owner().post("/api/catalog/types", { name: `Imp type ${RUN}`, key: `imp-type-${RUN}`, templateId, skuCode: TYPE_CODE });
    expect(type.status, JSON.stringify(type.body)).toBe(201);
    typeId = type.body.type.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { OR: [{ slug: { startsWith: `vt-imp-${RUN}` } }, { categoryId }] } });
    await prisma.productTypeDef.deleteMany({ where: { id: typeId } });
    await prisma.productTemplate.deleteMany({ where: { id: templateId } });
    await prisma.attributeDefinition.deleteMany({ where: { id: { in: made.attributes } } });
    await prisma.material.deleteMany({ where: { id: { in: made.materials } } });
    await prisma.skuCounter.deleteMany({ where: { scope: TYPE_CODE } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.stockMovement.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.auditLog.deleteMany({ where: { adminId: { in: [ownerId, staffId] } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
    await prisma.$disconnect();
  });

  describe("who can do what", () => {
    it("lets any admin export and fetch the template; import is the owner's", async () => {
      expect((await staff().get("/api/products/export/full")).status).toBe(200);
      expect((await staff().get("/api/products/import/template")).status).toBe(200);
      const csv = sheet([newProduct("perm")]);
      expect((await validate(csv, staff())).status).toBe(403);
      expect((await commit(csv, undefined, staff())).status).toBe(403);
      expect((await validate(csv, as(null))).status).toBe(401);
      expect(await bySlug(slug("perm"))).toBeNull();
    });

    it("serves the template as a UTF-8 CSV with the type's attribute columns", async () => {
      const res = await owner().get(`/api/products/import/template?typeId=${typeId}`);
      expect(res.headers["content-type"]).toMatch(/text\/csv/);
      expect(res.text.charCodeAt(0)).toBe(0xfeff); // byte-order mark, so Excel reads non-English text correctly
      const header = parseCsv(res.text)[0]!.cells;
      expect(header.slice(0, 3)).toEqual(["slug", "name", "status"]);
      expect(header).toEqual(expect.arrayContaining(["variant_sku", `attr:${ATTR.finish}`, `attr:${ATTR.pieces}`, `attr:${ATTR.gift}`]));
    });
  });

  describe("checking a file (dry run)", () => {
    it("reports what would be created and writes nothing", async () => {
      const csv = sheet([newProduct("dry"), { slug: slug("dry"), variant_sku: sku("dry-L"), variant_size: "L", variant_stock: 3 }]);
      const res = await validate(csv);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { report } = res.body;
      expect(report.ok).toBe(true);
      expect(report.summary).toMatchObject({ rows: 2, products: 1, create: 1, update: 0, invalid: 0 });
      expect(report.items[0]).toMatchObject({ action: "create", slug: slug("dry"), variants: 2 });
      expect(await bySlug(slug("dry"))).toBeNull();
      expect(await prisma.productVariant.count({ where: { sku: { startsWith: `VTI-${RUN}-dry` } } })).toBe(0);
    });

    it("names the line and column of every problem", async () => {
      const csv = sheet([
        newProduct("e1", { category: "no-such-category" }),
        newProduct("e2", { base_price: "12,50" }),
        newProduct("e3", { [`attr:${ATTR.finish}`]: "Rough" }),
        newProduct("e4", { [`attr:${ATTR.finish}`]: "" }),
        newProduct("e5", { product_type: "" }),
        newProduct("e6", { variant_size: "" }), // the template requires a size
        newProduct("e7", { base_price: -5 }),
        newProduct("e8", { variant_stock: "many" }),
      ]);
      const { report } = (await validate(csv)).body;
      expect(report.ok).toBe(false);
      expect(report.summary.invalid).toBe(8);
      const find = (product: string, column: string) => report.errors.find((e: { product: string; column: string }) => e.product === slug(product) && e.column === column);
      expect(find("e1", "category")).toMatchObject({ row: 2, message: expect.stringMatching(/No category/) });
      expect(find("e2", "base_price")).toMatchObject({ row: 3, message: expect.stringMatching(/not a number/) });
      // One problem per cell: the unparseable price isn't also reported as "required".
      expect(report.errors.filter((e: { product: string }) => e.product === slug("e2"))).toHaveLength(1);
      expect(find("e3", `attr:${ATTR.finish}`)).toMatchObject({ row: 4, message: expect.stringMatching(/Matte, Glossy/) });
      expect(find("e4", `attr:${ATTR.finish}`)).toMatchObject({ row: 5, message: expect.stringMatching(/required/i) });
      expect(find("e5", "product_type")).toMatchObject({ row: 6 });
      expect(find("e6", "variant_size")).toBeTruthy();
      expect(find("e7", "base_price")).toBeTruthy();
      expect(find("e8", "variant_stock")).toMatchObject({ row: 9 });
    });

    it("catches SKUs that collide inside the file or with another product, and disagreeing rows", async () => {
      await commit(sheet([newProduct("owner")])); // a real product that owns a SKU
      const csv = sheet([
        newProduct("c1", { variant_sku: sku("owner-M") }), // belongs to another product
        newProduct("c2", { variant_sku: sku("dup") }),
        newProduct("c3", { variant_sku: sku("dup") }), // same SKU as c2's variant
        { ...newProduct("c4"), variant_sku: sku("c4-M") },
        { slug: slug("c4"), base_price: 999, variant_sku: sku("c4-L"), variant_size: "L" }, // disagrees with 1200 on the first row
      ]);
      const { report } = (await validate(csv)).body;
      const messages = report.errors.map((e: { product: string; message: string }) => `${e.product}: ${e.message}`).join("\n");
      expect(messages).toMatch(new RegExp(`${slug("c1")}: The SKU "${sku("owner-M")}" already belongs to the product "${slug("owner")}"`));
      expect(messages).toMatch(new RegExp(`${slug("c3")}: The SKU "${sku("dup")}" is also used on line`));
      expect(messages).toMatch(new RegExp(`${slug("c4")}: "base_price" is different on lines`));
    });

    it("refuses a file that isn't a product sheet", async () => {
      const cases: [string, RegExp][] = [
        [`name,base_price\nA,5\n`, /variant_sku/],
        [`variant_sku,base_price\nX,5\n`, /slug. or a .name/],
        [`slug,variant_sku\n`, /no product rows/],
        [`slug,variant_sku\n"broken,1\n`, /never closed/],
      ];
      for (const [csv, expected] of cases) {
        const { report } = (await validate(csv)).body;
        expect(report.ok, csv).toBe(false);
        expect(report.errors.map((e: { message: string }) => e.message).join(" "), csv).toMatch(expected);
      }
      expect((await owner().post("/api/products/import/validate", { csv: "" })).status).toBe(400);
    });

    it("warns about columns it ignores and attributes the type doesn't have", async () => {
      const csv = sheet([newProduct("warn", { images: "http://x/y.png", "attr:notAField": "z", status: "PUBLISHED" })]);
      const { report } = (await validate(csv)).body;
      expect(report.ok).toBe(true);
      expect(report.ignoredColumns).toContain("images");
      const text = report.warnings.map((w: { message: string }) => w.message).join(" ");
      expect(text).toMatch(/isn't a field of the/);
      expect(text).toMatch(/always creates draft/);
    });
  });

  describe("importing", () => {
    it("creates a draft product with its type, attributes, materials, and generated SKUs; never publishes", async () => {
      const material = await prisma.material.create({ data: { name: `Vitest Silk ${RUN}` } });
      made.materials.push(material.id);
      const csv = sheet([
        newProduct("new", {
          status: "PUBLISHED",
          description: "<p>Line one,\nwith a comma and a newline</p>",
          materials: `vitest silk ${RUN}:70|Bamboo Blend:30`,
          [`attr:${ATTR.gift}`]: "yes",
        }),
        { slug: slug("new"), variant_sku: "", variant_size: "L", variant_stock: 4 }, // no SKU: one is generated
      ]);
      const res = await commit(csv);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.result).toMatchObject({ created: 1, updated: 0, failed: [] });

      const p = await bySlug(slug("new"));
      expect(p!.status).toBe("DRAFT");
      expect(p!.isActive).toBe(false);
      expect(p!.typeId).toBe(typeId);
      expect(p!.description).toBe("<p>Line one,\nwith a comma and a newline</p>");
      expect(p!.variants.map((v) => [v.size, v.stock])).toEqual([["M", 5], ["L", 4]]);
      expect(p!.variants[0]!.sku).toBe(sku("new-M"));
      expect(p!.variants[1]!.sku).toContain(TYPE_CODE); // generated from the store's pattern for this type
      const attrs = Object.fromEntries(p!.attributeValues.map((a) => [a.definition.key, a.valueText ?? a.valueNumber?.toString() ?? a.valueBoolean]));
      expect(attrs).toEqual({ [ATTR.finish]: "Matte", [ATTR.pieces]: "2", [ATTR.gift]: true });
      expect(p!.materials.map((m) => [m.material?.name ?? m.customName, Number(m.percentage)])).toEqual([[`Vitest Silk ${RUN}`, 70], ["Bamboo Blend", 30]]);
      // Opening stock is in the ledger, like any product created in the editor.
      const moves = await prisma.stockMovement.findMany({ where: { variantId: { in: p!.variants.map((v) => v.id) } } });
      expect(moves.reduce((sum, m) => sum + m.change, 0)).toBe(9);
    });

    it("stops everything on an error, unless told to skip the bad products", async () => {
      const csv = sheet([newProduct("good"), newProduct("bad", { base_price: "nope" })]);
      const blocked = await commit(csv);
      expect(blocked.status).toBe(422);
      expect(blocked.body.details.report.summary.invalid).toBe(1);
      expect(await bySlug(slug("good"))).toBeNull(); // nothing was written

      const partial = await commit(csv, true);
      expect(partial.status, JSON.stringify(partial.body)).toBe(200);
      expect(partial.body.result).toMatchObject({ created: 1, skipped: 1 });
      expect(await bySlug(slug("good"))).not.toBeNull();
      expect(await bySlug(slug("bad"))).toBeNull();
    });

    it("won't import a file-level problem even with skipInvalid", async () => {
      const res = await commit(`name,base_price\nA,5\n`, true);
      expect(res.status).toBe(422);
    });

    it("records one batch entry in the audit trail", async () => {
      await commit(sheet([newProduct("audit")]));
      await new Promise((r) => setTimeout(r, 200));
      const row = await prisma.auditLog.findFirst({ where: { adminId: ownerId, action: "products.imported" }, orderBy: { createdAt: "desc" } });
      expect(row?.metadata).toMatchObject({ created: 1, updated: 0 });
    });
  });

  describe("updating existing products", () => {
    async function seedProduct(label: string) {
      const res = await owner().post("/api/products", {
        name: `Vitest Import ${label} ${RUN}`,
        slug: slug(label),
        categoryId,
        typeId,
        basePrice: 1000,
        brand: "Original Brand",
        description: "<p>Original description</p>",
        attributes: { [ATTR.finish]: "Glossy", sizeGuide: { enabled: true, columns: ["Size", "Chest"], rows: [["M", "40"]] } },
        faqs: [{ question: "Kept?", answer: "Yes" }],
        sections: [{ sectionKey: "highlights", enabled: true, content: "Kept highlight" }],
        variants: [
          { sku: sku(`${label}-M`), size: "M", stock: 5, price: 900 },
          { sku: sku(`${label}-L`), size: "L", stock: 6 },
        ],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.product as { id: string; variants: { id: string; sku: string }[] };
    }

    it("changes only what the file states, keeps everything a CSV can't carry, and never renames the slug", async () => {
      const p = await seedProduct("upd");
      const csv = sheet([
        { slug: slug("upd"), name: `Vitest Import Renamed ${RUN}`, base_price: 1100, variant_sku: sku("upd-M"), variant_stock: 9 },
        { slug: slug("upd"), variant_sku: sku("upd-XL"), variant_size: "S", variant_stock: 2 }, // a new variant
      ]);
      const dry = (await validate(csv)).body.report;
      expect(dry.summary).toMatchObject({ create: 0, update: 1, unchanged: 0 });
      expect(dry.items[0].changes.join("\n")).toMatch(/name: .* → Vitest Import Renamed/);
      expect(dry.items[0].changes.join("\n")).toMatch(/base_price: 1000 → 1100/);
      expect(dry.items[0].changes.join("\n")).toMatch(/variant .*upd-M: stock 5 → 9/);

      const res = await commit(csv);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.result).toMatchObject({ created: 0, updated: 1, failed: [] });

      const after = (await owner().get(`/api/products/${p.id}`)).body.product;
      expect(after.slug).toBe(slug("upd")); // a rename must not break the product's URL
      expect(after.name).toBe(`Vitest Import Renamed ${RUN}`);
      expect(Number(after.basePrice)).toBe(1100);
      expect(after.brand).toBe("Original Brand"); // not in the file → unchanged
      expect(after.description).toBe("<p>Original description</p>");
      expect(after.attributes[ATTR.finish]).toBe("Glossy");
      expect(after.attributes.sizeGuide).toMatchObject({ enabled: true }); // the size guide isn't a CSV column and must survive
      expect(after.faqs).toEqual([{ question: "Kept?", answer: "Yes" }]);
      expect(after.sectionOverrides.map((s: { sectionKey: string }) => s.sectionKey)).toEqual(["highlights"]);
      const variants = Object.fromEntries(after.variants.map((v: { sku: string; stock: number; price: string | null }) => [v.sku, v]));
      expect(Object.keys(variants).sort()).toEqual([sku("upd-L"), sku("upd-M"), sku("upd-XL")]); // nothing removed, one added
      expect(variants[sku("upd-M")].stock).toBe(9);
      expect(Number(variants[sku("upd-M")].price)).toBe(900); // untouched fields of a touched variant
      expect(variants[sku("upd-L")].stock).toBe(6);

      const moves = await prisma.stockMovement.findMany({ where: { variantId: variants[sku("upd-M")].id, reason: "ADJUSTMENT" } });
      expect(moves.map((m) => [m.change, m.note])).toEqual([[4, "Changed by CSV import"]]);
    });

    it("leaves a product alone when the file matches it", async () => {
      const p = await seedProduct("same");
      const before = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
      const csv = sheet([{ slug: slug("same"), name: `Vitest Import same ${RUN}`, base_price: 1000, variant_sku: sku("same-M"), variant_stock: 5 }]);
      const { report } = (await validate(csv)).body;
      expect(report.summary).toMatchObject({ update: 0, unchanged: 1 });
      const res = await commit(csv);
      expect(res.body.result).toMatchObject({ created: 0, updated: 0, skipped: 1 });
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).updatedAt).toEqual(before.updatedAt);
    });

    it("refuses to change a product's type, or touch one in Trash", async () => {
      const p = await seedProduct("guard");
      const other = await prisma.productTypeDef.findUniqueOrThrow({ where: { key: "CLOTHING" } });
      const changeType = (await validate(sheet([{ slug: slug("guard"), product_type: other.key, variant_sku: sku("guard-M") }]))).body.report;
      expect(changeType.errors[0].message).toMatch(/can't change an existing product's type/);

      await owner().delete(`/api/products/${p.id}`);
      const trashed = (await validate(sheet([{ slug: slug("guard"), base_price: 1, variant_sku: sku("guard-M") }]))).body.report;
      expect(trashed.errors[0].message).toMatch(/in Trash/);
    });
  });

  describe("export", () => {
    it("writes one row per variant, product columns on the first, and defuses spreadsheet formulas", async () => {
      const evil = `=HYPERLINK("http://evil.example","click")`;
      await commit(sheet([newProduct("fx", { name: evil, brand: "+cmd", short_description: "@SUM(A1)" }), { slug: slug("fx"), variant_sku: sku("fx-L"), variant_size: "L", variant_stock: 1 }]));

      const res = await owner().get(`/api/products/export/full?typeId=${typeId}`);
      const rows = parseCsv(res.text);
      const header = rows[0]!.cells;
      const mine = rows.filter((r) => r.cells[header.indexOf("slug")] === slug("fx"));
      expect(mine).toHaveLength(2);
      expect(mine[0]!.cells[header.indexOf("name")]).toBe(`'${evil}`); // stored with an apostrophe guard…
      expect(mine[0]!.cells[header.indexOf("brand")]).toBe("'+cmd");
      expect(mine[1]!.cells[header.indexOf("name")]).toBe(""); // product columns only on the first row
      expect(mine[1]!.cells[header.indexOf("variant_sku")]).toBe(sku("fx-L"));
      // …and no text cell anywhere in the file starts with a formula character.
      for (const r of rows.slice(1)) for (const c of r.cells) expect(/^[=+\-@\t\r]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c)).toBe(false);
      // The apostrophe is the file's, not the product's.
      expect((await bySlug(slug("fx")))!.name).toBe(evil);
    });

    it("exports the products of one type and imports straight back as 'nothing to change'", async () => {
      const exported = (await owner().get(`/api/products/export/full?typeId=${typeId}`)).text;
      const slugsInFile = new Set(parseCsv(exported).slice(1).map((r) => r.cells[0]));
      expect(slugsInFile.size).toBeGreaterThan(3);

      const { report } = (await validate(exported)).body;
      expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
      expect(report.summary).toMatchObject({ create: 0, update: 0, unchanged: slugsInFile.size, invalid: 0 });

      // And it survives a spreadsheet's semicolon-and-BOM habits: same file, different dress.
      const semicolons = exported.replace(/^\ufeff/, "").split("\r\n")[0]!.includes(",") ? exported.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ";") : exported;
      const { report: again } = (await validate(semicolons)).body;
      expect(again.summary.unchanged).toBe(slugsInFile.size);
    });
  });
});
