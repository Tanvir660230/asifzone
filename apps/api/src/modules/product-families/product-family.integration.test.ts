import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { asOwner, cleanupFixtures, createStockedProduct, RUN } from "../../test-fixtures";

// Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3): links between existing products, made by hand in admin.

const pub = (productId: string) => request(app).get(`/api/product-families/for/${productId}`);
const familyIds: string[] = [];
let viewerId: string;

beforeAll(async () => {
  viewerId = (await prisma.adminUser.create({ data: { name: "Vitest Viewer", email: `vt_fam_viewer_${RUN}@example.com`, passwordHash: "x", role: "FINANCE_VIEWER" } })).id;
});

afterAll(async () => {
  await prisma.productFamily.deleteMany({ where: { id: { in: familyIds } } });
  await prisma.adminUser.deleteMany({ where: { id: viewerId } });
  await cleanupFixtures();
});

async function create(name: string, productIds: string[], status: number, labels: Record<string, string> = {}) {
  const owner = await asOwner();
  const res = await owner.post("/api/product-families", { name, members: productIds.map((productId) => ({ productId, label: labels[productId] })) }).expect(status);
  if (res.status === 201) familyIds.push(res.body.family.id);
  return res;
}

describe("product families", () => {
  it("creates a family with its members in the given order, and never changes the products", async () => {
    const [a, b, c] = await Promise.all([createStockedProduct(), createStockedProduct(), createStockedProduct()]);
    const before = await prisma.product.findMany({ where: { id: { in: [a.product.id, b.product.id, c.product.id] } }, orderBy: { id: "asc" } });
    const res = await create(`Haven ${RUN}`, [c.product.id, a.product.id, b.product.id], 201, { [a.product.id]: "Onyx Black" });
    expect(res.body.family.members.map((m: { productId: string }) => m.productId)).toEqual([c.product.id, a.product.id, b.product.id]);
    expect(res.body.family.members[1].label).toBe("Onyx Black");
    const after = await prisma.product.findMany({ where: { id: { in: [a.product.id, b.product.id, c.product.id] } }, orderBy: { id: "asc" } });
    expect(after.map((p) => [p.id, p.status, String(p.basePrice), p.updatedAt.getTime()])).toEqual(before.map((p) => [p.id, p.status, String(p.basePrice), p.updatedAt.getTime()]));

    const list = await (await asOwner()).get("/api/product-families").expect(200);
    expect(list.body.families.find((f: { id: string }) => f.id === res.body.family.id)).toMatchObject({ name: `Haven ${RUN}`, memberCount: 3 });
  });

  it("refuses without catalog.manage, a product listed twice, a material, and a family of one", async () => {
    const [a, b] = await Promise.all([createStockedProduct(), createStockedProduct()]);
    const cookie = [`access_token=${signAccessToken({ adminId: viewerId, role: "FINANCE_VIEWER" })}`, "csrf_token=vitest-csrf"];
    await request(app).post("/api/product-families").set("Cookie", cookie).set("X-CSRF-Token", "vitest-csrf").send({ name: "x", members: [{ productId: a.product.id }, { productId: b.product.id }] }).expect(403);
    await request(app).get("/api/product-families").expect(401);
    await (await create("Twice", [a.product.id, a.product.id], 400));
    await (await create("One", [a.product.id], 400));
    await prisma.product.update({ where: { id: b.product.id }, data: { kind: "MATERIAL", stockUnit: "m", status: "DRAFT", isActive: false } });
    const material = await (await create("Material", [a.product.id, b.product.id], 400));
    expect(material.body.error).toContain(b.product.name);
    await (await create("Missing", [a.product.id, "no-such-product"], 400));
  });

  it("shows a product page only members on sale, keeps a sold-out one as unavailable, and drops a family of one", async () => {
    const [onSale, soldOut, draft, trashed] = await Promise.all([
      createStockedProduct({ stocks: [5] }),
      createStockedProduct({ stocks: [0] }),
      createStockedProduct(),
      createStockedProduct(),
    ]);
    const fam = (await (await create(`Caps ${RUN}`, [onSale.product.id, soldOut.product.id, draft.product.id, trashed.product.id], 201))).body.family;
    await prisma.product.update({ where: { id: draft.product.id }, data: { status: "DRAFT", isActive: false } });
    await prisma.product.update({ where: { id: trashed.product.id }, data: { deletedAt: new Date() } });

    const res = await pub(onSale.product.id).expect(200);
    const family = res.body.families.find((f: { id: string }) => f.id === fam.id);
    expect(family.members.map((m: { productId: string }) => m.productId)).toEqual([onSale.product.id, soldOut.product.id]);
    expect(family.members.map((m: { available: boolean }) => m.available)).toEqual([true, false]);
    expect(family.members[0]).toMatchObject({ slug: onSale.product.slug, price: 500 });
    // "Vitest P1 <run>" starts every member's name, so a tile is called by what sets it apart.
    expect(family.members[0].label).not.toContain("Vitest P1");

    // With the sold-out one gone too, only one is left on sale: the family is not shown at all.
    await prisma.product.update({ where: { id: soldOut.product.id }, data: { status: "DRAFT", isActive: false } });
    const again = await pub(onSale.product.id).expect(200);
    expect(again.body.families.find((f: { id: string }) => f.id === fam.id)).toBeUndefined();
  });

  it("returns every family a product is in, and deleting a family leaves the products", async () => {
    const [a, b, c] = await Promise.all([createStockedProduct(), createStockedProduct(), createStockedProduct()]);
    const one = (await (await create(`Jackets ${RUN}`, [a.product.id, b.product.id], 201))).body.family;
    const two = (await (await create(`Look ${RUN}`, [c.product.id, a.product.id], 201))).body.family;
    const res = await pub(a.product.id).expect(200);
    expect(res.body.families.map((f: { id: string }) => f.id).sort()).toEqual([one.id, two.id].sort());

    const owner = await asOwner();
    await owner.put(`/api/product-families/${one.id}`, { name: `Jackets ${RUN} renamed`, members: [{ productId: b.product.id }, { productId: a.product.id }] }).expect(200);
    expect((await owner.get(`/api/product-families/${one.id}`).expect(200)).body.family.members.map((m: { productId: string }) => m.productId)).toEqual([b.product.id, a.product.id]);

    await owner.delete(`/api/product-families/${one.id}`).expect(204);
    await owner.get(`/api/product-families/${one.id}`).expect(404);
    expect(await prisma.product.count({ where: { id: { in: [a.product.id, b.product.id] } } })).toBe(2);
  });
});
