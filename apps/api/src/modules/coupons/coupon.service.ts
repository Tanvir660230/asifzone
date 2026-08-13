import { Prisma } from "@prisma/client";
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import type { CartLine } from "../orders/cart-lines";

const couponWithTargets = Prisma.validator<Prisma.CouponDefaultArgs>()({
  include: {
    products: { select: { productId: true } },
    categories: { select: { categoryId: true } },
  },
});
type CouponWithTargets = Prisma.CouponGetPayload<typeof couponWithTargets>;

const couponWithTargetDetails = Prisma.validator<Prisma.CouponDefaultArgs>()({
  include: {
    products: { include: { product: { select: { id: true, name: true } } } },
    categories: { include: { category: { select: { id: true, name: true } } } },
  },
});

export interface EvaluateCouponContext {
  cartLines?: CartLine[];
  customerId?: string;
}

export interface CouponEvaluation {
  coupon: CouponWithTargets;
  discount: number;
  freeShipping: boolean;
  /** Product ids the discount actually matched — empty for an ALL_PRODUCTS coupon with no cart context. */
  eligibleProductIds: string[];
}

// findBestCoupon/listActiveCoupons scan every active, non-expired coupon in application code (the
// "best fit" and usage-limit checks aren't expressible as a single WHERE) — fine at realistic
// coupon-catalog sizes, but capped so a runaway number of active coupons can't turn either into an
// unbounded full-table load.
const MAX_ACTIVE_COUPONS_SCANNED = 500;

async function findActiveCoupon(code: string) {
  return prisma.coupon.findUnique({ where: { code: code.toUpperCase() }, ...couponWithTargets });
}

/** Cart lines this coupon's targeting actually matches — every line, unfiltered, for an ALL_PRODUCTS
 * coupon (no cart context needed at all in that case). */
function eligibleLines(coupon: CouponWithTargets, cartLines: CartLine[]): CartLine[] {
  if (coupon.scope === "ALL_PRODUCTS") return cartLines;
  if (coupon.scope === "SPECIFIC_PRODUCTS") {
    const productIds = new Set(coupon.products.map((p) => p.productId));
    return cartLines.filter((l) => productIds.has(l.productId));
  }
  const categoryIds = new Set(coupon.categories.map((c) => c.categoryId));
  return cartLines.filter((l) => categoryIds.has(l.categoryId));
}

/** Pure discount math, shared by `evaluateCoupon` (a known code) and `findBestCoupon` (scanning every
 * eligible code) — does not check expiry/usage/min-order/targeting eligibility, only computes the
 * amount against whatever `eligibleAmount` it's handed. */
function computeCouponDiscount(
  coupon: { type: string; value: unknown; maxDiscountAmount: unknown },
  eligibleAmount: number,
): { discount: number; freeShipping: boolean } {
  if (coupon.type === "FREE_SHIPPING") return { discount: 0, freeShipping: true };

  let discount = coupon.type === "PERCENTAGE" ? Math.round((eligibleAmount * Number(coupon.value)) / 100) : Number(coupon.value);
  if (coupon.maxDiscountAmount) discount = Math.min(discount, Number(coupon.maxDiscountAmount));
  return { discount: Math.min(discount, eligibleAmount), freeShipping: false };
}

/** Validates a coupon against a cart and returns the discount — throws with a customer-facing message
 * if it can't be applied. `ctx.cartLines` is required for a product/category-restricted coupon (its
 * targeting can't be checked against a bare subtotal); `ctx.customerId`, when known, additionally
 * enforces per-customer/first-order limits. */
export async function evaluateCoupon(code: string, subtotal: number, ctx: EvaluateCouponContext = {}): Promise<CouponEvaluation> {
  const coupon = await findActiveCoupon(code);
  if (!coupon || !coupon.isActive || coupon.deletedAt) throw AppError.badRequest("Coupon not found");

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw AppError.badRequest("This coupon isn't active yet");
  if (coupon.expiresAt && coupon.expiresAt < now) throw AppError.badRequest("Coupon has expired");
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw AppError.badRequest("Coupon usage limit reached");
  }
  if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) {
    throw AppError.badRequest(`Minimum order amount for this coupon is ৳${coupon.minOrderAmount}`);
  }
  if (coupon.scope !== "ALL_PRODUCTS" && !ctx.cartLines) {
    throw AppError.badRequest("This coupon can't be applied without your cart details");
  }

  const matched = ctx.cartLines ? eligibleLines(coupon, ctx.cartLines) : null;
  const eligibleAmount = matched ? matched.reduce((sum, l) => sum + l.lineTotal, 0) : subtotal;
  const eligibleQuantity = matched ? matched.reduce((sum, l) => sum + l.quantity, 0) : null;

  if (coupon.scope !== "ALL_PRODUCTS" && eligibleAmount <= 0) {
    throw AppError.badRequest("This coupon doesn't apply to any items in your cart");
  }
  if (coupon.minQuantity && eligibleQuantity !== null && eligibleQuantity < coupon.minQuantity) {
    throw AppError.badRequest(`This coupon needs at least ${coupon.minQuantity} eligible item(s) in your cart`);
  }

  if (ctx.customerId) {
    if (coupon.perCustomerLimit) {
      const used = await prisma.order.count({
        where: { couponId: coupon.id, customerId: ctx.customerId, deletedAt: null },
      });
      if (used >= coupon.perCustomerLimit) {
        throw AppError.badRequest("You've already used this coupon the maximum number of times");
      }
    }
    if (coupon.firstOrderOnly) {
      const priorOrders = await prisma.order.count({ where: { customerId: ctx.customerId, deletedAt: null } });
      if (priorOrders > 0) throw AppError.badRequest("This coupon is only valid on your first order");
    }
  }

  const { discount, freeShipping } = computeCouponDiscount(coupon, eligibleAmount);
  return {
    coupon,
    discount,
    freeShipping,
    eligibleProductIds: matched ? [...new Set(matched.map((l) => l.productId))] : [],
  };
}

/** The single best coupon a shopper already qualifies for, with no code needed — powers the checkout
 * page's auto-suggestion banner. Skips any product/category-restricted coupon that doesn't match the
 * current cart, so a shopper is never nudged toward a coupon that would apply to nothing. */
export async function findBestCoupon(subtotal: number, cartLines?: CartLine[]) {
  const now = new Date();
  const candidates = await prisma.coupon.findMany({
    where: { isActive: true, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    take: MAX_ACTIVE_COUPONS_SCANNED,
    ...couponWithTargets,
  });

  let best: { coupon: CouponWithTargets; discount: number; freeShipping: boolean } | null = null;
  for (const coupon of candidates) {
    if (coupon.startsAt && coupon.startsAt > now) continue;
    if (coupon.expiresAt && coupon.expiresAt < now) continue;
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) continue;
    if (coupon.minOrderAmount && subtotal < Number(coupon.minOrderAmount)) continue;
    if (coupon.scope !== "ALL_PRODUCTS" && !cartLines) continue;

    const matched = cartLines ? eligibleLines(coupon, cartLines) : null;
    const eligibleAmount = matched ? matched.reduce((sum, l) => sum + l.lineTotal, 0) : subtotal;
    const eligibleQuantity = matched ? matched.reduce((sum, l) => sum + l.quantity, 0) : null;
    if (coupon.scope !== "ALL_PRODUCTS" && eligibleAmount <= 0) continue;
    if (coupon.minQuantity && eligibleQuantity !== null && eligibleQuantity < coupon.minQuantity) continue;

    const { discount, freeShipping } = computeCouponDiscount(coupon, eligibleAmount);
    if (discount <= 0 && !freeShipping) continue;
    if (!best || discount > best.discount) best = { coupon, discount, freeShipping };
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
    where: { isActive: true, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    take: MAX_ACTIVE_COUPONS_SCANNED,
    ...couponWithTargetDetails,
  });
  return candidates.filter(
    (c) => (c.usageLimit === null || c.usedCount < c.usageLimit) && (!c.startsAt || c.startsAt <= now),
  );
}

// --- admin CRUD ---

export async function listCoupons(query: CouponListQuery) {
  const where = {
    deletedAt: query.trashed ? { not: null } : null,
    ...(query.search ? { code: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  return paginate(
    query,
    (p) => prisma.coupon.findMany({ where, orderBy: { createdAt: "desc" }, ...couponWithTargetDetails, ...p }),
    () => prisma.coupon.count({ where }),
  );
}

export async function getCouponById(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id }, ...couponWithTargetDetails });
  if (!coupon) throw AppError.notFound("Coupon not found");
  return coupon;
}

/** A discount value is meaningless for FREE_SHIPPING but required for PERCENTAGE/FIXED; targeting ids
 * are required once a scope actually restricts to them; a scheduled window must make sense. Lives here
 * (not as a zod `superRefine`) because `updateCouponSchema` is a `.partial()` — a PATCH must be able to
 * validate against the *resulting* coupon, merging in whatever the caller didn't send. */
function assertBusinessRules(input: {
  type: string;
  value?: number | null;
  scope: string;
  productIds: string[];
  categoryIds: string[];
  startsAt?: Date | null;
  expiresAt?: Date | null;
}) {
  if (input.type !== "FREE_SHIPPING" && (input.value === null || input.value === undefined)) {
    throw AppError.badRequest("A discount value is required for this coupon type");
  }
  if (input.scope === "SPECIFIC_PRODUCTS" && input.productIds.length === 0) {
    throw AppError.badRequest("Select at least one product for this coupon");
  }
  if (input.scope === "SPECIFIC_CATEGORIES" && input.categoryIds.length === 0) {
    throw AppError.badRequest("Select at least one category for this coupon");
  }
  if (input.startsAt && input.expiresAt && input.startsAt >= input.expiresAt) {
    throw AppError.badRequest("Start date must be before the expiry date");
  }
}

export async function createCoupon(input: CreateCouponInput) {
  const existing = await prisma.coupon.findUnique({ where: { code: input.code } });
  if (existing) throw AppError.conflict("A coupon with this code already exists");

  assertBusinessRules(input);

  const { productIds, categoryIds, ...data } = input;
  return prisma.coupon.create({
    data: {
      ...data,
      products: productIds.length ? { create: productIds.map((productId) => ({ productId })) } : undefined,
      categories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
    },
    ...couponWithTargetDetails,
  });
}

export async function updateCoupon(id: string, input: UpdateCouponInput) {
  const existing = await getCouponById(id);
  if (input.code) {
    const dup = await prisma.coupon.findFirst({ where: { code: input.code, NOT: { id } } });
    if (dup) throw AppError.conflict("A coupon with this code already exists");
  }

  assertBusinessRules({
    type: input.type ?? existing.type,
    value: input.value !== undefined ? input.value : existing.value !== null ? Number(existing.value) : null,
    scope: input.scope ?? existing.scope,
    productIds: input.productIds ?? existing.products.map((p) => p.productId),
    categoryIds: input.categoryIds ?? existing.categories.map((c) => c.categoryId),
    startsAt: input.startsAt !== undefined ? input.startsAt : existing.startsAt,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt,
  });

  const { productIds, categoryIds, ...data } = input;

  return prisma.$transaction(async (tx) => {
    if (productIds !== undefined) {
      await tx.couponProduct.deleteMany({ where: { couponId: id } });
      if (productIds.length) {
        await tx.couponProduct.createMany({ data: productIds.map((productId) => ({ couponId: id, productId })) });
      }
    }
    if (categoryIds !== undefined) {
      await tx.couponCategory.deleteMany({ where: { couponId: id } });
      if (categoryIds.length) {
        await tx.couponCategory.createMany({ data: categoryIds.map((categoryId) => ({ couponId: id, categoryId })) });
      }
    }
    return tx.coupon.update({ where: { id }, data, ...couponWithTargetDetails });
  });
}

/** Soft delete — moves the coupon to Trash instead of destroying it. Unlike Category, there's no
 * "must be empty first" guard: a coupon that's already been used on past orders is still safe to
 * trash (it just stops being redeemable) — trashing it is actually strictly better than the old
 * hard delete, which silently nulled out `Order.couponId` on every order that used it
 * (`onDelete: SetNull`), losing which coupon those historical orders applied. */
export async function deleteCoupon(id: string) {
  await getCouponById(id);
  await prisma.coupon.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function restoreCoupon(id: string) {
  await getCouponById(id);
  return prisma.coupon.update({ where: { id }, data: { deletedAt: null } });
}

/** Irreversible — only meaningful for a coupon already in Trash. Blocked if the coupon has real
 * order history (checked directly against Order, not the denormalized `usedCount`, which could
 * drift) — purging it would erase which coupon those orders used. */
export async function permanentlyDeleteCoupon(id: string) {
  const coupon = await getCouponById(id);
  if (!coupon.deletedAt) throw AppError.badRequest("Move the coupon to Trash before deleting it permanently");

  const orderCount = await prisma.order.count({ where: { couponId: id } });
  if (orderCount > 0) {
    throw AppError.conflict("Cannot permanently delete a coupon used on past orders — this would erase which coupon those orders used");
  }

  await prisma.coupon.delete({ where: { id } });
}
