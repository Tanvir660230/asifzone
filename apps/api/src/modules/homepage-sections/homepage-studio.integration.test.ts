import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import type { Prisma } from "@prisma/client";
import type { StudioSection } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, RUN } from "../../test-fixtures";

// Storefront Studio: the homepage is edited as one autosaved draft (optimistic `version`), validated strictly only on
// publish, which rewrites the live sections in one go and keeps a revision for one-click restore.

const BASE = "/api/homepage-sections/studio";
type Owner = Awaited<ReturnType<typeof asOwner>>;
let owner: Owner;
let liveBefore: Prisma.HomepageSectionCreateManyInput[] = [];
let revisionIdsBefore: string[] = [];
const customerIds: string[] = [];

beforeAll(async () => {
  owner = await asOwner();
  await owner.get("/api/homepage-sections"); // seeds the defaults on an empty store
  liveBefore = (await prisma.homepageSection.findMany()).map((s) => ({ ...s, config: s.config as Prisma.InputJsonValue }));
  revisionIdsBefore = (await prisma.homepageRevision.findMany({ select: { id: true } })).map((r) => r.id);
});

beforeEach(async () => {
  await prisma.homepageDraft.deleteMany({ where: { id: "homepage" } });
});

afterAll(async () => {
  await prisma.homepageDraft.deleteMany({ where: { id: "homepage" } });
  await prisma.homepageRevision.deleteMany({ where: { id: { notIn: revisionIdsBefore } } });
  await prisma.$transaction([
    prisma.homepageSection.deleteMany({ where: { id: { notIn: liveBefore.map((s) => s.id!) } } }),
    ...liveBefore.map(({ id, ...data }) => prisma.homepageSection.upsert({ where: { id: id! }, create: { id, ...data }, update: data })),
  ]);
  await prisma.productReview.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

async function studio() {
  const res = await owner.get(BASE);
  expect(res.status).toBe(200);
  return res.body as { version: number; sections: StudioSection[]; hasDraft: boolean; liveSections: StudioSection[] };
}

/** Saves the draft on top of whatever version the server has now (as the editor does). */
async function save(sections: StudioSection[]) {
  return owner.put(`${BASE}/draft`, { version: (await studio()).version, sections });
}

async function publish() {
  return owner.post(`${BASE}/publish`, { version: (await studio()).version });
}

describe("Storefront Studio draft", () => {
  it("returns the live sections when there is no draft", async () => {
    const body = await studio();
    expect(body.hasDraft).toBe(false);
    expect(body.version).toBe(0);
    expect(body.sections.map((s) => s.id)).toEqual(liveBefore.slice().sort((a, b) => a.sortOrder! - b.sortOrder!).map((s) => s.id));
    expect(body.liveSections).toEqual(body.sections);
  });

  it("needs content.manage", async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it("saves a draft and bumps version", async () => {
    const { sections } = await studio();
    const edited = sections.map((s) => (s.type === "BRAND_STORY" ? { ...s, config: { ...s.config, heading: `Draft ${RUN}` } } : s));
    const res = await owner.put(`${BASE}/draft`, { version: 0, sections: edited });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    const after = await studio();
    expect(after.hasDraft).toBe(true);
    expect(after.sections.find((s) => s.type === "BRAND_STORY")!.config.heading).toBe(`Draft ${RUN}`);
    // The live homepage is untouched until publish.
    expect(after.liveSections.find((s) => s.type === "BRAND_STORY")!.config.heading).not.toBe(`Draft ${RUN}`);
  });

  it("rejects a draft saved against an old version", async () => {
    const { sections } = await studio();
    expect((await owner.put(`${BASE}/draft`, { version: 0, sections })).status).toBe(200);
    const stale = await owner.put(`${BASE}/draft`, { version: 0, sections });
    expect(stale.status).toBe(409);
    expect(stale.body.details.version).toBe(1);
  });

  it("discards the draft", async () => {
    const { sections } = await studio();
    await owner.put(`${BASE}/draft`, { version: 0, sections: sections.slice(1) });
    expect((await owner.delete(`${BASE}/draft`)).status).toBe(204);
    expect((await studio()).hasDraft).toBe(false);
  });
});

describe("Storefront Studio publish", () => {
  it("saves an invalid draft but refuses to publish it", async () => {
    const { sections } = await studio();
    const broken = { id: "new-broken", type: "PRODUCT_CAROUSEL" as const, isActive: true, config: { heading: "", source: "featured", itemCount: 8 }, startsAt: null, endsAt: null };
    expect((await save([...sections, broken])).status).toBe(200);
    const res = await publish();
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details)).toEqual(["new-broken"]);
    expect(await prisma.homepageSection.count({ where: { type: "PRODUCT_CAROUSEL", config: { path: ["heading"], equals: "" } } })).toBe(0);
  });

  it("publishes reorder, a new section and a removed one, and keeps a revision", async () => {
    // Start from a live homepage that has a promo banner to remove.
    const promo = await prisma.homepageSection.create({ data: { type: "PROMO_BANNER", sortOrder: 99, config: { heading: `Old promo ${RUN}` } } });
    const { sections } = await studio();
    const withoutPromo = sections.filter((s) => s.id !== promo.id);
    const text: StudioSection = { id: "new-text-1", type: "RICH_TEXT", isActive: true, config: { heading: `Made to last ${RUN}`, appearance: { spacing: "compact" } }, startsAt: null, endsAt: null };
    const draft = [withoutPromo[1]!, withoutPromo[0]!, text, ...withoutPromo.slice(2)];
    await save(draft);

    const res = await publish();
    expect(res.status).toBe(200);

    const live = await prisma.homepageSection.findMany({ orderBy: { sortOrder: "asc" } });
    expect(live.map((s) => s.type)).toEqual(draft.map((s) => s.type));
    expect(live.find((s) => s.id === promo.id)).toBeUndefined();
    const created = live.find((s) => s.type === "RICH_TEXT")!;
    expect(created.id).not.toBe("new-text-1");
    expect(created.config).toMatchObject({ heading: `Made to last ${RUN}`, appearance: { spacing: "compact" } });

    expect((await studio()).hasDraft).toBe(false);
    const revisions = (await owner.get(`${BASE}/revisions`)).body.revisions as { id: string; sectionCount: number }[];
    expect(revisions[0]!.sectionCount).toBe(draft.length);
    // The public homepage serves the published sections (the cache was cleared).
    const active = await request(app).get("/api/homepage-sections/active");
    expect(active.body.sections.some((s: { type: string }) => s.type === "RICH_TEXT")).toBe(true);
  });

  it("publishes a draft section whose live row is gone", async () => {
    const promo = await prisma.homepageSection.create({ data: { type: "PROMO_BANNER", sortOrder: 99, config: { heading: `Gone ${RUN}` } } });
    const { sections } = await studio();
    await save(sections);
    await prisma.homepageSection.delete({ where: { id: promo.id } });
    expect((await publish()).status).toBe(200);
    expect(await prisma.homepageSection.count({ where: { config: { path: ["heading"], equals: `Gone ${RUN}` } } })).toBe(1);
  });

  it("refuses to publish without a singleton", async () => {
    const { sections } = await studio();
    await save(sections.filter((s) => s.type !== "HERO"));
    const res = await publish();
    expect(res.status).toBe(400);
    expect(await prisma.homepageSection.count({ where: { type: "HERO" } })).toBe(1);
  });

  it("refuses to publish a stale version", async () => {
    const { sections } = await studio();
    await save(sections);
    expect((await owner.post(`${BASE}/publish`, { version: 0 })).status).toBe(409);
  });

  it("keeps a tab opened before a publish from saving over the new page", async () => {
    const { sections, version: openedAt } = await studio();
    await save(sections);
    await publish();
    expect((await owner.put(`${BASE}/draft`, { version: openedAt, sections })).status).toBe(409);
  });

  it("restores a revision into the draft", async () => {
    const { sections } = await studio();
    const renamed = sections.map((s) => (s.type === "BRAND_STORY" ? { ...s, config: { ...s.config, heading: `Restore me ${RUN}` } } : s));
    await save(renamed);
    await publish();
    const [latest] = (await owner.get(`${BASE}/revisions`)).body.revisions as { id: string }[];

    // Change the live page again, then bring the earlier one back as a draft.
    const next = (await studio()).sections.map((s) => (s.type === "BRAND_STORY" ? { ...s, config: { ...s.config, heading: "Something else" } } : s));
    await save(next);
    await publish();

    const res = await owner.post(`${BASE}/revisions/${latest!.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.hasDraft).toBe(true);
    expect(res.body.sections.find((s: StudioSection) => s.type === "BRAND_STORY").config.heading).toBe(`Restore me ${RUN}`);
    expect((await prisma.homepageSection.findFirst({ where: { type: "BRAND_STORY" } }))!.config).toMatchObject({ heading: "Something else" });
  });

  it("refuses a draft section whose type doesn't match its live row", async () => {
    const { sections } = await studio();
    const hero = sections.find((s) => s.type === "HERO")!;
    const story = sections.find((s) => s.type === "BRAND_STORY")!;
    // The two rows' types swapped: both types are still present, but each id now claims the other type.
    const swapped = sections.map((s) => (s.id === hero.id ? { ...s, type: "BRAND_STORY" as const } : s.id === story.id ? { ...s, type: "HERO" as const } : s));
    await save(swapped);
    const res = await publish();
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details).sort()).toEqual([hero.id, story.id].sort());
    expect((await prisma.homepageSection.findUnique({ where: { id: hero.id } }))!.type).toBe("HERO");
  });
});

describe("Storefront Studio concurrency and the older section routes", () => {
  it("answers two simultaneous first saves with one save and one 409, never a 500", async () => {
    const { sections } = await studio();
    const [a, b] = await Promise.all([
      owner.put(`${BASE}/draft`, { version: 0, sections }),
      owner.put(`${BASE}/draft`, { version: 0, sections }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("keeps an open draft in step with edits made through the older section routes", async () => {
    const { sections } = await studio();
    const story = sections.find((s) => s.type === "BRAND_STORY")!;
    await save(sections);
    const before = (await studio()).version;

    const res = await owner.patch(`/api/homepage-sections/${story.id}`, { config: { ...story.config, heading: `Legacy ${RUN}` } });
    expect(res.status).toBe(200);

    const after = await studio();
    // The draft carries the change (so a later publish keeps it) and its version moved (so open editors reload).
    expect(after.sections.find((s) => s.id === story.id)!.config.heading).toBe(`Legacy ${RUN}`);
    expect(after.version).toBeGreaterThan(before);
  });
});

describe("featured reviews", () => {
  it("lists approved reviews with text, newest first, without unapproved or low-rated ones", async () => {
    const { product } = await createStockedProduct();
    const make = async (n: number, rating: number, status: "APPROVED" | "PENDING", body: string) => {
      const c = await prisma.customer.create({ data: { name: "Rahim Uddin", email: `studio-${RUN}-${n}@example.test`, phone: `0181${String(Date.now() + n).slice(-7)}` } });
      customerIds.push(c.id);
      return prisma.productReview.create({ data: { productId: product.id, customerId: c.id, customerName: c.name, rating, status, body } });
    };
    const good = await make(1, 5, "APPROVED", `Lovely fabric ${RUN}`);
    await make(2, 5, "PENDING", `Pending ${RUN}`);
    await make(3, 2, "APPROVED", `Too small ${RUN}`);

    const res = await request(app).get("/api/reviews/featured?count=12&minRating=4");
    expect(res.status).toBe(200);
    const mine = (res.body.reviews as { id: string; body: string; customerName: string; productSlug: string }[]).filter((r) => r.body.endsWith(RUN));
    expect(mine.map((r) => r.id)).toEqual([good.id]);
    expect(mine[0]!.customerName).toBe("Rahim U.");
    expect(mine[0]!.productSlug).toBe(product.slug);
  });
});
