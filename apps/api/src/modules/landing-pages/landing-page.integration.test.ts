import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, placeOrder, RUN, stockOf } from "../../test-fixtures";

// Campaign landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2): many pages may sell one product; they own no
// stock or prices, a draft is never public, and a published page's address keeps working when it is renamed.

const redirectPaths: string[] = [];
afterAll(async () => {
  await prisma.redirect.deleteMany({ where: { fromPath: { in: redirectPaths } } });
  await cleanupFixtures(); // pages cascade with their product
  await prisma.$disconnect();
});

const pub = (slug: string) => request(app).get(`/api/landing-pages/public/${slug}`);

describe("campaign landing pages", () => {
  it("draft → preview → publish; two pages sell the same variants from the same stock", async () => {
    const { product, variants } = await createStockedProduct({ stocks: [4, 4] });
    const owner = await asOwner();

    // A product's own landing page already lives at its slug.
    await owner.post("/api/landing-pages", { name: "Clash", slug: product.slug, productId: product.id }).expect(409);

    const a = (await owner.post("/api/landing-pages", { name: "Eid A", slug: `vt-eid-a-${RUN}`, productId: product.id, templateKey: "colors" }).expect(201)).body.page;
    expect(a.status).toBe("DRAFT");
    expect(a.content.sections.map((s: { type: string }) => s.type)).toContain("colors");
    await pub(a.slug).expect(404);
    expect((await owner.get(`/api/landing-pages/${a.id}/preview`).expect(200)).body.page.productSlug).toBe(product.slug);

    // Only this product's variants, and the default must be one of them; an old version is refused.
    const content = { ...a.content, variantIds: [variants[1]!.id], defaultSize: variants[1]!.size };
    await owner.put(`/api/landing-pages/${a.id}`, { name: a.name, slug: a.slug, content: { ...content, variantIds: ["nope"] }, version: a.version }).expect(400);
    await owner.put(`/api/landing-pages/${a.id}`, { name: a.name, slug: a.slug, content: { ...content, defaultSize: variants[0]!.size }, version: a.version }).expect(400);
    const saved = (await owner.put(`/api/landing-pages/${a.id}`, { name: a.name, slug: a.slug, content, version: a.version }).expect(200)).body.page;
    await owner.put(`/api/landing-pages/${a.id}`, { name: a.name, slug: a.slug, content, version: a.version }).expect(409);

    // A page without its order form can't be saved.
    const noOrder = { ...content, sections: content.sections.filter((s: { type: string }) => s.type !== "order") };
    await owner.put(`/api/landing-pages/${a.id}`, { name: a.name, slug: a.slug, content: noOrder, version: saved.version }).expect(400);

    await owner.post(`/api/landing-pages/${a.id}/publish`).expect(200);
    const live = (await pub(a.slug).expect(200)).body.page;
    expect(live).toMatchObject({ productSlug: product.slug, content: { variantIds: [variants[1]!.id] } });

    const b = (await owner.post(`/api/landing-pages/${a.id}/duplicate`, { name: "Eid B", slug: `vt-eid-b-${RUN}` }).expect(201)).body.page;
    expect(b.status).toBe("DRAFT");
    expect(b.content.variantIds).toEqual([variants[1]!.id]);
    await owner.post(`/api/landing-pages/${b.id}/publish`).expect(200);

    // An order from either page is an ordinary order of that variant: one stock.
    const before = await stockOf(variants[1]!.id);
    await placeOrder([{ variantId: variants[1]!.id, quantity: 1 }]);
    await placeOrder([{ variantId: variants[1]!.id, quantity: 2 }]);
    expect(await stockOf(variants[1]!.id)).toBe(before - 3);

    // Edits stay in the working copy until published again.
    const cur = (await owner.get(`/api/landing-pages/${a.id}`).expect(200)).body.page;
    const renamed = cur.content.sections.map((s: { type: string; title?: string }) => (s.type === "order" ? { ...s, title: "নতুন শিরোনাম" } : s));
    const edited = (await owner.put(`/api/landing-pages/${a.id}`, { name: cur.name, slug: cur.slug, content: { ...cur.content, sections: renamed }, version: cur.version }).expect(200)).body.page;
    expect(edited.hasUnpublishedChanges).toBe(true);
    const stillLive = (await pub(a.slug)).body.page.content.sections.find((s: { type: string }) => s.type === "order");
    expect(stillLive.title).not.toBe("নতুন শিরোনাম");

    // Renaming a live page's address keeps the old one working.
    const newSlug = `vt-eid-a2-${RUN}`;
    redirectPaths.push(`/lp/${a.slug}`);
    await owner.put(`/api/landing-pages/${a.id}`, { name: cur.name, slug: newSlug, content: edited.content, version: edited.version }).expect(200);
    expect((await prisma.redirect.findUniqueOrThrow({ where: { fromPath: `/lp/${a.slug}` } })).toPath).toBe(`/lp/${newSlug}`);
    await pub(newSlug).expect(200);

    // Unpublish takes it down; only then can it be deleted.
    await owner.delete(`/api/landing-pages/${b.id}`).expect(400);
    await owner.post(`/api/landing-pages/${b.id}/unpublish`).expect(200);
    await pub(b.slug).expect(404);
    await owner.delete(`/api/landing-pages/${b.id}`).expect(204);
  });

  it("can't publish a page for an unpublished product, and a live page disappears when its product is unpublished", async () => {
    const { product } = await createStockedProduct({ stocks: [1], published: false });
    const owner = await asOwner();
    const page = (await owner.post("/api/landing-pages", { name: "Hidden", slug: `vt-hidden-${RUN}`, productId: product.id }).expect(201)).body.page;
    await owner.post(`/api/landing-pages/${page.id}/publish`).expect(400);
    await prisma.product.update({ where: { id: product.id }, data: { status: "PUBLISHED", isActive: true } });
    await owner.post(`/api/landing-pages/${page.id}/publish`).expect(200);
    await pub(page.slug).expect(200);
    await prisma.product.update({ where: { id: product.id }, data: { status: "UNPUBLISHED", isActive: false } });
    await pub(page.slug).expect(404);
  });

  it("a collection page sells several products' variants without changing the products", async () => {
    const { product: main, variants: mainVariants } = await createStockedProduct({ stocks: [3, 3] });
    const { product: extra, variants: extraVariants } = await createStockedProduct({ stocks: [2, 2] });
    const owner = await asOwner();
    const page = (await owner.post("/api/landing-pages", { name: "All jackets", slug: `vt-collection-${RUN}`, productId: main.id, templateKey: "colors" }).expect(201)).body.page;
    const save = (content: object, version: number) => owner.put(`/api/landing-pages/${page.id}`, { name: page.name, slug: page.slug, content: { ...page.content, ...content }, version });

    // The main product can't also be an extra, and an extra can't be listed twice.
    await save({ extraProductIds: [main.id] }, page.version).expect(400);
    await save({ extraProductIds: [extra.id, extra.id] }, page.version).expect(400);

    // Variants may come from the main product or an extra; anything else is refused.
    const { variants: strangers } = await createStockedProduct({ stocks: [1] });
    await save({ extraProductIds: [extra.id], variantIds: [strangers[0]!.id] }, page.version).expect(400);

    // Both products are "Black": the extra's colour is told apart by its product name, and a default may use that label.
    const label = `Black (${extra.name})`;
    const saved = (
      await save({ extraProductIds: [extra.id], displayName: "All jackets", variantIds: [mainVariants[0]!.id, extraVariants[1]!.id], defaultColor: label }, page.version).expect(200)
    ).body.page;
    expect(saved.content).toMatchObject({ extraProductIds: [extra.id], displayName: "All jackets" });

    // Publishing needs every product on the page to be published.
    await prisma.product.update({ where: { id: extra.id }, data: { status: "DRAFT", isActive: false } });
    await owner.post(`/api/landing-pages/${page.id}/publish`).expect(400);
    await prisma.product.update({ where: { id: extra.id }, data: { status: "PUBLISHED", isActive: true } });
    await owner.post(`/api/landing-pages/${page.id}/publish`).expect(200);
    expect((await pub(page.slug).expect(200)).body.page).toMatchObject({ productSlug: main.slug, extraProductSlugs: [extra.slug] });

    // An extra unpublished later drops off the live page; the page itself stays up.
    await prisma.product.update({ where: { id: extra.id }, data: { status: "DRAFT", isActive: false } });
    expect((await pub(page.slug).expect(200)).body.page.extraProductSlugs).toEqual([]);

    // The products themselves are untouched: each still owns its own variants.
    expect(await prisma.productVariant.count({ where: { productId: extra.id } })).toBe(2);
    expect(await prisma.productVariant.count({ where: { productId: main.id } })).toBe(2);
  });

  it("is admin-only", async () => {
    await request(app).get("/api/landing-pages").expect(401);
    await request(app).post("/api/landing-pages").send({}).expect(401);
  });
});
