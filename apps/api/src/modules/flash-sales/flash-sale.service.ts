import { Prisma } from "@prisma/client";
import type { AddFlashSaleItemInput, CreateFlashSaleInput, UpdateFlashSaleInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { isFlashSaleLive } from "@clothing-brand/shared";
import { liveFlashSaleWhere } from "./flash-sale-pricing";
import { ensureFreshReadModels, presentStorefrontProducts, refreshReadModels } from "../../domain/storefront/read-model.service";
import { triggerStorefrontRevalidation } from "../products/product.cache";
import { PUBLIC_VARIANT_FIELDS } from "../products/product-public-select";

const include = {
  items: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" as const }, take: 1 } } } } },
};

// Public homepage feed only — excludes the same internal-only Product fields as
// product.service.ts's PUBLIC_PRODUCT_SELECT (costPrice/taxRate have no storefront consumer and
// shouldn't reach anonymous visitors). An explicit `select` rather than Prisma's lighter-weight
// `omit` API, since `omit` needs a preview client feature this project doesn't enable.
const PUBLIC_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  shortDescription: true,
  sortOrder: true,
  categoryId: true,
  brand: true,
  brandTier: true,
  basePrice: true,
  compareAtPrice: true,
  trackInventory: true,
  lowStockThreshold: true,
  restockDate: true,
  isActive: true,
  isFeatured: true,
  seoTitle: true,
  seoDescription: true,
  deletedAt: true,
  avgRating: true,
  reviewCount: true,
  createdAt: true,
  updatedAt: true,
  category: true,
  // not `true`: that would include each variant's cost price. Active variants only, like every storefront read.
  variants: { select: PUBLIC_VARIANT_FIELDS, where: { isActive: true }, orderBy: { sortOrder: "asc" as const } },
  images: { orderBy: { sortOrder: "asc" as const } },
} as const;

const fullProductInclude = {
  items: {
    include: {
      product: { select: PUBLIC_PRODUCT_SELECT },
    },
  },
};

async function invalidateProductCache() {
  await cacheDelByPrefix("products:");
}

/** A flash-sale write changes the canonical selling price of the products in it: refresh their read-model rows now
 * (eager; the freshness guard is the safety net) and bust the storefront's cached pages for them. */
async function flashSaleChanged(productIds: string[]) {
  await invalidateProductCache();
  if (!productIds.length) return;
  await refreshReadModels(productIds).catch((err) => console.error("[read-model] flash-sale refresh failed:", err));
  void triggerStorefrontRevalidation({ productIds }).catch((err) => console.error("[revalidate] unexpected failure:", err));
}

async function productIdsOfSale(flashSaleId: string) {
  return (await prisma.flashSaleItem.findMany({ where: { flashSaleId }, select: { productId: true } })).map((i) => i.productId);
}

export async function listFlashSales() {
  return prisma.flashSale.findMany({ orderBy: { startsAt: "desc" }, include });
}

/** Public homepage feed: the currently-running sale ending soonest (there's usually only one at a time), with each item's product enriched with `activeFlashSale` so it can render through the normal ProductCard. */
export async function getActiveFlashSaleForHomepage() {
  const flashSale = await prisma.flashSale.findFirst({
    where: liveFlashSaleWhere(),
    orderBy: { endsAt: "asc" },
    include: fullProductInclude,
  });
  if (!flashSale) return null;

  // A trashed or unpublished product stays attached to the sale but is never advertised (or sold).
  const items = flashSale.items.filter((item) => item.product.isActive && item.product.deletedAt === null);
  // The same Storefront Read Model presenter as every other storefront read: canonical pricing (variant prices, the
  // stock limit and overlapping sales all respected — exactly what the cart will charge) and availability.
  const presented = await presentStorefrontProducts(items.map((i) => i.product));
  return { ...flashSale, items: items.map((item, i) => ({ ...item, product: presented[i]! })) };
}

export async function getFlashSaleById(id: string) {
  const flashSale = await prisma.flashSale.findUnique({ where: { id }, include });
  if (!flashSale) throw AppError.notFound("Flash sale not found");
  return flashSale;
}

/** `isActive` is derived — enabled && inside the window — and written here on every admin write (and by the
 * scheduler each minute), never taken from input. See the lifecycle table in TARGET_ARCHITECTURE §16a. */
export async function createFlashSale(input: CreateFlashSaleInput) {
  const flashSale = await prisma.flashSale.create({ data: { ...input, isActive: isFlashSaleLive(input) }, include });
  await flashSaleChanged(await productIdsOfSale(flashSale.id));
  return flashSale;
}

export async function updateFlashSale(id: string, input: UpdateFlashSaleInput) {
  const existing = await getFlashSaleById(id);
  const next = { enabled: input.enabled ?? existing.enabled, startsAt: input.startsAt ?? existing.startsAt, endsAt: input.endsAt ?? existing.endsAt };
  if (next.endsAt <= next.startsAt) throw AppError.badRequest("End time must be after start time");
  const flashSale = await prisma.flashSale.update({ where: { id }, data: { ...input, isActive: isFlashSaleLive(next) }, include });
  await flashSaleChanged(await productIdsOfSale(id));
  return flashSale;
}

export async function deleteFlashSale(id: string) {
  await getFlashSaleById(id);
  const productIds = await productIdsOfSale(id);
  await prisma.flashSale.delete({ where: { id } });
  await flashSaleChanged(productIds);
}

export async function addFlashSaleItem(flashSaleId: string, input: AddFlashSaleItemInput) {
  await getFlashSaleById(flashSaleId);

  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product || product.deletedAt) throw AppError.badRequest("Product does not exist");

  const existing = await prisma.flashSaleItem.findUnique({
    where: { flashSaleId_productId: { flashSaleId, productId: input.productId } },
  });
  if (existing) throw AppError.conflict("This product is already in the flash sale");

  try {
    await prisma.flashSaleItem.create({ data: { ...input, flashSaleId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("This product is already in the flash sale");
    }
    throw err;
  }
  await flashSaleChanged([input.productId]);
  return getFlashSaleById(flashSaleId);
}

export async function removeFlashSaleItem(flashSaleId: string, itemId: string) {
  const item = await prisma.flashSaleItem.findUnique({ where: { id: itemId } });
  if (!item || item.flashSaleId !== flashSaleId) throw AppError.notFound("Flash sale item not found");
  await prisma.flashSaleItem.delete({ where: { id: itemId } });
  await flashSaleChanged([item.productId]);
  return getFlashSaleById(flashSaleId);
}

/** Refreshes the derived FlashSale.isActive cache (enabled && inside the window) — called by the scheduler every
 * minute. Never touches `enabled`: a sale an admin switched off stays off. Returns how many rows changed. */
export async function syncFlashSaleActivation(): Promise<number> {
  const now = new Date();

  const [activated, deactivated] = await Promise.all([
    prisma.flashSale.updateMany({
      where: { isActive: false, enabled: true, startsAt: { lte: now }, endsAt: { gte: now } },
      data: { isActive: true },
    }),
    prisma.flashSale.updateMany({
      where: { isActive: true, OR: [{ enabled: false }, { endsAt: { lt: now } }, { startsAt: { gt: now } }] },
      data: { isActive: false },
    }),
  ]);

  const changed = activated.count + deactivated.count;
  if (changed > 0) await invalidateProductCache();
  // Clock-driven price changes (a sale starting or ending) and quantity-limited offers: bring the storefront read
  // model up to date on the same minute tick (the read-time guard covers requests in between).
  await ensureFreshReadModels(now);
  return changed;
}
