import { Prisma } from "@prisma/client";
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";

const couponWithTargetDetails = Prisma.validator<Prisma.CouponDefaultArgs>()({
  include: {
    products: { include: { product: { select: { id: true, name: true } } } },
    categories: { include: { category: { select: { id: true, name: true } } } },
  },
});

// Coupon evaluation (eligibility, limits, discount math) lives in ONE place: the promotion engine
// (packages/shared/src/engines/promotion.ts), run by the pricing service after the bundle discount (D9). This module
// keeps coupon CRUD, the atomic usage counter, and the customer-facing listing.

const MAX_ACTIVE_COUPONS_SCANNED = 500;

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

/** Every currently-usable coupon, for a customer-facing "available coupons" listing (window and global usage only —
 * whether it applies to a cart is the pricing service's job). */
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

export async function getCouponByCode(code: string) {
  return prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
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
