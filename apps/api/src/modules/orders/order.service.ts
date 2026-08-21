import { orderStatusEnum } from "@clothing-brand/shared";
import type {
  CheckoutInput,
  AdminCreateOrderInput,
  OrderListQuery,
  OrderListItemSummary,
  DeliveryScore,
  OrderItemLiveInfo,
  OrderStatus,
  PaymentStatus,
  UpdateOrderStatusInput,
  UpdateOrderDetailsInput,
  HoldOrderInput,
  AdjustOrderPriceInput,
  ReconcilePartialDeliveryInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { generateOrderNumber } from "../../lib/order-number";
import { paginate } from "../../lib/paginate";
import { notify } from "../../lib/notify";
import { sendAdminOrderAlertSms, sendCustomerOrderSms, type CustomerTouchpoint } from "../../lib/order-sms";
import { evaluateCoupon, incrementCouponUsage } from "../coupons/coupon.service";
import { evaluateBundleForItems } from "../bundles/bundle.service";
import { resolveCartLines, effectivePrice } from "./cart-lines";
import { getSettings } from "../settings/settings.service";
import { awardDeliveryPoints, findOrCreateGuestCustomer, checkAndUpdateDeliveryScore } from "../customers/customer.service";
import { clearCart } from "../cart/cart.service";
import { startPaymentSession } from "../payments/payment.service";

const include = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" as const }, include: { changedByAdmin: { select: { name: true } } } },
};

/** PENDING/PROCESSING/PACKED/RETURNED/REFUNDED intentionally have no SMS — only the touchpoints an
 * admin can toggle in the dashboard trigger one. */
const STATUS_SMS_TOUCHPOINT: Partial<Record<OrderStatus, CustomerTouchpoint>> = {
  CONFIRMED: "CONFIRMED",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

export type DerivedOrderPricing = Awaited<ReturnType<typeof deriveOrderPricing>>;

/** Everything about a checkout that can be computed without writing anything — cart-line pricing,
 * stock/active validation, coupon/bundle evaluation, shipping fee, and the final total. Shared by
 * createOrder (computes once, right before inserting) and the storefront digital-payment flow
 * (payment.service.ts's initiatePendingPayment computes it read-only to price the gateway session
 * and validate the cart before ever redirecting; settlePaymentSession recomputes it fresh at
 * settlement so a stale coupon/flash-sale price from sitting on the gateway page can't be
 * exploited). Never decrements stock — only insertOrderRecord's transaction does that. */
export async function deriveOrderPricing(input: CheckoutInput, customerId: string | null) {
  // A guest (no session cookie) still gets tied to a real Customer row, matched by email/phone —
  // see findOrCreateGuestCustomer for why (repeat-guest recognition, and a base to merge into once
  // they register/log in).
  if (!customerId) {
    customerId = await findOrCreateGuestCustomer(input.customerName, input.customerEmail ?? null, input.customerPhone);
  }

  const { subtotal, lines: cartLines, variantById, flashByProduct } = await resolveCartLines(input.items);

  for (const item of input.items) {
    const variant = variantById.get(item.variantId)!;
    if (!variant.product.isActive) throw AppError.badRequest(`${variant.product.name} is no longer available`);
    if (variant.stock < item.quantity) {
      throw AppError.conflict(`Not enough stock for ${variant.product.name} (${variant.size}/${variant.color})`);
    }
  }

  let discount = 0;
  let couponId: string | null = null;
  let couponFreeShipping = false;
  if (input.couponCode) {
    const evaluation = await evaluateCoupon(input.couponCode, subtotal, { cartLines, customerId });
    discount = evaluation.discount;
    couponFreeShipping = evaluation.freeShipping;
    couponId = evaluation.coupon.id;
  }

  // Bundle discounts are detected automatically from cart contents, not opted into like a coupon —
  // stacks additively with any coupon, clamped so the two together never exceed the subtotal.
  let bundleId: string | null = null;
  let bundleDiscount = 0;
  const bundleMatch = await evaluateBundleForItems(input.items);
  if (bundleMatch) {
    bundleId = bundleMatch.bundle.id;
    bundleDiscount = bundleMatch.discount;
    discount = Math.min(discount + bundleDiscount, subtotal);
  }

  const settings = await getSettings();
  if (input.paymentMethod === "COD" && !settings.codEnabled) {
    throw AppError.badRequest("Cash on Delivery is currently unavailable — please pay online instead");
  }
  if (input.paymentMethod === "SSLCOMMERZ" && !settings.onlinePaymentEnabled) {
    throw AppError.badRequest("Online payment is currently unavailable — please choose Cash on Delivery instead");
  }
  if (input.paymentMethod === "EPS_PG" && !settings.epsPaymentEnabled) {
    throw AppError.badRequest("Online payment is currently unavailable — please choose Cash on Delivery instead");
  }
  const shippingFee =
    input.shippingDivision === "Dhaka" ? Number(settings.shippingFeeDhaka) : Number(settings.shippingFeeOutsideDhaka);
  const total = subtotal - discount + (couponFreeShipping ? 0 : shippingFee);

  return { customerId, variantById, flashByProduct, subtotal, discount, couponId, couponFreeShipping, bundleId, bundleDiscount, shippingFee, total };
}

/** Inserts the actual Order row (+ items/statusHistory/StockMovement, coupon-usage increment) and
 * fires the post-commit side effects (admin notification, customer SMS, cart-mirror clear,
 * low-stock alerts) — the one place that writes an Order at all. `init` picks the row's starting
 * state: PENDING/UNPAID for a checkout that hasn't been paid yet (COD, admin-entered), or
 * CONFIRMED/PAID for a storefront digital payment materializing its order only now that the
 * gateway has confirmed success (see payment.service.ts's settlePaymentSession).
 *
 * `allowOversell`, set only by that settlement path, governs what happens if stock ran out while
 * the customer was on the gateway page: since money has already changed hands, the order is still
 * created (never strand a paid customer with nothing) and stock is decremented unconditionally
 * (allowed to go to/below 0) with an admin alert instead of the AppError.conflict a pre-payment
 * checkout throws in the same situation. */
export interface OrderItemSnapshot {
  variantId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  sizeSnapshot: string;
  colorSnapshot: string;
  priceSnapshot: number;
  quantity: number;
}

export async function insertOrderRecord(
  input: CheckoutInput,
  pricing: DerivedOrderPricing,
  init: { status: OrderStatus; paymentStatus: PaymentStatus },
  opts: {
    changedByAdminId?: string;
    statusNote?: string;
    customerSmsTouchpoint?: CustomerTouchpoint;
    allowOversell?: boolean;
    // Locked-in item snapshots from checkout-initiation time (payment.service.ts's
    // initiatePendingPayment) — used instead of re-deriving productNameSnapshot/priceSnapshot from
    // `pricing.variantById` so a paid order's line items always match exactly what the customer was
    // quoted and charged, immune to any catalog/flash-sale drift while they were on the gateway page.
    itemSnapshots?: OrderItemSnapshot[];
  } = {},
) {
  const { customerId, variantById, flashByProduct, subtotal, discount, couponId, bundleId, bundleDiscount, shippingFee, total } = pricing;
  const itemSnapshotByVariantId = opts.itemSnapshots ? new Map(opts.itemSnapshots.map((s) => [s.variantId, s])) : null;
  const oversoldItems: { name: string; size: string; color: string }[] = [];

  const order = await prisma.$transaction(async (tx) => {
    // Each item's conditional decrement is independent (distinct variantId rows) — running them
    // concurrently instead of one-at-a-time cuts checkout latency roughly in proportion to cart size.
    const results = await Promise.all(
      input.items.map((item) =>
        tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        }),
      ),
    );
    const shortfalls = input.items.filter((_, i) => results[i]!.count === 0);
    if (shortfalls.length > 0) {
      if (!opts.allowOversell) {
        throw AppError.conflict("Stock changed while placing your order — please review your cart");
      }
      // Payment already succeeded for this order — decrement unconditionally (stock can go
      // negative) rather than lose a paid customer's order to a late stock race.
      for (const item of shortfalls) {
        await tx.productVariant.update({ where: { id: item.variantId }, data: { stock: { decrement: item.quantity } } });
        const variant = variantById.get(item.variantId);
        const snapshot = itemSnapshotByVariantId?.get(item.variantId);
        oversoldItems.push({
          name: variant?.product.name ?? snapshot?.productNameSnapshot ?? item.variantId,
          size: variant?.size ?? snapshot?.sizeSnapshot ?? "",
          color: variant?.color ?? snapshot?.colorSnapshot ?? "",
        });
      }
    }

    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId,
        sessionId: input.sessionId ?? null,
        paymentMethod: input.paymentMethod,
        customerName: input.customerName,
        customerEmail: input.customerEmail ?? null,
        customerPhone: input.customerPhone,
        shippingDivision: input.shippingDivision,
        shippingDistrict: input.shippingDistrict,
        shippingArea: input.shippingArea,
        shippingAddressLine: input.shippingAddressLine,
        notes: input.notes ?? null,
        subtotal,
        discount,
        shippingFee,
        total,
        couponId,
        bundleId,
        bundleDiscount,
        status: init.status,
        paymentStatus: init.paymentStatus,
        items: {
          create: input.items.map((item) => {
            const snapshot = itemSnapshotByVariantId?.get(item.variantId);
            if (snapshot) return snapshot;
            const variant = variantById.get(item.variantId)!;
            return {
              variantId: item.variantId,
              productNameSnapshot: variant.product.name,
              skuSnapshot: variant.sku,
              sizeSnapshot: variant.size,
              colorSnapshot: variant.color,
              priceSnapshot: effectivePrice(variant, flashByProduct),
              quantity: item.quantity,
            };
          }),
        },
        statusHistory: {
          create: {
            status: init.status,
            changedByAdminId: opts.changedByAdminId ?? null,
            note: opts.statusNote ?? null,
          },
        },
      },
      include,
    });

    await tx.stockMovement.createMany({
      data: input.items.map((item) => ({
        variantId: item.variantId,
        change: -item.quantity,
        reason: "ORDER" as const,
        orderId: created.id,
      })),
    });

    if (couponId) await incrementCouponUsage(tx, couponId);

    return created;
  });

  notify({
    type: "order.created",
    title: `New order ${order.orderNumber}`,
    body: `${order.customerName} · ${input.items.length} item(s)`,
    link: `/admin/orders/${order.id}`,
  });

  if (oversoldItems.length > 0) {
    notify({
      type: "product.low_stock",
      title: `Oversold on paid order ${order.orderNumber}`,
      body: oversoldItems.map((i) => `${i.name} (${i.size}/${i.color})`).join(", "),
      link: `/admin/orders/${order.id}`,
    });
  }

  sendCustomerOrderSms(order, opts.customerSmsTouchpoint ?? "PLACED");
  sendAdminOrderAlertSms(order);

  // A real purchase just happened — the server-side cart mirror (if any) is stale now, so the
  // abandonment sweep must not fire on it.
  if (customerId) {
    clearCart(customerId).catch((err) => console.error("[cart] clear after order failed:", err));

    // Same Steadfast fraud_check the admin used to trigger by hand with "Check score" on the order
    // list — fired automatically the moment the order lands, so the delivery-score badge is already
    // populated by the time anyone opens the order. Fire-and-forget: Steadfast being slow/down must
    // never delay or fail checkout.
    checkAndUpdateDeliveryScore(customerId, order.customerPhone).catch((err) =>
      console.error(`[courier] auto delivery-score check failed for order ${order.orderNumber}:`, err),
    );
  }

  for (const item of input.items) {
    const variant = variantById.get(item.variantId);
    if (!variant) continue;
    const remaining = variant.stock - item.quantity;
    if (variant.product.trackInventory && remaining <= variant.product.lowStockThreshold) {
      notify({
        type: "product.low_stock",
        title: `Low stock: ${variant.product.name}`,
        body: `${variant.size}/${variant.color} — ${Math.max(0, remaining)} left`,
        link: `/admin/products/${variant.productId}/edit`,
      });
    }
  }

  return order;
}

export async function createOrder(
  input: CheckoutInput,
  customerId: string | null = null,
  // Only the admin "Create order" path sets these — attributes the order's opening PENDING
  // statusHistory entry to the staff member who entered it, so the order-detail timeline reads
  // "PENDING · <time> · <admin name> — Order manually entered..." for free, same as any other
  // admin-driven status change.
  opts: { changedByAdminId?: string; statusNote?: string } = {},
) {
  // A double-click / double-submit on the checkout button fires two POST /orders before the first
  // one's response ever comes back — without a guard, each call independently decrements stock and
  // inserts its own Order, so the customer (and, for online methods, EPS) ends up with two live
  // payment sessions for one purchase. Matched on the storefront's own client-generated sessionId,
  // never on phone number: a phone+total match was tried first and dropped, because it let anyone
  // who merely knew a stranger's phone number and order total get that stranger's full order (name,
  // address, items) echoed straight back in the response by submitting a matching checkout within
  // the window. sessionId is an unguessable per-browser token, so this can only ever match the same
  // browser's own in-flight request. Scoped to still-PENDING/UNPAID orders only — a genuine retry
  // after FAILED/CANCELLED must still create a fresh attempt, not get stuck reusing a dead one.
  // No sessionId on the request (shouldn't normally happen — the storefront always sends one) means
  // there's no safe key to dedupe on, so the guard is skipped entirely rather than falling back to
  // the leaky phone-based match.
  const pricing = await deriveOrderPricing(input, customerId);

  const sessionLockKey = input.sessionId ? `order-create-lock:${input.sessionId}` : null;
  const findDuplicateForSession = () =>
    prisma.order.findFirst({
      where: {
        deletedAt: null,
        status: "PENDING",
        paymentStatus: "UNPAID",
        sessionId: input.sessionId,
        total: pricing.total,
        createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      include,
    });

  if (sessionLockKey) {
    // Closes the gap between checking for a duplicate and committing the new order — without this,
    // two truly concurrent requests for the same session could both pass the check before either
    // one inserts. Best-effort like every other use of this Redis client (config/redis.ts): if
    // Redis is unreachable, fail open to the old race rather than block checkout entirely.
    const acquired = await redis.set(sessionLockKey, "1", "PX", 10_000, "NX").catch(() => "OK");

    if (!acquired) {
      // Another request for this exact session already holds the lock — it's either about to
      // insert or already has. Poll briefly for its row rather than racing a second insert.
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const existing = await findDuplicateForSession();
        if (existing) return existing;
      }
      // Lock holder never committed within ~3s (crashed mid-request?) — fall through and create a
      // fresh order rather than leaving the customer stuck.
    } else {
      const duplicate = await findDuplicateForSession();
      if (duplicate) {
        await redis.del(sessionLockKey).catch(() => {});
        return duplicate;
      }
    }
  }

  const order = await insertOrderRecord(input, pricing, { status: "PENDING", paymentStatus: "UNPAID" }, opts);

  // The row is committed now, so any concurrent request polling findDuplicateForSession above will
  // find it — safe to release the lock rather than wait out its full TTL.
  if (sessionLockKey) await redis.del(sessionLockKey).catch(() => {});

  return order;
}

/** The admin "Create order" page's entrypoint — for phone/Facebook orders a staff member types in
 * themselves. Deliberately a thin wrapper around createOrder rather than a parallel implementation:
 * routing through the exact same stock-decrement/pricing/snapshot transaction is what guarantees a
 * manually-entered order can never drift out of sync with real stock or the catalog's current
 * price — there is only one order-creation code path, admin or storefront. `markPaid` is applied
 * as a separate, explicit follow-up write (never silently folded into createOrder) so a manual
 * order defaults to the same UNPAID-until-collected state as any other COD order unless staff
 * tick the box themselves. */
export async function createManualOrder(input: AdminCreateOrderInput, adminId: string) {
  const order = await createOrder(input, input.customerId ?? null, {
    changedByAdminId: adminId,
    statusNote: "Order manually entered from the admin panel",
  });

  if (input.markPaid) {
    await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
  }

  return getOrderById(order.id);
}

/** Manual variantId -> Product join shared by getOrderById (admin) and getOrderForCustomer —
 * OrderItem has no Prisma relation to ProductVariant, only a plain id column, so this is the one
 * place that resolves it. `requireAvailable: true` (customer "Reorder") hides the product/thumbnail
 * link the moment it's not currently purchasable; admin never needs that gate — a staff member
 * should be able to open a product from an order regardless of its current stock/active state. */
async function attachLiveItemInfo<T extends { variantId: string }>(
  items: T[],
  opts: { requireAvailable: boolean },
): Promise<(T & { live: OrderItemLiveInfo | null })[]> {
  const variantIds = items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      price: true,
      stock: true,
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          basePrice: true,
          isActive: true,
          deletedAt: true,
          images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  return items.map((item) => {
    const variant = variantById.get(item.variantId);
    const available = variant && variant.product.isActive && !variant.product.deletedAt && variant.stock > 0;
    const usable = opts.requireAvailable ? available : Boolean(variant);
    return {
      ...item,
      live:
        usable && variant
          ? {
              productId: variant.product.id,
              productSlug: variant.product.slug,
              productName: variant.product.name,
              imageUrl: variant.product.images[0]?.url ?? null,
              price: Number(variant.price ?? variant.product.basePrice),
              maxStock: variant.stock,
            }
          : null,
    };
  });
}

export async function getOrderById(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include });
  if (!order) throw AppError.notFound("Order not found");
  const items = await attachLiveItemInfo(order.items, { requireAvailable: false });
  return { ...order, items };
}

/** Powers bulk label printing — fetches many orders in one round-trip instead of N single-order
 * GETs. Re-sorts to match the caller's id order and silently drops any id no longer found (e.g. an
 * order permanently deleted between selection and print) rather than failing the whole batch. */
export async function getOrdersByIds(ids: string[]) {
  const orders = await prisma.order.findMany({ where: { id: { in: ids } }, include });
  const byId = new Map(orders.map((o) => [o.id, o]));
  return ids.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o));
}

/** Ownership-checked order detail for a logged-in customer's own order page. Attaches live
 * per-item availability (current price/stock/image) via the same manual variantId -> Product join
 * used elsewhere in this file (OrderItem has no Prisma relation to ProductVariant, only a plain
 * id column) — this is what "Reorder" checks before adding anything back to the cart. */
export async function getOrderForCustomer(customerId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include });
  if (!order || order.deletedAt || order.customerId !== customerId) throw AppError.notFound("Order not found");

  const items = await attachLiveItemInfo(order.items, { requireAvailable: true });

  const returnRequests = await prisma.returnRequest.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    include: { exchangeOrder: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } } },
  });

  return { ...order, items, returnRequests };
}

/** Guest order tracking — requires the phone on the order too, so an order number alone (visible in a shared link, browser history, etc.) isn't enough to see someone else's address. */
export async function trackOrder(orderNumber: string, phone: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include });
  if (!order || order.deletedAt || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  return order;
}

// Two minutes is the same window createOrder's duplicate-submit guard uses — long enough that a
// customer who just got redirected to the gateway and immediately bounces back isn't told their own
// in-flight attempt is "in progress" by mistake, short enough that a genuinely abandoned session
// doesn't block a real retry for long.
const ACTIVE_SESSION_RETRY_GRACE_MS = 2 * 60 * 1000;

/** Starts a fresh payment attempt on an existing order — the storefront's "Retry payment" action
 * after a failed/abandoned checkout. Ownership-checked the same way trackOrder is (orderNumber +
 * phone, no account required). Deliberately scoped to still-PENDING orders only: stock is still
 * reserved for those, so nothing else needs to happen before starting a new PaymentSession. A
 * CANCELLED order (stock already restocked) requires a fresh checkout instead — retrying it here
 * would need to re-reserve stock that may already have been sold to someone else. */
export async function retryPayment(orderNumber: string, phone: string, ipAddress?: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { items: true } });
  if (!order || order.deletedAt || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  if (order.paymentMethod === "COD") throw AppError.badRequest("This order is Cash on Delivery");
  if (order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED") {
    throw AppError.badRequest("This order is already settled");
  }
  if (order.status !== "PENDING") {
    throw AppError.badRequest("This order can no longer be paid online — please contact support");
  }

  // Closes the gap between checking for an existing ACTIVE session and starting a new one — same
  // best-effort Redis lock pattern as createOrder's duplicate-submit guard, just order-scoped
  // instead of storefront-sessionId-scoped (retry has no client-generated sessionId to key off).
  // The DB-level one-ACTIVE-session-per-order partial unique index is the real backstop either way.
  const lockKey = `payment-retry-lock:${order.id}`;
  const acquired = await redis.set(lockKey, "1", "PX", 10_000, "NX").catch(() => "OK");
  if (!acquired) throw AppError.conflict("A payment attempt is already in progress for this order");

  try {
    const active = await prisma.paymentSession.findFirst({ where: { orderId: order.id, status: "ACTIVE" } });
    if (active) {
      if (Date.now() - active.createdAt.getTime() < ACTIVE_SESSION_RETRY_GRACE_MS) {
        throw AppError.conflict("A payment attempt is already in progress — please finish or wait a moment before retrying");
      }
      // Stale — no callback ever arrived and it's outlasted the grace window. Expire it explicitly
      // rather than leaving it for the reconciliation cron, so retry isn't blocked waiting on the
      // next sweep.
      await prisma.paymentSession.update({ where: { id: active.id }, data: { status: "EXPIRED" } });
    }
    return await startPaymentSession(order, ipAddress);
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

/** Shared by listOrders and exportOrdersCsv so the two never drift on what a given filter set matches. */
function buildOrderWhere(query: OrderListQuery) {
  return {
    // "deleted=true" is the dedicated admin restore view (only soft-deleted orders); otherwise the
    // normal listing never shows them.
    deletedAt: query.deleted === "true" ? { not: null } : null,
    // `statusIn` (a quick-filter preset like "Cancelled/Returned") takes priority over the plain
    // single-value `status` filter when both are somehow present.
    ...(query.statusIn?.length ? { status: { in: query.statusIn } } : query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    ...(query.courierBooked === "true"
      ? { courierConsignmentId: { not: null } }
      : query.courierBooked === "false"
        ? { courierConsignmentId: null }
        : {}),
    ...(query.courierStatus ? { courierStatus: query.courierStatus } : {}),
    ...(query.shippingDivision ? { shippingDivision: query.shippingDivision } : {}),
    ...(query.shippingDistrict ? { shippingDistrict: query.shippingDistrict } : {}),
    // The confirmation-call callback queue — implies status PENDING regardless of what `status`/
    // `statusIn` above resolved to, since the frontend only ever sends this on its own (same
    // mutually-exclusive pattern as the other quick filters).
    ...(query.followUpDue === "true" ? { status: "PENDING" as const, followUpAt: { lte: new Date() } } : {}),
    // The refund-risk queue — CANCELLED orders where the gateway payment was never refunded back
    // out, surfaced via the "Cancelled but paid" admin alert (updateOrderStatus/getOrderStats).
    ...(query.cancelledButPaid === "true" ? { status: "CANCELLED" as const, paymentStatus: "PAID" as const } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { orderNumber: { contains: query.search, mode: "insensitive" as const } },
            { customerName: { contains: query.search, mode: "insensitive" as const } },
            { customerPhone: { contains: query.search } },
          ],
        }
      : {}),
  };
}

/** Shared by listOrders and exportOrdersCsv — defaults to newest-first when the admin hasn't
 * clicked a sortable column header. */
function buildOrderOrderBy(query: OrderListQuery) {
  return { [query.sortBy ?? "createdAt"]: query.sortDir ?? "desc" };
}

export async function listOrders(query: OrderListQuery) {
  const where = buildOrderWhere(query);
  const orderBy = buildOrderOrderBy(query);

  // The list table only ever shows order-level fields (number, customer, total, status, date) —
  // it never touches the full line items or the status timeline. Those are exactly what the shared
  // `include` pulls in (a join per row for items, plus statusHistory joined to changedByAdmin), so
  // skipping them here is what keeps this endpoint fast as order history grows. `items`/`statusHistory`
  // are filled in as empty arrays purely to satisfy the shared `Order` type — the list page never
  // reads them; it reads `itemsSummary` instead (see below), which is deliberately cheap: bounded by
  // one page of orders, not the whole table.
  const result = await paginate(
    query,
    (p) => prisma.order.findMany({ where, orderBy, ...p }),
    () => prisma.order.count({ where }),
  );

  const itemsSummaryByOrderId = await buildItemsSummary(result.items.map((o) => o.id));
  const deliveryScoreByCustomerId = await buildDeliveryScoreByCustomerId(
    result.items.map((o) => o.customerId).filter((id): id is string => id !== null),
  );

  return {
    ...result,
    items: result.items.map((order) => ({
      ...order,
      items: [],
      statusHistory: [],
      itemsSummary: itemsSummaryByOrderId.get(order.id) ?? { totalItems: 0, firstItem: null },
      deliveryScore: order.customerId ? (deliveryScoreByCustomerId.get(order.customerId) ?? null) : null,
    })),
  };
}

/** Batched lookup backing the admin orders list's delivery-score badge — one Customer query for the
 * whole page rather than a join per row, mirroring buildItemsSummary below. Only ever reads the
 * cached fields written by checkDeliveryScoresBulk (courier.service.ts); this never calls Steadfast
 * itself. */
async function buildDeliveryScoreByCustomerId(customerIds: string[]) {
  const scores = new Map<string, DeliveryScore>();
  const uniqueIds = Array.from(new Set(customerIds));
  if (uniqueIds.length === 0) return scores;

  const customers = await prisma.customer.findMany({
    where: { id: { in: uniqueIds }, deliveryScoreCheckedAt: { not: null } },
    select: {
      id: true,
      deliverySuccessRate: true,
      deliveryTotalParcels: true,
      deliverySuccessParcels: true,
      deliveryCancelledParcels: true,
      deliveryScoreCheckedAt: true,
    },
  });

  for (const c of customers) {
    scores.set(c.id, {
      successRate: c.deliverySuccessRate,
      totalParcels: c.deliveryTotalParcels ?? 0,
      successParcels: c.deliverySuccessParcels ?? 0,
      cancelledParcels: c.deliveryCancelledParcels ?? 0,
      checkedAt: c.deliveryScoreCheckedAt!.toISOString(),
    });
  }

  return scores;
}

/** Batched "what's in this order" summary for the admin orders list's Product column — one row of
 * line items per order id, plus a single follow-up ProductVariant/Product join for the first item
 * of each order (for its name/thumbnail/link). Bounded by one page of orders (≈20-100), so it stays
 * cheap even though OrderItem has no Prisma relation to ProductVariant to include directly.
 * `totalItems` counts distinct line items (products), not summed quantity — "+2 more" should read
 * as two more products, not two more units of the first one. */
async function buildItemsSummary(orderIds: string[]) {
  const summaries = new Map<string, { totalItems: number; firstItem: OrderListItemSummary["firstItem"] | null }>();
  if (orderIds.length === 0) return summaries;

  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orderIds } },
    select: {
      orderId: true,
      variantId: true,
      productNameSnapshot: true,
      sizeSnapshot: true,
      colorSnapshot: true,
      quantity: true,
    },
  });

  const firstItemByOrderId = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    const count = (summaries.get(item.orderId)?.totalItems ?? 0) + 1;
    summaries.set(item.orderId, { totalItems: count, firstItem: null });
    if (!firstItemByOrderId.has(item.orderId)) firstItemByOrderId.set(item.orderId, item);
  }

  const variantIds = Array.from(new Set(Array.from(firstItemByOrderId.values(), (i) => i.variantId)));
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      product: {
        select: { id: true, slug: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  for (const [orderId, item] of firstItemByOrderId) {
    const variant = variantById.get(item.variantId);
    const existing = summaries.get(orderId)!;
    summaries.set(orderId, {
      ...existing,
      firstItem: {
        name: item.productNameSnapshot,
        size: item.sizeSnapshot,
        color: item.colorSnapshot,
        quantity: item.quantity,
        productId: variant?.product.id ?? null,
        productSlug: variant?.product.slug ?? null,
        imageUrl: variant?.product.images[0]?.url ?? null,
      },
    });
  }

  return summaries;
}

/** Powers the orders-page KPI strip — a handful of parallel count/aggregate queries (no per-row
 * joins) rather than pulling every order into Node to tally, so it stays cheap as order history grows. */
export async function getOrderStats() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const attentionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [todayOrders, todayRevenue, pending, needsAttention, followUpDue, cancelledButPaidCount, statusGroups] = await Promise.all([
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: startOfToday } } }),
    prisma.order.aggregate({
      where: { deletedAt: null, createdAt: { gte: startOfToday } },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { deletedAt: null, status: { in: ["PENDING", "CONFIRMED"] } } }),
    // A fresh PENDING order isn't "stuck" yet — only one sitting unconfirmed for a day, one whose
    // payment gateway callback actually failed, one Steadfast has put "on hold" (couldn't reach the
    // recipient, address issue, etc.), one whose confirmation-call follow-up is due, or one that's
    // CANCELLED with the gateway payment still uncollected-back, is something an admin needs to go
    // look at.
    prisma.order.count({
      where: {
        deletedAt: null,
        OR: [
          { status: "PENDING", createdAt: { lt: attentionCutoff } },
          { paymentStatus: "FAILED" },
          { courierStatus: "hold" },
          { status: "PENDING", followUpAt: { lte: now } },
          { status: "CANCELLED", paymentStatus: "PAID" },
        ],
      },
    }),
    // Same predicate as the follow-up arm above, exposed as its own number so the KPI strip and the
    // "Follow-up due" quick-filter pill can both show the exact callback-queue count, not just "how
    // many of several different things need attention" folded into one bucket.
    prisma.order.count({ where: { deletedAt: null, status: "PENDING", followUpAt: { lte: now } } }),
    // Same reasoning as followUpDue above — its own number so the "Cancelled but paid" tile/pill can
    // show the exact refund-risk count, not just its share of the combined needsAttention bucket.
    prisma.order.count({ where: { deletedAt: null, status: "CANCELLED", paymentStatus: "PAID" } }),
    // Powers the status-filter pills' "(N)" counts — one row per status that has at least one
    // order, zero-filled below for the rest so every pill always shows a count.
    prisma.order.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
  ]);

  const statusCounts = Object.fromEntries(orderStatusEnum.options.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const group of statusGroups) statusCounts[group.status] = group._count;

  return {
    todayOrders,
    todayRevenue: Number(todayRevenue._sum.total ?? 0),
    pending,
    needsAttention,
    followUpDue,
    cancelledButPaidCount,
    statusCounts,
  };
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Same filters as listOrders (via buildOrderWhere) but unpaginated — admins export a whole filtered
 * range at once (e.g. a month, for courier/accounting handoff), not just the current page. */
export async function exportOrdersCsv(query: OrderListQuery): Promise<string> {
  const where = buildOrderWhere(query);
  const orders = await prisma.order.findMany({ where, orderBy: buildOrderOrderBy(query) });

  const header = [
    "orderNumber",
    "customerName",
    "customerPhone",
    "customerEmail",
    "status",
    "paymentMethod",
    "paymentStatus",
    "subtotal",
    "discount",
    "shippingFee",
    "priceAdjustment",
    "total",
    "shippingDivision",
    "shippingDistrict",
    "shippingArea",
    "shippingAddressLine",
    "trackingNumber",
    "carrier",
    "createdAt",
  ];

  const rows = orders.map((o) => [
    o.orderNumber,
    o.customerName,
    o.customerPhone,
    o.customerEmail ?? "",
    o.status,
    o.paymentMethod,
    o.paymentStatus,
    o.subtotal,
    o.discount,
    o.shippingFee,
    o.priceAdjustment,
    o.total,
    o.shippingDivision,
    o.shippingDistrict,
    o.shippingArea,
    o.shippingAddressLine,
    o.trackingNumber ?? "",
    o.carrier ?? "",
    o.createdAt.toISOString(),
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Steadfast exposes no per-order fee, only a merchant wallet balance (lib/steadfast.ts) — this is
 * an admin-entered estimate of their return-leg fee (StoreSetting.courierReturnFeeDhaka/
 * OutsideDhaka), zone-matched the same way shippingFee is at checkout. Only called from the two
 * places that actually log a CourierLossEvent, not on every order lookup. */
async function getCourierReturnFee(shippingDivision: string): Promise<number> {
  const settings = await getSettings();
  return shippingDivision === "Dhaka" ? Number(settings.courierReturnFeeDhaka) : Number(settings.courierReturnFeeOutsideDhaka);
}

export async function updateOrderStatus(id: string, input: UpdateOrderStatusInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");

  // Computed up front (doesn't depend on the row lock below) and only when it might actually be
  // needed — a plain settings lookup on every single status change would otherwise be wasted for
  // the overwhelming majority of updates that aren't "cancel an order that already has a courier
  // booked". Still gated on restockNeeded inside the transaction, since that's what proves this is
  // a genuine new transition into CANCELLED, not a re-save of an already-cancelled order.
  const courierLossFee =
    input.status === "CANCELLED" && existing.courierConsignmentId
      ? await getCourierReturnFee(existing.shippingDivision)
      : null;

  const updated = await prisma.$transaction(async (tx) => {
    // Row-locked re-read of status, not the pre-transaction snapshot above — two concurrent status
    // changes on the same order (e.g. one to CANCELLED, one to SHIPPED) would otherwise both compute
    // restockNeeded from the same stale `existing.status`, and whichever transaction commits last
    // wins on `status` while restock bookkeeping reflects only whichever transaction saw it first.
    // FOR UPDATE blocks the second transaction until the first commits, so it sees the real prior status.
    const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus }>>`
      SELECT status FROM "Order" WHERE id = ${id} FOR UPDATE
    `;
    // existing (fetched moments ago, same id) already proved this row exists.
    if (!locked) throw AppError.notFound("Order not found");

    // CANCELLED/REFUNDED are treated everywhere else (deleteOrder) as "this order's reserved stock
    // has already been put back" — but until now this was the one path that
    // could land an order on either status (an admin picking it from the dropdown, a bulk update, or
    // Steadfast reporting a parcel as cancelled) without actually restocking it, silently leaving the
    // units stuck as "sold". Guarded on the *previous* status so re-saving an already-cancelled/
    // refunded order (or the reverse transition never happening twice) can't double-credit inventory.
    const restockNeeded =
      (input.status === "CANCELLED" || input.status === "REFUNDED") &&
      locked.status !== "CANCELLED" &&
      locked.status !== "REFUNDED";

    if (restockNeeded) {
      for (const item of existing.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }
      await tx.stockMovement.createMany({
        data: existing.items.map((item) => ({
          variantId: item.variantId,
          change: item.quantity,
          reason: "ADJUSTMENT" as const,
          orderId: id,
          adminId: changedByAdminId ?? null,
        })),
      });

      if (courierLossFee !== null) {
        await tx.courierLossEvent.create({
          data: { orderId: id, amount: courierLossFee, reason: "CANCELLED_POST_BOOKING" },
        });
      }
    }

    const order = await tx.order.update({
      where: { id },
      data: {
        status: input.status,
        // Leaving PENDING means the confirmation call finally resolved (confirmed, cancelled, or
        // otherwise moved on — including Steadfast auto-resolving it) — any outstanding follow-up
        // hold is now stale. Moving *to* PENDING leaves followUpAt untouched (undefined = no-op in
        // Prisma); only the explicit hold action (holdOrderForFollowUp) ever sets it.
        followUpAt: input.status === "PENDING" ? undefined : null,
        statusHistory: {
          create: { status: input.status, note: input.note ?? null, changedByAdminId: changedByAdminId ?? null },
        },
      },
      include,
    });
    return order;
  });

  if (input.status === "DELIVERED" && updated.customerId) {
    await awardDeliveryPoints(updated.customerId, updated.id, Number(updated.total));
  }

  // A cancellation on an order that was actually already paid is a real money-risk case — EPS/
  // SSLCommerz already took the payment, and nothing else in this function initiates a refund, so an
  // admin has to see this and act rather than the order silently sitting cancelled with money still
  // collected. Checked against the pre-transaction snapshot, not `updated` — paymentStatus isn't
  // part of what this function changes, so it can't have been affected by the update itself. Gated on
  // the *previous* status (same guard shape as restockNeeded above) so re-saving an already-cancelled
  // order — e.g. a bulk-status action re-applied over a mixed selection — doesn't refire this alert
  // for every order that was cancelled-but-paid before this call ever started.
  if (input.status === "CANCELLED" && existing.status !== "CANCELLED" && existing.paymentStatus === "PAID") {
    notify({
      type: "order.cancelled_but_paid",
      title: `Cancelled but paid: ${updated.orderNumber}`,
      body: `${updated.customerName} · ${formatBdt(Number(updated.total))} — refund may be owed`,
      link: `/admin/orders/${updated.id}`,
    });
  }

  const touchpoint = STATUS_SMS_TOUCHPOINT[input.status];
  if (touchpoint) sendCustomerOrderSms(updated, touchpoint);

  return updated;
}

const ORDER_DETAIL_FIELD_LABELS = {
  customerName: "Name",
  customerPhone: "Phone",
  shippingDivision: "Division",
  shippingDistrict: "District",
  shippingArea: "Area",
  shippingAddressLine: "Address",
} satisfies Partial<Record<keyof UpdateOrderDetailsInput, string>>;

/** Builds a single human-readable diff string ("Name: "X" -> "Y"; Phone: ...") for whichever
 * customer/shipping fields this particular updateOrderDetails call actually changed, or null if
 * none of those six fields were part of the request (e.g. a tracking-number- or admin-notes-only
 * save). Who made the change is already captured by OrderStatusHistory.changedByAdmin — no need to
 * repeat it in the text. */
function buildOrderDetailsDiffNote(
  existing: Pick<
    Awaited<ReturnType<typeof getOrderById>>,
    "customerName" | "customerPhone" | "shippingDivision" | "shippingDistrict" | "shippingArea" | "shippingAddressLine"
  >,
  input: UpdateOrderDetailsInput,
): string | null {
  const changes: string[] = [];
  for (const key of Object.keys(ORDER_DETAIL_FIELD_LABELS) as Array<keyof typeof ORDER_DETAIL_FIELD_LABELS>) {
    const nextValue = input[key];
    if (nextValue !== undefined && nextValue !== existing[key]) {
      changes.push(`${ORDER_DETAIL_FIELD_LABELS[key]}: "${existing[key]}" -> "${nextValue}"`);
    }
  }
  return changes.length ? `Order details updated — ${changes.join("; ")}` : null;
}

export async function updateOrderDetails(id: string, input: UpdateOrderDetailsInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");

  const diffNote = buildOrderDetailsDiffNote(existing, input);
  // Steadfast's parcel is booked with a fixed name/phone/address as of booking time — changing
  // these here would silently desync from what the courier actually has on file (there's no
  // Steadfast API to push a correction). Same guard/remedy as adjustOrderPrice.
  if (diffNote && existing.courierConsignmentId) {
    throw AppError.badRequest("Cannot change name/address after a courier has been booked — unlink the booking first");
  }

  return prisma.order.update({
    where: { id },
    data: {
      ...input,
      ...(diffNote
        ? { statusHistory: { create: { status: existing.status, note: diffNote, changedByAdminId: changedByAdminId ?? null } } }
        : {}),
    },
    include,
  });
}

/** Node ships with full ICU by default, so Intl can format directly into Asia/Dhaka regardless of
 * the server process's own timezone — Bangladesh has one fixed UTC+6 offset with no DST, so this is
 * a pure display concern; followUpAt itself is always stored/compared as an absolute UTC instant. */
function formatBdDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Records the outcome of a confirmation call that was neither a clear yes nor a clear no — sets a
 * follow-up time and bumps the lifetime call-attempt counter, but deliberately does NOT touch
 * `status` (stays PENDING); only orders currently PENDING are eligible, so an order that's already
 * CONFIRMED/CANCELLED/etc. can't accidentally be shoved back into the callback queue. */
export async function holdOrderForFollowUp(id: string, input: HoldOrderInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (existing.status !== "PENDING") {
    throw AppError.badRequest("Only pending orders can be put on a follow-up hold");
  }

  const note = input.note
    ? `On hold — follow up ${formatBdDateTime(input.followUpAt)}: ${input.note}`
    : `On hold — follow up ${formatBdDateTime(input.followUpAt)}`;

  return prisma.order.update({
    where: { id },
    data: {
      followUpAt: input.followUpAt,
      callAttempts: { increment: 1 },
      statusHistory: { create: { status: existing.status, note, changedByAdminId: changedByAdminId ?? null } },
    },
    include,
  });
}

/** Undoes an accidental/stale hold without touching status or callAttempts — e.g. an admin picked
 * the wrong follow-up time, or the call actually happened right after clicking Hold. No-ops
 * (returns the order unchanged) if there's no hold to clear. */
export async function clearOrderHold(id: string, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (!existing.followUpAt) return existing;

  return prisma.order.update({
    where: { id },
    data: {
      followUpAt: null,
      statusHistory: { create: { status: existing.status, note: "Follow-up hold cleared", changedByAdminId: changedByAdminId ?? null } },
    },
    include,
  });
}

const PRICE_ADJUSTMENT_LOCKED_STATUSES: OrderStatus[] = ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED"];

function formatBdt(amount: number): string {
  return `৳${Math.round(amount).toLocaleString("en-BD")}`;
}

/** Lets an admin nudge the order total up or down during the confirmation call (a negotiated
 * discount, a remote-area surcharge) — replaces whatever priceAdjustment was already set, it isn't
 * additive, so re-saving the same value is a no-op. Blocked once a courier is booked, since
 * Steadfast's COD amount is fixed to `total` at that point (see hasUsableAddress's neighbor in
 * courier.service.ts), and on terminal orders where the sale is already settled. */
export async function adjustOrderPrice(id: string, input: AdjustOrderPriceInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (PRICE_ADJUSTMENT_LOCKED_STATUSES.includes(existing.status)) {
    throw AppError.badRequest(`Cannot adjust price on an order that is ${existing.status.toLowerCase()}`);
  }
  if (existing.courierConsignmentId) {
    throw AppError.badRequest("Cannot adjust price after a courier has been booked — unlink the booking first");
  }

  const previousAdjustment = Number(existing.priceAdjustment);
  if (previousAdjustment === input.priceAdjustment) return existing;

  // A FREE_SHIPPING coupon waives the fee at checkout (see createOrder's `total` calc) even though
  // `shippingFee` itself still holds the would-be fee for record-keeping — re-derive whether it
  // actually applies here instead of assuming it's always owed.
  const orderCoupon = existing.couponId
    ? await prisma.coupon.findUnique({ where: { id: existing.couponId }, select: { type: true } })
    : null;
  const shippingOwed = orderCoupon?.type === "FREE_SHIPPING" ? 0 : Number(existing.shippingFee);
  const newTotal = Number(existing.subtotal) - Number(existing.discount) + shippingOwed + input.priceAdjustment;
  if (newTotal < 0) throw AppError.badRequest("Total cannot be negative");

  const note =
    `Price adjustment: ${formatBdt(previousAdjustment)} -> ${formatBdt(input.priceAdjustment)} (total ${formatBdt(Number(existing.total))} -> ${formatBdt(newTotal)})` +
    (input.note ? ` — ${input.note}` : "");

  return prisma.order.update({
    where: { id },
    data: {
      priceAdjustment: input.priceAdjustment,
      total: newTotal,
      statusHistory: { create: { status: existing.status, note, changedByAdminId: changedByAdminId ?? null } },
    },
    include,
  });
}

// markOrderPaid, markOrderFailed, isOrderPaid, and setPaymentSessionKey used to live here — they're
// superseded by settlePaymentSession/markPaymentSessionFailed/isPaymentSessionSettled/
// startPaymentSession/initiatePendingPayment in payments/payment.service.ts, which operate on
// PaymentSession (an order can now have more than one payment attempt, or none at all until
// settlement) rather than directly on Order's deprecated paymentSessionKey/paymentTransactionId
// fields. cancelUnstartedOrder (restocked+cancelled an Order whose payment session failed to start)
// used to live here too — no longer reachable now that a digital-payment checkout never creates an
// Order before settlement in the first place (see order.controller.ts's create).

/** Soft-deletes an order (OWNER-only, see order.routes.ts) — hides it from every default query but
 * never physically removes the row, since it's a financial/audit record. Restocks the items first,
 * the same way cancelUnstartedOrder does, unless the order was already CANCELLED/REFUNDED (which
 * already restocked, so doing it again would double-credit the inventory). Restocks
 * `quantity - returnedQuantity`, not the full original quantity — a reconciled PARTIALLY_DELIVERED
 * order already put the returned units back via reconcilePartialDelivery, so restocking the full
 * amount here again would double-credit exactly those units a second time. */
export async function deleteOrder(orderId: string, adminId: string) {
  const order = await getOrderById(orderId);
  if (order.deletedAt) return order;

  return prisma.$transaction(async (tx) => {
    if (order.status !== "CANCELLED" && order.status !== "REFUNDED") {
      const toRestock = order.items
        .map((item) => ({ variantId: item.variantId, amount: item.quantity - item.returnedQuantity }))
        .filter((entry) => entry.amount > 0);

      for (const entry of toRestock) {
        await tx.productVariant.update({
          where: { id: entry.variantId },
          data: { stock: { increment: entry.amount } },
        });
      }
      await tx.stockMovement.createMany({
        data: toRestock.map((entry) => ({
          variantId: entry.variantId,
          change: entry.amount,
          reason: "ADJUSTMENT" as const,
          orderId: order.id,
          adminId,
        })),
      });
    }

    return tx.order.update({
      where: { id: orderId },
      data: { deletedAt: new Date(), deletedByAdminId: adminId },
      include,
    });
  });
}

/** Restores stock for a RETURNED order's items and logs a matching RETURN-reason StockMovement —
 * called right after a return request is approved. Uses `updateMany` (not `update`) per item since
 * a variant referenced only by OrderItem has no FK guarantee it still exists (its Product could
 * have been permanently deleted, cascading the variant away with it) — silently skips restock+
 * logging for any variant that's actually gone rather than throwing mid-loop and leaving some
 * items restocked and others not. */
export async function restockReturnedOrderItems(
  orderId: string,
  items: Array<{ variantId: string; quantity: number }>,
  adminId: string,
) {
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const result = await tx.productVariant.updateMany({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      });
      if (result.count === 0) continue;
      await tx.stockMovement.create({
        data: {
          variantId: item.variantId,
          change: item.quantity,
          reason: "RETURN",
          orderId,
          adminId,
          note: "Stock restored — return approved",
        },
      });
    }
  });
}

/** Resolves a PARTIALLY_DELIVERED order (Steadfast reported "partial_delivered" — the customer
 * accepted only some of the parcel) by having an admin declare how many units of each line item
 * actually came back; anything not listed (or listed as 0) is assumed kept by the customer.
 * Restocks exactly those units and logs a PARTIAL_RETURN CourierLossEvent if anything came back —
 * the return leg cost the same courier round trip as a full cancellation. Status deliberately
 * stays PARTIALLY_DELIVERED afterward (never rewritten to DELIVERED): the exact COD amount actually
 * collected on a partial delivery isn't knowable from Steadfast's API, so `total`/delivery-points/
 * the DELIVERED SMS are all intentionally left untouched rather than guessed at — this only fixes
 * the stock-accuracy gap, not the order's financial record. */
export async function reconcilePartialDelivery(orderId: string, input: ReconcilePartialDeliveryInput, adminId: string) {
  const existing = await getOrderById(orderId);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (existing.status !== "PARTIALLY_DELIVERED") {
    throw AppError.badRequest("Only a partially-delivered order can be reconciled");
  }
  if (existing.partialDeliveryReconciledAt) {
    throw AppError.conflict("This order has already been reconciled");
  }

  const itemById = new Map(existing.items.map((item) => [item.id, item]));
  for (const entry of input.items) {
    const item = itemById.get(entry.orderItemId);
    if (!item) throw AppError.badRequest(`Order item ${entry.orderItemId} does not belong to this order`);
    if (entry.returnedQuantity > item.quantity) {
      throw AppError.badRequest(
        `Returned quantity for ${item.productNameSnapshot} cannot exceed the ordered quantity (${item.quantity})`,
      );
    }
  }

  const returnedEntries = input.items.filter((entry) => entry.returnedQuantity > 0);
  const courierLossFee = returnedEntries.length > 0 ? await getCourierReturnFee(existing.shippingDivision) : null;

  return prisma.$transaction(async (tx) => {
    for (const entry of returnedEntries) {
      const item = itemById.get(entry.orderItemId)!;
      const result = await tx.productVariant.updateMany({
        where: { id: item.variantId },
        data: { stock: { increment: entry.returnedQuantity } },
      });
      if (result.count > 0) {
        await tx.stockMovement.create({
          data: {
            variantId: item.variantId,
            change: entry.returnedQuantity,
            reason: "RETURN",
            orderId,
            adminId,
            note: "Stock restored — partial delivery reconciliation",
          },
        });
      }
      await tx.orderItem.update({ where: { id: entry.orderItemId }, data: { returnedQuantity: entry.returnedQuantity } });
    }

    if (courierLossFee !== null) {
      await tx.courierLossEvent.create({ data: { orderId, amount: courierLossFee, reason: "PARTIAL_RETURN" } });
    }

    const note = returnedEntries.length
      ? `Partial delivery reconciled — ${returnedEntries.length} item(s) returned and restocked`
      : "Partial delivery reconciled — customer kept the full shipment";

    // Gives the returned portion its own visible record in the same Return Requests list an admin
    // already checks for customer-initiated returns, rather than leaving it discoverable only by
    // reading this order's status history. Auto-approved (not PENDING) since the items are already
    // physically back — there's no review decision left to make, just a paper trail of what came
    // back and why. Skipped for the rare pre-findOrCreateGuestCustomer order with no linked
    // Customer, since ReturnRequest.customerId is required.
    if (returnedEntries.length > 0 && existing.customerId) {
      const itemLines = returnedEntries.map((entry) => {
        const item = itemById.get(entry.orderItemId)!;
        return `${item.productNameSnapshot} (${item.sizeSnapshot}/${item.colorSnapshot}) x${entry.returnedQuantity}`;
      });
      await tx.returnRequest.create({
        data: {
          orderId,
          customerId: existing.customerId,
          type: "RETURN",
          reason: "Courier partial delivery — rejected by customer",
          note: itemLines.join(", "),
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
        },
      });
    }

    return tx.order.update({
      where: { id: orderId },
      data: {
        partialDeliveryReconciledAt: new Date(),
        statusHistory: { create: { status: "PARTIALLY_DELIVERED", note, changedByAdminId: adminId } },
      },
      include,
    });
  });
}

/** Un-hides a soft-deleted order. Deliberately does not re-decrement stock — the units restored at
 * delete time may already have been sold to someone else in the meantime, and blindly re-reserving
 * them could take stock negative. Restoring is a correction of the record, not a re-placement of
 * the order. */
export async function restoreOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound("Order not found");
  if (!order.deletedAt) return getOrderById(orderId);

  return prisma.order.update({
    where: { id: orderId },
    data: { deletedAt: null, deletedByAdminId: null },
    include,
  });
}

/** Irreversible — only meaningful for an order already in Trash (mirrors permanentlyDeleteCategory).
 * OrderItem/OrderStatusHistory/ReturnRequest all cascade-delete with the order. StockMovement.orderId
 * is a plain historical column with no FK relation to Order (it's an append-only ledger, see
 * restockReturnedOrderItems), so it's untouched and simply keeps a now-orphaned reference — by design,
 * an audit ledger is meant to outlive the order it references. */
export async function permanentlyDeleteOrder(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order.deletedAt) throw AppError.badRequest("Move the order to Trash before deleting it permanently");

  await prisma.order.delete({ where: { id: orderId } });
}

/** Bulk actions run each order through the same single-order function used elsewhere (not a raw
 * `updateMany`), so every side effect a normal status change carries — status-history row, delivery
 * points on DELIVERED, the customer SMS touchpoint — still fires for each order in the batch. */
export async function bulkUpdateOrderStatus(ids: string[], status: OrderStatus, adminId: string) {
  await Promise.all(ids.map((id) => updateOrderStatus(id, { status }, adminId)));
}

export async function bulkDeleteOrders(ids: string[], adminId: string) {
  await Promise.all(ids.map((id) => deleteOrder(id, adminId)));
}

export async function bulkPermanentlyDeleteOrders(ids: string[]) {
  await Promise.all(ids.map((id) => permanentlyDeleteOrder(id)));
}
