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

  let discount =
    coupon.type === "PERCENTAGE" ? Math.round((subtotal * Number(coupon.value)) / 100) : Number(coupon.value);
  if (coupon.maxDiscountAmount) discount = Math.min(discount, Number(coupon.maxDiscountAmount));

  return { coupon, discount: Math.min(discount, subtotal) };
}

/** Called inside the order-creation transaction — atomically increments usage so concurrent checkouts can't both slip past a usage limit. */
export async function incrementCouponUsage(tx: Prisma.TransactionClient, couponId: string) {
  await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
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
