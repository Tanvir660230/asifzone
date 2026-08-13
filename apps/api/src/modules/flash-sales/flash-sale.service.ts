import { Prisma } from "@prisma/client";
import type { AddFlashSaleItemInput, CreateFlashSaleInput, UpdateFlashSaleInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { computeFlashPrice } from "./flash-sale-pricing";

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
  variants: true,
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

export async function listFlashSales() {
  return prisma.flashSale.findMany({ orderBy: { startsAt: "desc" }, include });
}

/** Public homepage feed: the currently-running sale ending soonest (there's usually only one at a time), with each item's product enriched with `activeFlashSale` so it can render through the normal ProductCard. */
export async function getActiveFlashSaleForHomepage() {
  const now = new Date();
  const flashSale = await prisma.flashSale.findFirst({
    where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { endsAt: "asc" },
    include: fullProductInclude,
  });
  if (!flashSale) return null;

  return {
    ...flashSale,
    items: flashSale.items.map((item) => ({
      ...item,
      product: {
        ...item.product,
        activeFlashSale: {
          flashSaleId: flashSale.id,
          flashSaleName: flashSale.name,
          endsAt: flashSale.endsAt,
          // FlashSaleItem.discountType shares its Prisma enum with Coupon.type (which also allows
          // FREE_SHIPPING), but addFlashSaleItemSchema restricts flash-sale items to PERCENTAGE/FIXED only.
          discountType: item.discountType as "PERCENTAGE" | "FIXED",
          discountValue: Number(item.discountValue),
          flashPrice: computeFlashPrice(Number(item.product.basePrice), {
            discountType: item.discountType as "PERCENTAGE" | "FIXED",
            discountValue: Number(item.discountValue),
          }),
        },
      },
    })),
  };
}

export async function getFlashSaleById(id: string) {
  const flashSale = await prisma.flashSale.findUnique({ where: { id }, include });
  if (!flashSale) throw AppError.notFound("Flash sale not found");
  return flashSale;
}

export async function createFlashSale(input: CreateFlashSaleInput) {
  const flashSale = await prisma.flashSale.create({ data: input, include });
  await invalidateProductCache();
  return flashSale;
}

export async function updateFlashSale(id: string, input: UpdateFlashSaleInput) {
  await getFlashSaleById(id);
  const flashSale = await prisma.flashSale.update({ where: { id }, data: input, include });
  await invalidateProductCache();
  return flashSale;
}

export async function deleteFlashSale(id: string) {
  await getFlashSaleById(id);
  await prisma.flashSale.delete({ where: { id } });
  await invalidateProductCache();
}

export async function addFlashSaleItem(flashSaleId: string, input: AddFlashSaleItemInput) {
  await getFlashSaleById(flashSaleId);

  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw AppError.badRequest("Product does not exist");

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
  await invalidateProductCache();
  return getFlashSaleById(flashSaleId);
}

export async function removeFlashSaleItem(flashSaleId: string, itemId: string) {
  const item = await prisma.flashSaleItem.findUnique({ where: { id: itemId } });
  if (!item || item.flashSaleId !== flashSaleId) throw AppError.notFound("Flash sale item not found");
  await prisma.flashSaleItem.delete({ where: { id: itemId } });
  await invalidateProductCache();
  return getFlashSaleById(flashSaleId);
}

/** Flips FlashSale.isActive to match the current time window — called by the cron job every minute. Returns how many rows changed, purely for logging. */
export async function syncFlashSaleActivation(): Promise<number> {
  const now = new Date();

  const [activated, deactivated] = await Promise.all([
    prisma.flashSale.updateMany({
      where: { isActive: false, startsAt: { lte: now }, endsAt: { gte: now } },
      data: { isActive: true },
    }),
    prisma.flashSale.updateMany({
      where: { isActive: true, endsAt: { lt: now } },
      data: { isActive: false },
    }),
  ]);

  const changed = activated.count + deactivated.count;
  if (changed > 0) await invalidateProductCache();
  return changed;
}
