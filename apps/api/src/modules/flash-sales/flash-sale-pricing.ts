import { prisma } from "../../config/prisma";

export interface ActiveFlashInfo {
  flashSaleId: string;
  flashSaleName: string;
  endsAt: Date;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
}

/** "Live right now": the admin's switch plus the schedule window, read directly — never the scheduler-maintained
 * `isActive` cache, so a sale starts/stops exactly on time and a disabled sale never prices anything. */
export function liveFlashSaleWhere(now: Date = new Date()) {
  return { enabled: true, startsAt: { lte: now }, endsAt: { gte: now } };
}

/** Currently-live flash sale, keyed by productId — live items only, so callers never need to re-check the window. */
export async function getActiveFlashInfoByProduct(productIds: string[]): Promise<Map<string, ActiveFlashInfo>> {
  if (productIds.length === 0) return new Map();

  const items = await prisma.flashSaleItem.findMany({
    where: {
      productId: { in: productIds },
      flashSale: liveFlashSaleWhere(),
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
