import { Prisma } from "@prisma/client";
import type { AdminReviewListQuery, CreateReviewInput, ReviewListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { invalidateCache as invalidateProductCache } from "../products/product.service";

type BreakdownCounts = Record<"5" | "4" | "3" | "2" | "1", number>;
const EMPTY_BREAKDOWN_COUNTS: BreakdownCounts = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };

/** Recomputes Product.avgRating/reviewCount from APPROVED reviews only — called after any
 * moderation action or delete so the denormalized fields never drift from real approved reviews. */
async function recomputeProductRating(productId: string) {
  const agg = await prisma.productReview.aggregate({
    where: { productId, status: "APPROVED" },
    _avg: { rating: true },
    _count: true,
  });
  await prisma.product.update({
    where: { id: productId },
    data: { avgRating: agg._avg.rating ?? 0, reviewCount: agg._count },
  });
  // The storefront's getProductBySlug/listStorefrontProducts reads go through a Redis cache
  // keyed by product — without this, an approved review's rating stays stale on the storefront
  // for the rest of the cache TTL.
  await invalidateProductCache();
}

async function getRatingBreakdown(productId: string) {
  const rows = await prisma.productReview.groupBy({
    by: ["rating"],
    where: { productId, status: "APPROVED" },
    _count: true,
  });
  const counts = { ...EMPTY_BREAKDOWN_COUNTS };
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    const key = String(row.rating) as keyof typeof counts;
    if (key in counts) counts[key] = row._count;
    total += row._count;
    sum += row.rating * row._count;
  }
  return { average: total > 0 ? sum / total : 0, count: total, counts };
}

export async function listReviewsForProduct(query: ReviewListQuery) {
  const where = { productId: query.productId, status: "APPROVED" as const };
  const [page, breakdown] = await Promise.all([
    paginate(
      query,
      (p) => prisma.productReview.findMany({ where, orderBy: { createdAt: "desc" }, ...p }),
      () => prisma.productReview.count({ where }),
    ),
    getRatingBreakdown(query.productId),
  ]);
  return { ...page, breakdown };
}

export async function getMyReviewForProduct(customerId: string, productId: string) {
  return prisma.productReview.findUnique({ where: { productId_customerId: { productId, customerId } } });
}

/** A "verified purchase" is computed once, at submission time, from real order history — a
 * DELIVERED order containing any variant of this product. OrderItem has no hard FK to
 * ProductVariant (see schema comment), so this is a two-step lookup rather than a single join. */
async function hasDeliveredPurchase(customerId: string, productId: string) {
  const variantIds = (await prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map(
    (v) => v.id,
  );
  if (!variantIds.length) return false;

  const match = await prisma.orderItem.findFirst({
    where: { variantId: { in: variantIds }, order: { customerId, status: "DELIVERED" } },
    select: { id: true },
  });
  return Boolean(match);
}

export async function createReview(customerId: string, input: CreateReviewInput) {
  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } });
  if (!product) throw AppError.notFound("Product not found");

  const existing = await getMyReviewForProduct(customerId, input.productId);
  if (existing) throw AppError.conflict("You've already reviewed this product");

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
  if (!customer) throw AppError.notFound("Customer not found");

  const isVerifiedPurchase = await hasDeliveredPurchase(customerId, input.productId);

  try {
    return await prisma.productReview.create({
      data: {
        productId: input.productId,
        customerId,
        customerName: customer.name,
        rating: input.rating,
        title: input.title ?? null,
        body: input.body,
        isVerifiedPurchase,
      },
    });
  } catch (err) {
    // A concurrent double-submit (double-click, retry) can race past the getMyReviewForProduct
    // check above — the productId_customerId unique constraint is the real backstop, caught here
    // so it still surfaces as the same friendly message rather than a generic 409.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("You've already reviewed this product");
    }
    throw err;
  }
}

// --- admin ---

export async function listReviewsAdmin(query: AdminReviewListQuery) {
  const where = query.status ? { status: query.status } : {};
  return paginate(
    query,
    (p) =>
      prisma.productReview.findMany({
        where,
        include: { product: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "desc" },
        ...p,
      }),
    () => prisma.productReview.count({ where }),
  );
}

async function getReviewById(id: string) {
  const review = await prisma.productReview.findUnique({ where: { id } });
  if (!review) throw AppError.notFound("Review not found");
  return review;
}

export async function moderateReview(id: string, status: "APPROVED" | "REJECTED") {
  const review = await getReviewById(id);
  await prisma.productReview.update({ where: { id }, data: { status } });
  // Recompute regardless of direction (APPROVED needs it counted; flipping an already-APPROVED
  // review to REJECTED needs it uncounted) rather than only on one transition.
  if (status === "APPROVED" || review.status === "APPROVED") {
    await recomputeProductRating(review.productId);
  }
  return prisma.productReview.findUnique({ where: { id }, include: { product: { select: { id: true, name: true, slug: true } } } });
}

export async function deleteReview(id: string) {
  const review = await getReviewById(id);
  await prisma.productReview.delete({ where: { id } });
  if (review.status === "APPROVED") {
    await recomputeProductRating(review.productId);
  }
}
