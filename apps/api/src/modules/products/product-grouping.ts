import { Prisma, type ProductStatus, type StockPolicy } from "@prisma/client";
import {
  productGroupingSchema,
  type GroupingPlan,
  type GroupingVariantPlan,
  type ProductGroupingInput,
  type ProductGroupingSummary,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { invalidateCache } from "./product.service";

/* Grouping separate products into one parent (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §1).

   A variant is the unit everything else hangs on — stock, stock movements, valuation, purchase and production lines,
   order lines (which also snapshot name/SKU/size/colour) — so grouping MOVES variants (`productId` changes) and never
   copies or re-creates one: ids, SKUs, stock and history stay exactly as they were. What a variant inherited from its
   old product (price, compare-at, cost, free delivery, sold-out, stock policy, "not for sale") is pinned on the variant
   when the parent would say otherwise, so nothing sells at a different price after the move. Every change is recorded
   in the grouping's snapshot, and Undo puts each one back. */

type Money = string | null;

/** What the grouping changed, field by field — the only input Undo needs. */
interface GroupingSnapshot {
  variants: {
    id: string;
    productId: string;
    size: string;
    color: string;
    colorHex: string | null;
    price: Money;
    compareAtPrice: Money;
    costPrice: Money;
    freeDelivery: boolean | null;
    markedSoldOut: boolean;
    stockPolicy: StockPolicy | null;
    isActive: boolean;
    sortOrder: number;
    imageId: string | null;
  }[];
  images: { id: string; productId: string; sortOrder: number }[];
  /** VariantImage rows the grouping added so each colour shows its own photos. */
  variantImageIds: string[];
  reviewIds: { id: string; productId: string }[];
  sources: { id: string; status: ProductStatus; isActive: boolean }[];
  /** Each redirect as it was before (null = there was none). */
  redirects: { fromPath: string; before: { toPath: string; statusCode: number; isActive: boolean } | null }[];
}

const productSelect = {
  id: true,
  name: true,
  slug: true,
  kind: true,
  status: true,
  isActive: true,
  deletedAt: true,
  categoryId: true,
  basePrice: true,
  compareAtPrice: true,
  costPrice: true,
  taxRate: true,
  trackInventory: true,
  fillToOrder: true,
  freeDelivery: true,
  markedSoldOut: true,
  stockPolicy: true,
  variants: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      sku: true,
      size: true,
      color: true,
      colorHex: true,
      price: true,
      compareAtPrice: true,
      costPrice: true,
      freeDelivery: true,
      markedSoldOut: true,
      stockPolicy: true,
      isActive: true,
      sortOrder: true,
      stock: true,
      imageId: true,
      _count: { select: { images: true } },
    },
  },
  images: { orderBy: { sortOrder: "asc" }, select: { id: true, productId: true, sortOrder: true } },
} satisfies Prisma.ProductSelect;
type Loaded = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

const str = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());
const same = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => (a === null || b === null ? a === b : a.equals(b));
const comboKey = (size: string, color: string) => `${size}\u0000${color}`;

interface Prepared {
  plan: GroupingPlan;
  parent: Loaded;
  sources: Loaded[];
  /** Per moved variant: the data to write. */
  writes: { variantId: string; data: Prisma.ProductVariantUpdateInput }[];
}

/** Works out the grouping without writing anything — the admin's preview, and the commit's own re-check under lock. */
async function prepare(raw: ProductGroupingInput, db: Prisma.TransactionClient | typeof prisma): Promise<Prepared> {
  const input = productGroupingSchema.parse(raw);
  const blockers: string[] = [];
  const notes: string[] = [];

  const ids = input.sources.map((s) => s.productId);
  if (new Set(ids).size !== ids.length) blockers.push("A product is listed twice.");
  if (ids.includes(input.parentId)) blockers.push("The parent can't also be folded into itself.");

  const rows = await db.product.findMany({ where: { id: { in: [input.parentId, ...ids] } }, select: productSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parent = byId.get(input.parentId);
  if (!parent) throw AppError.notFound("Parent product not found");
  if (parent.deletedAt) blockers.push(`${parent.name} is in Trash — restore it before grouping into it.`);
  if (parent.kind !== "FINISHED") blockers.push(`${parent.name} is a material, not a product that is sold.`);
  if (parent.fillToOrder) blockers.push(`${parent.name} is filled to order; grouping is for ready-made stock only.`);

  const sources: Loaded[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) {
      blockers.push(`A chosen product no longer exists (${id}).`);
      continue;
    }
    sources.push(s);
  }

  const now = new Date();
  const [boms, productionOrders, flashItems, couponLinks, landingPages] = await Promise.all([
    db.billOfMaterials.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _count: true }),
    db.productionOrder.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _count: true }),
    db.flashSaleItem.findMany({ where: { productId: { in: ids }, flashSale: { endsAt: { gt: now } } }, select: { productId: true } }),
    db.couponProduct.findMany({
      where: { productId: { in: ids }, coupon: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
      select: { productId: true },
    }),
    db.landingPage.findMany({ where: { productId: { in: ids } }, select: { productId: true, name: true } }),
  ]);
  const has = (list: { productId: string }[], id: string) => list.some((r) => r.productId === id);

  for (const s of sources) {
    const label = `“${s.name}”`;
    if (s.deletedAt) blockers.push(`${label} is in Trash.`);
    if (s.kind !== "FINISHED") blockers.push(`${label} is a material.`);
    if (s.fillToOrder) blockers.push(`${label} is filled to order; grouping is for ready-made stock only.`);
    if (s.variants.length === 0) blockers.push(`${label} has no variants left to move (already grouped?).`);
    if (s.trackInventory !== parent.trackInventory) blockers.push(`${label} ${s.trackInventory ? "tracks" : "doesn't track"} stock but the parent ${parent.trackInventory ? "does" : "doesn't"}.`);
    if (!same(s.taxRate, parent.taxRate)) blockers.push(`${label} has a different tax rate from the parent.`);
    if (has(boms, s.id) || has(productionOrders, s.id)) blockers.push(`${label} has a bill of materials or production orders — its manufacturing history stays with it.`);
    if (has(flashItems, s.id)) blockers.push(`${label} is in a flash sale that hasn't ended — take it out (or let the sale end) first, so no price changes.`);
    if (has(couponLinks, s.id)) blockers.push(`${label} is named by an active coupon — remove it from the coupon first, so no discount changes.`);
    const pages = landingPages.filter((p) => p.productId === s.id);
    if (pages.length) blockers.push(`${label} has campaign landing pages (${pages.map((p) => p.name).join(", ")}) — point them at the parent first.`);
    if (s.categoryId !== parent.categoryId) notes.push(`${label} is in a different category; its variants will be listed in the parent's.`);
  }

  // Where each moved variant lands, and what it must carry with it to keep selling exactly as before.
  const taken = new Map(parent.variants.map((v) => [comboKey(v.size, v.color), parent.name]));
  let sortOrder = Math.max(-1, ...parent.variants.map((v) => v.sortOrder)) + 1;
  const variants: GroupingVariantPlan[] = [];
  const writes: Prepared["writes"] = [];
  let pinned = 0;
  const renamedSizes = new Set<string>();

  for (const choice of input.sources) {
    const s = byId.get(choice.productId);
    if (!s) continue;
    const colors = new Set(s.variants.map((v) => v.color));
    if (choice.color && colors.size > 1) {
      blockers.push(`“${s.name}” has ${colors.size} colours, so it can't be given one colour name.`);
      continue;
    }
    const sellable = s.status === "PUBLISHED" && s.isActive;
    for (const v of s.variants) {
      const size = input.sizeRenames[v.size] ?? v.size;
      if (size !== v.size) renamedSizes.add(v.size);
      const color = choice.color ?? v.color;
      const key = comboKey(size, color);
      const clash = taken.get(key);
      if (clash) blockers.push(`Two variants would both be ${[size, color].filter(Boolean).join(" / ")} (${clash} and “${s.name}”) — give one of them a different colour name.`);
      taken.set(key, `“${s.name}”`);

      const data: Prisma.ProductVariantUpdateInput = { product: { connect: { id: parent.id } }, sortOrder: sortOrder++ };
      if (size !== v.size) data.size = size;
      if (color !== v.color) data.color = color;
      if (choice.colorHex !== undefined && choice.colorHex !== v.colorHex) data.colorHex = choice.colorHex;
      // Pin what the variant inherited from its old product wherever the parent would give it something else.
      if (v.price === null && !same(s.basePrice, parent.basePrice)) data.price = s.basePrice;
      if (v.compareAtPrice === null && !same(s.compareAtPrice, parent.compareAtPrice)) {
        // No "was" price of its own: null would inherit the parent's and show a discount that never existed, so it is
        // pinned to the variant's own selling price — a "was" that isn't above the price is never struck through.
        data.compareAtPrice = s.compareAtPrice ?? v.price ?? s.basePrice;
      }
      if (v.costPrice === null && !same(s.costPrice, parent.costPrice) && s.costPrice !== null) data.costPrice = s.costPrice;
      if (v.freeDelivery === null && s.freeDelivery !== parent.freeDelivery) data.freeDelivery = s.freeDelivery;
      if (s.markedSoldOut && !v.markedSoldOut) data.markedSoldOut = true;
      if (v.stockPolicy === null && s.stockPolicy !== parent.stockPolicy) data.stockPolicy = s.stockPolicy;
      if (!sellable && v.isActive) data.isActive = false;
      if (data.price !== undefined) pinned++;

      writes.push({ variantId: v.id, data });
      variants.push({
        variantId: v.id,
        sku: v.sku,
        fromProductId: s.id,
        fromProductName: s.name,
        size,
        color,
        stock: v.stock,
        price: (v.price ?? s.basePrice).toString(),
        active: sellable && v.isActive,
      });
    }
  }

  // Dedupe notes (the compare-at one repeats per variant).
  const uniqueNotes = [...new Set(notes)];
  if (pinned) uniqueNotes.push(`${pinned} variant(s) keep their own price because the parent's base price (${parent.basePrice}) differs from their product's.`);
  const inactive = variants.filter((v) => !v.active).length;
  if (inactive) uniqueNotes.push(`${inactive} variant(s) come from unpublished products or were off, so they arrive turned off — turn them on in the parent when they should sell.`);
  const parentSizes = new Set(parent.variants.map((v) => v.size));
  const newSizes = [...new Set(variants.map((v) => v.size))].filter((s) => parentSizes.size && !parentSizes.has(s));
  if (newSizes.length) uniqueNotes.push(`Sizes the parent doesn't have yet: ${newSizes.join(", ")}. If they are the same sizes spelled differently, map them below.`);

  const redirects = sources.flatMap((s) => [
    { from: `/product/${s.slug}`, to: `/product/${parent.slug}` },
    { from: `/lp/${s.slug}`, to: `/lp/${parent.slug}` },
  ]);
  const reviews = await db.productReview.count({ where: { productId: { in: ids } } });

  return {
    plan: {
      parent: { id: parent.id, name: parent.name, slug: parent.slug, variantCount: parent.variants.length },
      variants,
      images: sources.reduce((n, s) => n + s.images.length, 0),
      reviews,
      redirects,
      notes: uniqueNotes,
      blockers: [...new Set(blockers)],
    },
    parent,
    sources,
    writes,
  };
}

export async function previewGrouping(input: ProductGroupingInput): Promise<GroupingPlan> {
  return (await prepare(input, prisma)).plan;
}

/** Links a product's images to those of its variants that have no gallery of their own, so the storefront's colour
 * gallery (pickGalleryImages) shows each colour its own photos. Returns the VariantImage ids it created. */
async function linkOwnImages(tx: Prisma.TransactionClient, variants: { id: string; imageId: string | null; _count: { images: number } }[], imageIds: string[]) {
  if (!imageIds.length) return [] as string[];
  const created: string[] = [];
  for (const v of variants) {
    if (v._count.images > 0) continue;
    for (const [sortOrder, imageId] of imageIds.entries()) {
      const row = await tx.variantImage.create({ data: { variantId: v.id, imageId, sortOrder }, select: { id: true } });
      created.push(row.id);
    }
    if (!v.imageId) await tx.productVariant.update({ where: { id: v.id }, data: { imageId: imageIds[0] } });
  }
  return created;
}

export async function commitGrouping(raw: ProductGroupingInput, adminId: string, ip?: string) {
  const input = productGroupingSchema.parse(raw);
  const result = await prisma.$transaction(
    async (tx) => {
      // Lock the parent and every source for the length of the move: a concurrent edit or second grouping waits.
      const ids = [input.parentId, ...input.sources.map((s) => s.productId)];
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
      const { plan, parent, sources, writes } = await prepare(input, tx);
      if (plan.blockers.length) throw AppError.badRequest(plan.blockers[0]!, { blockers: plan.blockers });

      const snapshot: GroupingSnapshot = { variants: [], images: [], variantImageIds: [], reviewIds: [], sources: [], redirects: [] };
      const variantById = new Map(sources.flatMap((s) => s.variants.map((v) => [v.id, { ...v, productId: s.id }] as const)));

      // The parent's own colours get their photos first (only variants without a gallery of their own).
      snapshot.variantImageIds.push(...(await linkOwnImages(tx, parent.variants, parent.images.map((i) => i.id))));
      for (const v of parent.variants) if (!v.imageId && v._count.images === 0 && parent.images.length) snapshot.variants.push(variantSnapshot({ ...v, productId: parent.id }));

      let imageOrder = Math.max(-1, ...parent.images.map((i) => i.sortOrder)) + 1;
      for (const s of sources) {
        for (const img of s.images) {
          snapshot.images.push({ id: img.id, productId: s.id, sortOrder: img.sortOrder });
          await tx.productImage.update({ where: { id: img.id }, data: { productId: parent.id, sortOrder: imageOrder++ } });
        }
        snapshot.variantImageIds.push(...(await linkOwnImages(tx, s.variants, s.images.map((i) => i.id))));
      }

      for (const w of writes) {
        snapshot.variants.push(variantSnapshot(variantById.get(w.variantId)!));
        await tx.productVariant.update({ where: { id: w.variantId }, data: w.data });
      }

      const reviews = await tx.productReview.findMany({ where: { productId: { in: sources.map((s) => s.id) } }, select: { id: true, productId: true } });
      snapshot.reviewIds = reviews;
      if (reviews.length) await tx.productReview.updateMany({ where: { id: { in: reviews.map((r) => r.id) } }, data: { productId: parent.id } });

      for (const s of sources) {
        snapshot.sources.push({ id: s.id, status: s.status, isActive: s.isActive });
        await tx.product.update({ where: { id: s.id }, data: { status: "UNPUBLISHED", isActive: false } });
      }

      for (const r of plan.redirects) {
        const before = await tx.redirect.findUnique({ where: { fromPath: r.from }, select: { toPath: true, statusCode: true, isActive: true } });
        snapshot.redirects.push({ fromPath: r.from, before });
        await tx.redirect.upsert({ where: { fromPath: r.from }, create: { fromPath: r.from, toPath: r.to, statusCode: 301 }, update: { toPath: r.to, statusCode: 301, isActive: true } });
      }

      await recomputeRatings(tx, [parent.id, ...sources.map((s) => s.id)]);
      const grouping = await tx.productGrouping.create({
        data: { parentId: parent.id, sourceIds: sources.map((s) => s.id), snapshot: snapshot as unknown as Prisma.InputJsonValue, createdById: adminId },
      });
      return { grouping, plan, parent, sources };
    },
    { timeout: 60_000 },
  );

  await invalidateCache({ productIds: [result.parent.id, ...result.sources.map((s) => s.id)] });
  recordAudit({
    adminId,
    action: "product.grouped",
    entityType: "Product",
    entityId: result.parent.id,
    metadata: { groupingId: result.grouping.id, sources: result.sources.map((s) => ({ id: s.id, name: s.name })), variants: result.plan.variants.length },
    ipAddress: ip,
  });
  return { groupingId: result.grouping.id, plan: result.plan };
}

function variantSnapshot(v: Loaded["variants"][number] & { productId: string }): GroupingSnapshot["variants"][number] {
  return {
    id: v.id,
    productId: v.productId,
    size: v.size,
    color: v.color,
    colorHex: v.colorHex,
    price: str(v.price),
    compareAtPrice: str(v.compareAtPrice),
    costPrice: str(v.costPrice),
    freeDelivery: v.freeDelivery,
    markedSoldOut: v.markedSoldOut,
    stockPolicy: v.stockPolicy,
    isActive: v.isActive,
    sortOrder: v.sortOrder,
    imageId: v.imageId,
  };
}

async function recomputeRatings(tx: Prisma.TransactionClient, productIds: string[]) {
  for (const productId of productIds) {
    const agg = await tx.productReview.aggregate({ where: { productId, status: "APPROVED" }, _avg: { rating: true }, _count: true });
    await tx.product.update({ where: { id: productId }, data: { avgRating: agg._avg.rating ?? 0, reviewCount: agg._count } });
  }
}

/** Puts back everything the grouping changed. Refused when a moved variant has since left the parent or been deleted
 * (then the snapshot no longer describes the catalog, and only a person can decide). */
export async function undoGrouping(groupingId: string, adminId: string, ip?: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProductGrouping" WHERE id = ${groupingId} FOR UPDATE`;
      const grouping = await tx.productGrouping.findUnique({ where: { id: groupingId } });
      if (!grouping) throw AppError.notFound("Grouping not found");
      if (grouping.undoneAt) throw AppError.conflict("This grouping was already undone");
      const snap = grouping.snapshot as unknown as GroupingSnapshot;
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id IN (${Prisma.join([grouping.parentId, ...grouping.sourceIds])}) FOR UPDATE`;

      const moved = snap.variants.filter((v) => v.productId !== grouping.parentId);
      const current = await tx.productVariant.findMany({ where: { id: { in: moved.map((v) => v.id) } }, select: { id: true, productId: true } });
      if (current.length !== moved.length) throw AppError.conflict("A grouped variant has been deleted since, so this can't be undone automatically.");
      if (current.some((v) => v.productId !== grouping.parentId)) throw AppError.conflict("A grouped variant has moved to another product since, so this can't be undone automatically.");
      const sources = await tx.product.count({ where: { id: { in: grouping.sourceIds } } });
      if (sources !== grouping.sourceIds.length) throw AppError.conflict("A product that was folded in has been permanently deleted, so this can't be undone automatically.");

      if (snap.variantImageIds.length) await tx.variantImage.deleteMany({ where: { id: { in: snap.variantImageIds } } });
      for (const v of snap.variants) {
        // The parent's own variants only had their primary photo set; everything else on them is the admin's since.
        if (v.productId === grouping.parentId) {
          await tx.productVariant.updateMany({ where: { id: v.id }, data: { imageId: v.imageId } });
          continue;
        }
        await tx.productVariant.update({
          where: { id: v.id },
          data: {
            productId: v.productId,
            size: v.size,
            color: v.color,
            colorHex: v.colorHex,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            costPrice: v.costPrice,
            freeDelivery: v.freeDelivery,
            markedSoldOut: v.markedSoldOut,
            stockPolicy: v.stockPolicy,
            isActive: v.isActive,
            sortOrder: v.sortOrder,
            imageId: v.imageId,
          },
        });
      }
      for (const img of snap.images) await tx.productImage.updateMany({ where: { id: img.id }, data: { productId: img.productId, sortOrder: img.sortOrder } });
      for (const r of snap.reviewIds) await tx.productReview.updateMany({ where: { id: r.id }, data: { productId: r.productId } });
      for (const s of snap.sources) await tx.product.update({ where: { id: s.id }, data: { status: s.status, isActive: s.isActive } });
      for (const r of snap.redirects) {
        if (r.before) await tx.redirect.upsert({ where: { fromPath: r.fromPath }, create: { fromPath: r.fromPath, ...r.before }, update: r.before });
        else await tx.redirect.deleteMany({ where: { fromPath: r.fromPath } });
      }
      await recomputeRatings(tx, [grouping.parentId, ...grouping.sourceIds]);
      await tx.productGrouping.update({ where: { id: grouping.id }, data: { undoneAt: new Date(), undoneById: adminId } });
      return grouping;
    },
    { timeout: 60_000 },
  );

  await invalidateCache({ productIds: [result.parentId, ...result.sourceIds] });
  recordAudit({ adminId, action: "product.grouping_undone", entityType: "Product", entityId: result.parentId, metadata: { groupingId }, ipAddress: ip });
}

/** The groupings into a product, newest first, for its editor's "Grouped products" panel. */
export async function listGroupings(parentId: string): Promise<ProductGroupingSummary[]> {
  const rows = await prisma.productGrouping.findMany({ where: { parentId }, orderBy: { createdAt: "desc" } });
  const sourceIds = [...new Set(rows.flatMap((r) => r.sourceIds))];
  const adminIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
  const [products, admins] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true, slug: true } }),
    prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const adminName = new Map(admins.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    sources: r.sourceIds.map((id) => productById.get(id) ?? { id, name: "(deleted product)", slug: "" }),
    variantCount: (r.snapshot as unknown as GroupingSnapshot).variants.filter((v) => v.productId !== r.parentId).length,
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdById ? (adminName.get(r.createdById) ?? null) : null,
    undoneAt: r.undoneAt?.toISOString() ?? null,
  }));
}
