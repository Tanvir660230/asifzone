import { prisma } from "../../config/prisma";

export interface ActiveFlashInfo {
  flashSaleId: string;
  flashSaleName: string;
  endsAt: Date;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
}

/** Currently-active (isActive + within time window) flash sale, keyed by productId — active items only, so callers never need to re-check the time window. */
export async function getActiveFlashInfoByProduct(productIds: string[]): Promise<Map<string, ActiveFlashInfo>> {
  if (productIds.length === 0) return new Map();

  const now = new Date();
  const items = await prisma.flashSaleItem.findMany({
    where: {
      productId: { in: productIds },
      flashSale: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
    },
    include: { flashSale: true },
  });

  const map = new Map<string, ActiveFlashInfo>();
  for (const item of items) {
    map.set(item.productId, {
      flashSaleId: item.flashSaleId,
      flashSaleName: item.flashSale.name,
      endsAt: item.flashSale.endsAt,
      // FlashSaleItem.discountType shares its Prisma enum with Coupon.type (which also allows
      // FREE_SHIPPING), but addFlashSaleItemSchema restricts flash-sale items to PERCENTAGE/FIXED only.
      discountType: item.discountType as "PERCENTAGE" | "FIXED",
      discountValue: Number(item.discountValue),
    });
  }
  return map;
}

export function computeFlashPrice(regularPrice: number, info: Pick<ActiveFlashInfo, "discountType" | "discountValue">): number {
  const price =
    info.discountType === "PERCENTAGE" ? regularPrice - (regularPrice * info.discountValue) / 100 : regularPrice - info.discountValue;
  return Math.max(0, Math.round(price * 100) / 100);
}
