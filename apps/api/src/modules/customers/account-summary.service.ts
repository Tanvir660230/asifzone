import type { AccountOrderCard, AccountSummary, Order } from "@clothing-brand/shared";
import { toMajor } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getCurrency } from "../../domain/config/commerce-settings";
import { storeCreditBalance } from "../../domain/credit/customer-credit.service";
import { listActiveCoupons } from "../coupons/coupon.service";
import { PURCHASABLE_PRODUCT_WHERE } from "../products/product-public-select";

/** Orders still on their way to the customer — the account home shows the newest of these as "in progress". */
const OPEN_STATUSES: Order["status"][] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED"];
const RECENT_LIMIT = 3;

type OrderRow = {
  id: string;
  orderNumber: string;
  status: Order["status"];
  createdAt: Date;
  total: { toString(): string };
  courierTrackingLink: string | null;
  items: Array<{ variantId: string; productNameSnapshot: string; quantity: number }>;
};

/** First product photo per variant. OrderItem has no relation to ProductVariant (only the id), so this resolves it once
 * for every order on the page. A product that was deleted since simply has no photo. */
export async function firstImageByVariant(variantIds: string[]): Promise<Map<string, string>> {
  if (!variantIds.length) return new Map();
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, product: { select: { images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } } },
  });
  const out = new Map<string, string>();
  for (const v of variants) {
    const url = v.product.images[0]?.url;
    if (url) out.set(v.id, url);
  }
  return out;
}

function toCard(order: OrderRow, images: Map<string, string>): AccountOrderCard {
  const first = order.items[0];
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    total: Number(order.total.toString()),
    itemCount: order.items.reduce((sum, i) => sum + i.quantity, 0),
    lineCount: order.items.length,
    firstItemName: first?.productNameSnapshot ?? null,
    imageUrl: first ? (images.get(first.variantId) ?? null) : null,
    courierTrackingLink: order.courierTrackingLink,
  };
}

/** The account home in one read: the order in progress, a few recent orders, wallet totals and counts. Customer-facing
 * fields only — every order field here is also in the customer order view (orders/customer-order-view.ts). */
export async function getAccountSummary(customerId: string): Promise<AccountSummary> {
  const ownOrders = { customerId, deletedAt: null };
  const orderSelect = {
    id: true,
    orderNumber: true,
    status: true,
    createdAt: true,
    total: true,
    courierTrackingLink: true,
    items: { select: { variantId: true, productNameSnapshot: true, quantity: true }, orderBy: { id: "asc" as const } },
  };

  const currency = await getCurrency();
  const [customer, orderCount, activeRow, recentRows, balance, coupons, wishlistCount, pendingReturns, defaultAddress] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { rewardPoints: true, createdAt: true } }),
    prisma.order.count({ where: ownOrders }),
    prisma.order.findFirst({ where: { ...ownOrders, status: { in: OPEN_STATUSES } }, orderBy: { createdAt: "desc" }, select: orderSelect }),
    prisma.order.findMany({ where: ownOrders, orderBy: { createdAt: "desc" }, take: RECENT_LIMIT + 1, select: orderSelect }),
    storeCreditBalance(customerId, currency),
    listActiveCoupons(),
    prisma.wishlistItem.count({ where: { customerId, product: PURCHASABLE_PRODUCT_WHERE } }),
    prisma.returnRequest.count({ where: { customerId, status: "PENDING" } }),
    prisma.address.findFirst({ where: { customerId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
  ]);
  if (!customer) throw AppError.notFound("Customer not found");

  const recent = (recentRows as OrderRow[]).filter((o) => o.id !== activeRow?.id).slice(0, RECENT_LIMIT);
  const shown = [...(activeRow ? [activeRow as OrderRow] : []), ...recent];
  const images = await firstImageByVariant([...new Set(shown.flatMap((o) => (o.items[0] ? [o.items[0].variantId] : [])))]);

  return {
    currency,
    orderCount,
    activeOrder: activeRow ? toCard(activeRow as OrderRow, images) : null,
    recentOrders: recent.map((o) => toCard(o, images)),
    storeBalance: toMajor(balance),
    rewardPoints: customer.rewardPoints,
    couponCount: coupons.length,
    wishlistCount,
    pendingReturns,
    defaultAddress: defaultAddress ? { ...defaultAddress, createdAt: defaultAddress.createdAt.toISOString() } : null,
    memberSince: customer.createdAt.toISOString(),
  };
}
