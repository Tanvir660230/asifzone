import { Prisma, type LandingPage } from "@prisma/client";
import {
  landingColorLabels,
  landingPageContentSchema,
  landingTemplateContent,
  type CreateLandingPageInput,
  type DuplicateLandingPageInput,
  type LandingPageContent,
  type LandingPageDetail,
  type LandingPageSummary,
  type PublicLandingPage,
  type SaveLandingPageInput,
  createLandingPageSchema,
  saveLandingPageSchema,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { upsertSlugRedirect } from "../redirects/redirect.service";

/* Campaign landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2). A page stores copy, section order and which of
   one product's variants to offer — never a price or a stock count. /lp/<slug> serves a published page; a slug that is
   no page falls back to the product's automatic landing page, so every existing /lp/<product-slug> link keeps working. */

const withProduct = { product: { select: { name: true, slug: true, status: true } } } satisfies Prisma.LandingPageInclude;
type Row = LandingPage & { product: { name: string; slug: string; status: string } };

const path = (slug: string) => `/lp/${slug}`;

function summary(row: Row): LandingPageSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    templateKey: row.templateKey,
    productId: row.productId,
    productName: row.product.name,
    productSlug: row.product.slug,
    productStatus: row.product.status,
    hasUnpublishedChanges: row.status === "PUBLISHED" && JSON.stringify(row.content) !== JSON.stringify(row.publishedContent),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function detail(row: Row): LandingPageDetail {
  return { ...summary(row), content: row.content as unknown as LandingPageContent, version: row.version };
}

async function load(id: string): Promise<Row> {
  const row = await prisma.landingPage.findUnique({ where: { id }, include: withProduct });
  if (!row) throw AppError.notFound("Landing page not found");
  return row;
}

/** A slug is free when no other page has it, no product's automatic page sits there, and no redirect sends it away. */
async function assertSlugFree(slug: string, exceptId?: string) {
  const [page, product, redirect] = await Promise.all([
    prisma.landingPage.findFirst({ where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } }),
    prisma.product.findUnique({ where: { slug }, select: { id: true } }),
    prisma.redirect.findFirst({ where: { fromPath: path(slug), isActive: true }, select: { toPath: true } }),
  ]);
  if (page) throw AppError.conflict("Another landing page already uses this address");
  if (product) throw AppError.conflict("A product's own landing page already uses this address — choose another");
  if (redirect) throw AppError.conflict(`This address redirects to ${redirect.toPath} (Settings › Redirects) — choose another`);
}

const productIdsOf = (content: LandingPageContent) => [content.productId, ...(content.extraProductIds ?? [])];

/** The content, checked against the products it names: sold products, each once, and variants that are their own. A
 * collection page's products must also agree on stock tracking, since the page's picker reads one rule for all. */
async function assertContent(content: LandingPageContent) {
  const extraIds = content.extraProductIds ?? [];
  if (extraIds.includes(content.productId)) throw AppError.badRequest("The page's main product is already on it — remove it from the other products");
  const rows = await prisma.product.findMany({
    where: { id: { in: productIdsOf(content) } },
    select: { id: true, name: true, kind: true, deletedAt: true, trackInventory: true, variants: { select: { id: true, size: true, color: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const products = productIdsOf(content).map((id) => byId.get(id));
  const main = products[0];
  if (!main || main.deletedAt) throw AppError.badRequest("The chosen product doesn't exist or is in Trash");
  for (const p of products) {
    if (!p || p.deletedAt) throw AppError.badRequest("One of the page's products doesn't exist or is in Trash — remove it");
    if (p.kind !== "FINISHED") throw AppError.badRequest(`“${p.name}” is a material — it can't be sold on a landing page`);
    if (p.trackInventory !== main.trackInventory) throw AppError.badRequest(`“${p.name}” counts stock differently from “${main.name}” — a page's products must all track stock, or all not`);
  }
  const all = (products as NonNullable<(typeof products)[number]>[]).flatMap((p) => p.variants);
  const own = new Set(all.map((v) => v.id));
  const foreign = content.variantIds.filter((id) => !own.has(id));
  if (foreign.length) throw AppError.badRequest("Some chosen variants don't belong to this page's products — pick them again");
  const labels = landingColorLabels(products as NonNullable<(typeof products)[number]>[]);
  const offered = content.variantIds.length ? all.filter((v) => content.variantIds.includes(v.id)) : all;
  if (content.defaultColor && !offered.some((v) => (labels.get(v.id) ?? v.color) === content.defaultColor)) throw AppError.badRequest("The default colour isn't one this page offers");
  if (content.defaultSize && !offered.some((v) => v.size === content.defaultSize)) throw AppError.badRequest("The default size isn't one this page offers");
}

/** A collection page's other products that are on sale, as slugs in the page's order. */
async function liveExtraSlugs(content: LandingPageContent, onlyPublished: boolean): Promise<string[]> {
  const ids = content.extraProductIds ?? [];
  if (!ids.length) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, deletedAt: null, ...(onlyPublished ? { status: "PUBLISHED" } : {}) },
    select: { id: true, slug: true },
  });
  const slugById = new Map(rows.map((r) => [r.id, r.slug]));
  return ids.map((id) => slugById.get(id)).filter((s): s is string => Boolean(s));
}

export async function listLandingPages(): Promise<LandingPageSummary[]> {
  const rows = await prisma.landingPage.findMany({ include: withProduct, orderBy: [{ updatedAt: "desc" }] });
  return rows.map(summary);
}

export async function getLandingPage(id: string): Promise<LandingPageDetail> {
  return detail(await load(id));
}

export async function createLandingPage(raw: CreateLandingPageInput, adminId: string, ip?: string): Promise<LandingPageDetail> {
  const input = createLandingPageSchema.parse(raw);
  await assertSlugFree(input.slug);
  const content = landingTemplateContent(input.templateKey, input.productId);
  await assertContent(content);
  const row = await createRow({ name: input.name, slug: input.slug, productId: input.productId, templateKey: input.templateKey, content, createdById: adminId });
  recordAudit({ adminId, action: "landing_page.created", entityType: "LandingPage", entityId: row.id, metadata: { slug: row.slug, template: input.templateKey }, ipAddress: ip });
  return detail(row);
}

async function createRow(data: { name: string; slug: string; productId: string; templateKey: string | null; content: LandingPageContent; createdById: string }) {
  try {
    return await prisma.landingPage.create({
      data: { ...data, content: data.content as unknown as Prisma.InputJsonValue, updatedById: data.createdById },
      include: withProduct,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw AppError.conflict("Another landing page already uses this address");
    throw err;
  }
}

/** Saves the working copy. A published page keeps showing what was published until Publish; only a slug change applies at
 * once (with a redirect from the old address, so ads already running keep landing). */
export async function saveLandingPage(id: string, raw: SaveLandingPageInput, adminId: string): Promise<LandingPageDetail> {
  const input = saveLandingPageSchema.parse(raw);
  const existing = await load(id);
  if (input.version !== existing.version) throw AppError.conflict("This page was changed somewhere else — reload to see the latest before saving");
  if (input.slug !== existing.slug) await assertSlugFree(input.slug, id);
  await assertContent(input.content);

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.landingPage.updateMany({
      where: { id, version: existing.version },
      data: {
        name: input.name,
        slug: input.slug,
        productId: input.content.productId,
        content: input.content as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedById: adminId,
      },
    });
    if (updated.count === 0) throw AppError.conflict("This page was changed somewhere else — reload to see the latest before saving");
    if (input.slug !== existing.slug && existing.status === "PUBLISHED") await upsertSlugRedirect(tx, path(existing.slug), path(input.slug));
    return tx.landingPage.findUniqueOrThrow({ where: { id }, include: withProduct });
  });
  return detail(row);
}

export async function publishLandingPage(id: string, adminId: string, ip?: string): Promise<LandingPageDetail> {
  const existing = await load(id);
  const content = landingPageContentSchema.parse(existing.content);
  await assertContent(content);
  if (existing.product.status !== "PUBLISHED") throw AppError.badRequest(`Publish “${existing.product.name}” first — a landing page can only sell a published product`);
  if (content.extraProductIds.length) {
    const hidden = await prisma.product.findFirst({ where: { id: { in: content.extraProductIds }, status: { not: "PUBLISHED" } }, select: { name: true } });
    if (hidden) throw AppError.badRequest(`Publish “${hidden.name}” first, or remove it from the page — a landing page can only sell published products`);
  }
  const row = await prisma.landingPage.update({
    where: { id },
    data: { status: "PUBLISHED", publishedContent: content as unknown as Prisma.InputJsonValue, publishedAt: new Date(), publishedById: adminId, content: content as unknown as Prisma.InputJsonValue },
    include: withProduct,
  });
  recordAudit({ adminId, action: "landing_page.published", entityType: "LandingPage", entityId: id, metadata: { slug: row.slug }, ipAddress: ip });
  return detail(row);
}

/** Takes the page off the site (its address then shows "not found"); the working copy and design are kept. */
export async function unpublishLandingPage(id: string, adminId: string, ip?: string): Promise<LandingPageDetail> {
  await load(id);
  const row = await prisma.landingPage.update({ where: { id }, data: { status: "DRAFT", publishedContent: Prisma.DbNull }, include: withProduct });
  recordAudit({ adminId, action: "landing_page.unpublished", entityType: "LandingPage", entityId: id, metadata: { slug: row.slug }, ipAddress: ip });
  return detail(row);
}

/** A draft copy for a new campaign — same product, sections and copy; its own address. */
export async function duplicateLandingPage(id: string, input: DuplicateLandingPageInput, adminId: string, ip?: string): Promise<LandingPageDetail> {
  const source = await load(id);
  await assertSlugFree(input.slug);
  const row = await createRow({
    name: input.name,
    slug: input.slug,
    productId: source.productId,
    templateKey: source.templateKey,
    content: source.content as unknown as LandingPageContent,
    createdById: adminId,
  });
  recordAudit({ adminId, action: "landing_page.duplicated", entityType: "LandingPage", entityId: row.id, metadata: { from: id, slug: row.slug }, ipAddress: ip });
  return detail(row);
}

/** Only an unpublished page can be deleted: a live address is taken down with Unpublish first. */
export async function deleteLandingPage(id: string, adminId: string, ip?: string) {
  const existing = await load(id);
  if (existing.status === "PUBLISHED") throw AppError.badRequest("Unpublish the page before deleting it");
  await prisma.landingPage.delete({ where: { id } });
  recordAudit({ adminId, action: "landing_page.deleted", entityType: "LandingPage", entityId: id, metadata: { slug: existing.slug, name: existing.name }, ipAddress: ip });
}

/** The live page at an address, for the storefront — null when there is none (the route then tries the product). */
export async function getPublicLandingPage(slug: string): Promise<PublicLandingPage | null> {
  const row = await prisma.landingPage.findUnique({ where: { slug } });
  if (!row || row.status !== "PUBLISHED" || !row.publishedContent) return null;
  const content = row.publishedContent as unknown as LandingPageContent;
  const product = await prisma.product.findUnique({ where: { id: content.productId }, select: { slug: true, status: true, deletedAt: true } });
  if (!product || product.deletedAt || product.status !== "PUBLISHED") return null;
  // An extra product unpublished after the page went live simply drops off it; the page stays up for the others.
  return { id: row.id, name: row.name, slug: row.slug, productSlug: product.slug, extraProductSlugs: await liveExtraSlugs(content, true), content };
}

/** The working copy, rendered as the live page would be — the editor's preview (unpublished extras included, so the
 * admin sees the whole page before publishing it). */
export async function getPreviewLandingPage(id: string): Promise<PublicLandingPage & { productStatus: string }> {
  const row = await load(id);
  const content = row.content as unknown as LandingPageContent;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    productSlug: row.product.slug,
    productStatus: row.product.status,
    extraProductSlugs: await liveExtraSlugs(content, false),
    content,
  };
}
