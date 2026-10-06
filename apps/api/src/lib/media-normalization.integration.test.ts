import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../config/prisma";
import { applyMediaNormalization, planMediaNormalization, revertMediaNormalization } from "./media-normalization";

// Phase 1B: the controlled, reversible migration of legacy absolute upload URLs — against the disposable test database.
// A host unique to this run means the plan can only ever touch the rows this test wrote.

const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const HOST = `media-${RUN}.example`;
const OTHER = `other-${RUN}.example`;
const abs = (path: string, host = HOST) => `https://${host}/uploads/${path}`;

let bannerId = "";
let sectionId = "";
let templateId = "";
const globalKey = `media-test-${RUN}`;

beforeAll(async () => {
  bannerId = (
    await prisma.banner.create({ data: { imageUrl: abs("banners/a.webp"), mobileImageUrl: abs("banners/a-m.webp", OTHER), title: `t-${RUN}`, isActive: false } })
  ).id;
  sectionId = (
    await prisma.homepageSection.create({
      data: { type: "PROMO_BANNER", isActive: false, config: { heading: "Sale", imageUrl: abs("homepage/b.webp"), link: `https://${HOST}/category/shoes` } },
    })
  ).id;
  templateId = (await prisma.productTemplate.create({ data: { name: `media-test-${RUN}`, requiredChecks: [abs("editor/c.webp"), "plain"] } })).id;
  await prisma.globalSection.create({ data: { sectionKey: globalKey, content: `<p><img src="${abs("editor/d.webp")}"> and <a href="https://${HOST}/terms">terms</a></p>` } });
});

afterAll(async () => {
  await prisma.banner.deleteMany({ where: { id: bannerId } });
  await prisma.homepageSection.deleteMany({ where: { id: sectionId } });
  await prisma.productTemplate.deleteMany({ where: { id: templateId } });
  await prisma.globalSection.deleteMany({ where: { sectionKey: globalKey } });
});

describe("media normalization", () => {
  it("plans without writing: text, JSON, text-array and HTML cells on the listed host only", async () => {
    const plan = await planMediaNormalization(prisma, [HOST]);
    const touched = plan.changes.map((c) => `${c.table}.${c.column}`).sort();
    expect(touched).toEqual(["Banner.imageUrl", "GlobalSection.content", "HomepageSection.config", "ProductTemplate.requiredChecks"]);
    // Nothing written yet.
    expect((await prisma.banner.findUniqueOrThrow({ where: { id: bannerId } })).imageUrl).toBe(abs("banners/a.webp"));
    await expect(planMediaNormalization(prisma, [])).rejects.toThrow(/at least one host/);
  });

  it("applies in one transaction, then reverts exactly", async () => {
    const plan = await planMediaNormalization(prisma, [HOST]);
    const { written, skipped } = await applyMediaNormalization(prisma, plan);
    expect(written).toHaveLength(4);
    expect(skipped).toHaveLength(0);

    const banner = await prisma.banner.findUniqueOrThrow({ where: { id: bannerId } });
    expect(banner.imageUrl).toBe("/uploads/banners/a.webp");
    expect(banner.mobileImageUrl).toBe(abs("banners/a-m.webp", OTHER)); // another host: untouched
    const section = await prisma.homepageSection.findUniqueOrThrow({ where: { id: sectionId } });
    expect(section.config).toEqual({ heading: "Sale", imageUrl: "/uploads/homepage/b.webp", link: `https://${HOST}/category/shoes` });
    const template = await prisma.productTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.requiredChecks).toEqual(["/uploads/editor/c.webp", "plain"]);
    const global = await prisma.globalSection.findUniqueOrThrow({ where: { sectionKey: globalKey } });
    expect(global.content).toBe(`<p><img src="/uploads/editor/d.webp"> and <a href="https://${HOST}/terms">terms</a></p>`);

    // Idempotent: a second plan finds nothing left on this host.
    expect((await planMediaNormalization(prisma, [HOST])).changes).toHaveLength(0);

    const reverted = await revertMediaNormalization(prisma, written);
    expect(reverted.written).toHaveLength(4);
    expect((await prisma.banner.findUniqueOrThrow({ where: { id: bannerId } })).imageUrl).toBe(abs("banners/a.webp"));
    expect((await prisma.productTemplate.findUniqueOrThrow({ where: { id: templateId } })).requiredChecks).toEqual([abs("editor/c.webp"), "plain"]);
    expect((await prisma.homepageSection.findUniqueOrThrow({ where: { id: sectionId } })).config).toMatchObject({ imageUrl: abs("homepage/b.webp") });
  });

  it("never overwrites a cell edited after the plan was taken", async () => {
    const plan = await planMediaNormalization(prisma, [HOST]);
    await prisma.banner.update({ where: { id: bannerId }, data: { imageUrl: abs("banners/replaced.webp") } });
    const { written, skipped } = await applyMediaNormalization(prisma, plan);
    expect(skipped.map((c) => c.table)).toEqual(["Banner"]);
    expect((await prisma.banner.findUniqueOrThrow({ where: { id: bannerId } })).imageUrl).toBe(abs("banners/replaced.webp"));
    await revertMediaNormalization(prisma, written);
  });
});
