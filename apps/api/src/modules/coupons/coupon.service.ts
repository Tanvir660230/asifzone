import { Prisma } from "@prisma/client";
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

export interface CouponEvaluation {
  coupon: Awaited<ReturnType<typeof findActiveCoupon>>;
  discount: number;
}

async function findActiveCoupon(code: string) {
  return prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
}

/** Pure discount math, shared by `evaluateCoupon` (a known code) and `findBestCoupon` (scanning
 * every eligible code) — does not check expiry/usage/min-order, only computes the amount. */
function computeCouponDiscount(coupon: { type: string; value: unknown; maxDiscountAmount: unknown }, subtotal: number) {
  let discount =
    coupon.type === "PERCENTAGE" ? Math.round((subtotal * Number(coupon.value)) / 100) : Number(coupon.value);
  if (coupon.maxDiscountAmount) discount = Math.min(discount, Number(coupon.maxDiscountAmount));
  return Math.min(discount, subtotal);
}

/** Validates a coupon against a cart subtotal and returns the discount amount — throws with a customer-facing message if it can't be applied. */
export async function evaluateCoupon(code: string, subtotal: number): Promise<CouponEvaluation> {
  const coupon = await findActiveCoupon(code);
  if (!coupon || !coupon.isActive) throw AppError.badRequest("Coupon not found");
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw AppError.badRequest("Coupon has expired");
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw AppError.badRequest("Coupon usage limit reached");
  }
  if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
    throw AppError.badRequest(`Minimum order amount for this coupon is ৳${coupon.minOrderAmount}`);
  }

  return { coupon, discount: computeCouponDiscount(coupon, subtotal) };
}

/** The single best coupon a shopper already qualifies for at this subtotal, with no code needed —
 * powers the checkout page's auto-suggestion banner. Same shape as `evaluateCoupon`'s result. */
export async function findBestCoupon(subtotal: number) {
  const now = new Date();
  const candidates = await prisma.coupon.findMany({
    where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  });

  let best: { coupon: (typeof candidates)[number]; discount: number } | null = null;
  for (const coupon of candidates) {
    if (coupon.expiresAt && coupon.expiresAt < now) continue;
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) continue;
    if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) continue;

    const discount = computeCouponDiscount(coupon, subtotal);
    if (discount <= 0) continue;
    if (!best || discount > best.discount) best = { coupon, discount };
  }

  return best;
}

/** Called inside the order-creation transaction — atomically increments usage so concurrent checkouts
 * can't both slip past a usage limit. Uses a conditional raw UPDATE (mirroring the stock-decrement
 * pattern above) because Prisma's `update`/`updateMany` can't express "usedCount < usageLimit" as a
 * single-row-atomic filter when both sides are columns on the row being updated. */
export async function incrementCouponUsage(tx: Prisma.TransactionClient, couponId: string) {
  const affected = await tx.$executeRaw`
    UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
    WHERE id = ${couponId} AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
  `;
  if (affected === 0) {
    throw AppError.conflict("Coupon usage limit reached");
  }
}

/** Every currently-usable coupon, for a customer-facing "available coupons" listing — same
 * eligibility checks as `findBestCoupon` minus the subtotal filter (there's no cart to check against here). */
export async function listActiveCoupons() {
  const now = new Date();
  const candidates = await prisma.coupon.findMany({
    where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
  return candidates.filter((c) => c.usageLimit === null || c.usedCount < c.usageLimit);
}

// --- admin CRUD ---

export async function listCoupons(query: CouponListQuery) {
  const where = query.search
    ? { code: { contains: query.search, mode: "insensitive" as const } }
    : {};

  const [items, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.coupon.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getCouponById(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw AppError.notFound("Coupon not found");
  return coupon;
}

export async function createCoupon(input: CreateCouponInput) {
  const existing = await prisma.coupon.findUnique({ where: { code: input.code } });
  if (existing) throw AppError.conflict("A coupon with this code already exists");
  return prisma.coupon.create({ data: input });
}

export async function updateCoupon(id: string, input: UpdateCouponInput) {
  await getCouponById(id);
  if (input.code) {
    const existing = await prisma.coupon.findFirst({ where: { code: input.code, NOT: { id } } });
    if (existing) throw AppError.conflict("A coupon with this code already exists");
  }
  return prisma.coupon.update({ where: { id }, data: input });
}

export async function deleteCoupon(id: string) {
  await getCouponById(id);
  await prisma.coupon.delete({ where: { id } });
}
