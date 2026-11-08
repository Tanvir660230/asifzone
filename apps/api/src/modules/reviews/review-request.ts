import { Prisma } from "@prisma/client";
import type { LinkReviewInput } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { captureError } from "../../lib/observability/error-capture";
import { constantTimeEqual, signPayload } from "../../lib/token-hash";
import { getProviders } from "../../providers/registry";
import { getSettings } from "../settings/settings.service";
import { getSmsSettings } from "../sms-settings/sms-settings.service";

/**
 * Reviews from customers who never made an account (order-outcomes programme, PR 3). Two days after delivery one SMS
 * carries `/r/<orderNumber>.<signature>`; the page lists that order's products with a star picker. The signature (an
 * HMAC of the order number) is the key: short enough for an SMS, not guessable for another order, no table. A review
 * belongs to the order's customer, is a verified purchase, and waits for moderation like any other.
 */

const SIG_LENGTH = 10;
/** Delivered at least this long ago (the product has been used) … */
const ASK_AFTER_DAYS = 2;
/** … and not longer than this (an old order isn't worth a text). */
const ASK_WITHIN_DAYS = 5;
/** At most this many texts per run — a backlog never floods customers in one morning. */
const MAX_PER_RUN = 300;
const REVIEWABLE = ["DELIVERED", "PARTIALLY_DELIVERED"];

const sign = (orderNumber: string) =>
  Buffer.from(signPayload(`review:${orderNumber}`, process.env.ORDER_LINK_SECRET || env.jwtAccessSecret), "hex").toString("base64url").slice(0, SIG_LENGTH);

export function reviewCode(orderNumber: string): string {
  return `${orderNumber}.${sign(orderNumber)}`;
}

export function parseReviewCode(code: string): string | null {
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const orderNumber = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  return sig.length === SIG_LENGTH && constantTimeEqual(sig, sign(orderNumber)) ? orderNumber : null;
}

export interface ReviewRequestView {
  orderNumber: string;
  /** First name only — enough for "Thanks, Rahim". */
  firstName: string;
  canReview: boolean;
  items: { productId: string; name: string; imageUrl: string | null; reviewed: boolean; rating: number | null }[];
}

async function orderFor(code: string) {
  const orderNumber = parseReviewCode(code);
  if (!orderNumber) throw AppError.notFound("This link isn't valid");
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: { id: true, orderNumber: true, status: true, customerId: true, customerName: true, deletedAt: true, items: { select: { productIdSnapshot: true, productNameSnapshot: true } } },
  });
  if (!order || order.deletedAt || !order.customerId) throw AppError.notFound("This link isn't valid");
  return order;
}

export async function getReviewRequestView(code: string): Promise<ReviewRequestView> {
  const order = await orderFor(code);
  const products = new Map<string, string>();
  for (const i of order.items) if (i.productIdSnapshot && !products.has(i.productIdSnapshot)) products.set(i.productIdSnapshot, i.productNameSnapshot);
  const ids = [...products.keys()];
  const [images, reviews] = await Promise.all([
    prisma.productImage.findMany({ where: { productId: { in: ids } }, select: { productId: true, url: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.productReview.findMany({ where: { customerId: order.customerId!, productId: { in: ids } }, select: { productId: true, rating: true } }),
  ]);
  const cover = new Map<string, string>();
  for (const img of images) if (!cover.has(img.productId)) cover.set(img.productId, img.url);
  const ratingOf = new Map(reviews.map((r) => [r.productId, r.rating]));
  return {
    orderNumber: order.orderNumber,
    firstName: order.customerName.trim().split(/\s+/)[0] ?? "",
    canReview: REVIEWABLE.includes(order.status),
    items: ids.map((productId) => ({
      productId,
      name: products.get(productId)!,
      imageUrl: cover.get(productId) ?? null,
      reviewed: ratingOf.has(productId),
      rating: ratingOf.get(productId) ?? null,
    })),
  };
}

export async function submitReviewFromLink(code: string, input: LinkReviewInput) {
  const order = await orderFor(code);
  if (!REVIEWABLE.includes(order.status)) throw AppError.conflict("This order hasn't been delivered yet");
  if (!order.items.some((i) => i.productIdSnapshot === input.productId)) throw AppError.badRequest("That product isn't in this order");
  try {
    return await prisma.productReview.create({
      data: {
        productId: input.productId,
        customerId: order.customerId!,
        customerName: order.customerName,
        rating: input.rating,
        title: null,
        body: (input.body ?? "").trim(),
        isVerifiedPurchase: true,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw AppError.conflict("You've already reviewed this product");
    throw err;
  }
}

/** Once a day: one SMS to each customer whose order was delivered ASK_AFTER_DAYS..ASK_WITHIN_DAYS ago and hasn't been
 * asked. Each order is claimed (reviewRequestedAt) before its SMS, so a crashed or repeated run never texts twice; a
 * failed send is logged, not retried — a missed review request costs nothing. */
export async function sendReviewRequests(now = new Date()): Promise<{ sent: number; skipped: boolean }> {
  const sms = await getSmsSettings();
  if (!sms.customerReviewRequestEnabled) return { sent: 0, skipped: true };
  const { storeName } = await getSettings();
  const due = await prisma.order.findMany({
    where: {
      status: { in: REVIEWABLE as never },
      deletedAt: null,
      reviewRequestedAt: null,
      customerId: { not: null },
      statusChangedAt: { lte: new Date(now.getTime() - ASK_AFTER_DAYS * 86_400_000), gte: new Date(now.getTime() - ASK_WITHIN_DAYS * 86_400_000) },
    },
    select: { id: true, orderNumber: true, customerPhone: true },
    orderBy: { statusChangedAt: "asc" },
    take: MAX_PER_RUN,
  });
  const base = env.webOrigin.replace(/\/$/, "");
  let sent = 0;
  for (const o of due) {
    const claimed = await prisma.order.updateMany({ where: { id: o.id, reviewRequestedAt: null }, data: { reviewRequestedAt: now } });
    if (claimed.count === 0) continue;
    try {
      await getProviders().sms.send({ to: o.customerPhone, body: `${storeName}: পণ্যটি কেমন লাগলো? ১ মিনিটে রেটিং দিন: ${base}/r/${reviewCode(o.orderNumber)}` });
      sent += 1;
    } catch (err) {
      captureError(err, { msg: `[review-request] SMS for ${o.orderNumber} failed:` });
    }
  }
  return { sent, skipped: false };
}
