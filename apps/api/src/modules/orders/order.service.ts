import { orderStatusEnum } from "@clothing-brand/shared";
import type {
  CheckoutInput,
  AdminCreateOrderInput,
  OrderListQuery,
  OrderListItemSummary,
  OrderItemLiveInfo,
  OrderStatus,
  UpdateOrderStatusInput,
  UpdateOrderDetailsInput,
  HoldOrderInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { generateOrderNumber } from "../../lib/order-number";
import { paginate } from "../../lib/paginate";
import { notify } from "../../lib/notify";
import { sendAdminOrderAlertSms, sendCustomerOrderSms, type CustomerTouchpoint } from "../../lib/order-sms";
import { evaluateCoupon, incrementCouponUsage } from "../coupons/coupon.service";
import { evaluateBundleForItems } from "../bundles/bundle.service";
import { resolveCartLines, effectivePrice } from "./cart-lines";
import { getSettings } from "../settings/settings.service";
import { awardDeliveryPoints, findOrCreateGuestCustomer } from "../customers/customer.service";
import { clearCart } from "../cart/cart.service";

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

export async function createOrder(
  input: CheckoutInput,
  customerId: string | null = null,
  // Only the admin "Create order" path sets these — attributes the order's opening PENDING
  // statusHistory entry to the staff member who entered it, so the order-detail timeline reads
  // "PENDING · <time> · <admin name> — Order manually entered..." for free, same as any other
  // admin-driven status change.
  opts: { changedByAdminId?: string; statusNote?: string } = {},
) {
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
  const shippingFee =
    input.shippingDivision === "Dhaka" ? Number(settings.shippingFeeDhaka) : Number(settings.shippingFeeOutsideDhaka);
  const total = subtotal - discount + (couponFreeShipping ? 0 : shippingFee);

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
    if (results.some((r) => r.count === 0)) {
      throw AppError.conflict("Stock changed while placing your order — please review your cart");
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
        items: {
          create: input.items.map((item) => {
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
            status: "PENDING",
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

  sendCustomerOrderSms(order, "PLACED");
  sendAdminOrderAlertSms(order);

  // A real purchase just happened — the server-side cart mirror (if any) is stale now, so the
  // abandonment sweep must not fire on it.
  if (customerId) {
    clearCart(customerId).catch((err) => console.error("[cart] clear after order failed:", err));
  }

  for (const item of input.items) {
    const variant = variantById.get(item.variantId)!;
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

  const returnRequests = await prisma.returnRequest.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });

  return { ...order, items, returnRequests };
}

/** Guest order tracking — requires the phone on the order too, so an order number alone (visible in a shared link, browser history, etc.) isn't enough to see someone else's address. */
export async function trackOrder(orderNumber: string, phone: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include });
  if (!order || order.deletedAt || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  return order;
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

  return {
    ...result,
    items: result.items.map((order) => ({
      ...order,
      items: [],
      statusHistory: [],
      itemsSummary: itemsSummaryByOrderId.get(order.id) ?? { totalItems: 0, firstItem: null },
    })),
  };
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

  const [todayOrders, todayRevenue, pending, needsAttention, followUpDue, statusGroups] = await Promise.all([
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: startOfToday } } }),
    prisma.order.aggregate({
      where: { deletedAt: null, createdAt: { gte: startOfToday } },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { deletedAt: null, status: { in: ["PENDING", "CONFIRMED"] } } }),
    // A fresh PENDING order isn't "stuck" yet — only one sitting unconfirmed for a day, one whose
    // payment gateway callback actually failed, one Steadfast has put "on hold" (couldn't reach the
    // recipient, address issue, etc.), or one whose confirmation-call follow-up is due, is something
    // an admin needs to go look at.
    prisma.order.count({
      where: {
        deletedAt: null,
        OR: [
          { status: "PENDING", createdAt: { lt: attentionCutoff } },
          { paymentStatus: "FAILED" },
          { courierStatus: "hold" },
          { status: "PENDING", followUpAt: { lte: now } },
        ],
      },
    }),
    // Same predicate as the follow-up arm above, exposed as its own number so the KPI strip and the
    // "Follow-up due" quick-filter pill can both show the exact callback-queue count, not just "how
    // many of several different things need attention" folded into one bucket.
    prisma.order.count({ where: { deletedAt: null, status: "PENDING", followUpAt: { lte: now } } }),
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

export async function updateOrderStatus(id: string, input: UpdateOrderStatusInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");

  // CANCELLED/REFUNDED are treated everywhere else (deleteOrder, cancelUnstartedOrder) as "this
  // order's reserved stock has already been put back" — but until now this was the one path that
  // could land an order on either status (an admin picking it from the dropdown, a bulk update, or
  // Steadfast reporting a parcel as cancelled) without actually restocking it, silently leaving the
  // units stuck as "sold". Guarded on the *previous* status so re-saving an already-cancelled/
  // refunded order (or the reverse transition never happening twice) can't double-credit inventory.
  const restockNeeded =
    (input.status === "CANCELLED" || input.status === "REFUNDED") &&
    existing.status !== "CANCELLED" &&
    existing.status !== "REFUNDED";

  const updated = await prisma.$transaction(async (tx) => {
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

/** verifiedAmount must come from the payment gateway's own validation record, never from the callback
 * body — it's the last line of defense against a valid val_id for one order being replayed against a
 * different, more expensive order's tran_id. */
export async function markOrderPaid(orderNumber: string, transactionId: string, verifiedAmount: number) {
  const { order, justPaid } = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { orderNumber } });
    if (!order) throw AppError.notFound("Order not found");
    if (order.paymentStatus === "PAID") return { order, justPaid: false };
    if (Math.abs(Number(order.total) - verifiedAmount) > 0.01) {
      throw AppError.badRequest("Payment amount does not match order total");
    }
    const updated = await tx.order.update({
      where: { orderNumber },
      data: { paymentStatus: "PAID", status: "CONFIRMED", paymentTransactionId: transactionId },
    });
    return { order: updated, justPaid: true };
  });

  // Only on the actual transition — a replayed gateway webhook hitting the idempotent early-return
  // above must not re-send the "confirmed" SMS.
  if (justPaid) sendCustomerOrderSms(order, "CONFIRMED");

  return order;
}

export async function markOrderFailed(orderNumber: string) {
  return prisma.order.update({ where: { orderNumber }, data: { paymentStatus: "FAILED" } });
}

/** Records the gateway session key returned by initSslcommerzSession right after order creation —
 * kept as a named service function (not a raw prisma call from the controller) so every order
 * mutation goes through one place. */
export async function setPaymentSessionKey(orderId: string, sessionKey: string) {
  await prisma.order.update({ where: { id: orderId }, data: { paymentSessionKey: sessionKey } });
}

/** Compensates a just-created order whose payment session could never be started (e.g. gateway unreachable) — restores the stock reserved for it and marks it cancelled rather than leaving it stuck as an unpayable PENDING order. */
export async function cancelUnstartedOrder(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      });
    }
    await tx.stockMovement.createMany({
      data: order.items.map((item) => ({
        variantId: item.variantId,
        change: item.quantity,
        reason: "ADJUSTMENT" as const,
        orderId: order.id,
      })),
    });

    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
  });
}

/** Soft-deletes an order (OWNER-only, see order.routes.ts) — hides it from every default query but
 * never physically removes the row, since it's a financial/audit record. Restocks the items first,
 * the same way cancelUnstartedOrder does, unless the order was already CANCELLED/REFUNDED (which
 * already restocked, so doing it again would double-credit the inventory). */
export async function deleteOrder(orderId: string, adminId: string) {
  const order = await getOrderById(orderId);
  if (order.deletedAt) return order;

  return prisma.$transaction(async (tx) => {
    if (order.status !== "CANCELLED" && order.status !== "REFUNDED") {
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }
      await tx.stockMovement.createMany({
        data: order.items.map((item) => ({
          variantId: item.variantId,
          change: item.quantity,
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
