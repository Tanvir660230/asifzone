import type { CheckoutInput, OrderListQuery, OrderStatus, UpdateOrderStatusInput, UpdateOrderDetailsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { generateOrderNumber } from "../../lib/order-number";
import { paginate } from "../../lib/paginate";
import { notify } from "../../lib/notify";
import { sendAdminOrderAlertSms, sendCustomerOrderSms, type CustomerTouchpoint } from "../../lib/order-sms";
import { evaluateCoupon, incrementCouponUsage } from "../coupons/coupon.service";
import { evaluateBundleForItems } from "../bundles/bundle.service";
import { computeFlashPrice, getActiveFlashInfoByProduct, type ActiveFlashInfo } from "../flash-sales/flash-sale-pricing";
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

/** A running flash sale overrides everything else — it's already the "this is the price right now" figure. */
function effectivePrice(
  variant: { productId: string; price: unknown; product: { basePrice: unknown } },
  flashByProduct: Map<string, ActiveFlashInfo>,
): number {
  const regularPrice = variant.price !== null ? Number(variant.price) : Number(variant.product.basePrice);
  const flash = flashByProduct.get(variant.productId);
  return flash ? computeFlashPrice(regularPrice, flash) : regularPrice;
}

export async function createOrder(input: CheckoutInput, customerId: string | null = null) {
  // A guest (no session cookie) still gets tied to a real Customer row, matched by email/phone —
  // see findOrCreateGuestCustomer for why (repeat-guest recognition, and a base to merge into once
  // they register/log in).
  if (!customerId) {
    customerId = await findOrCreateGuestCustomer(input.customerName, input.customerEmail ?? null, input.customerPhone);
  }

  const variantIds = input.items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: true },
  });

  if (variants.length !== new Set(variantIds).size) {
    throw AppError.badRequest("One or more items in your cart are no longer available");
  }

  const variantById = new Map(variants.map((v) => [v.id, v]));
  for (const item of input.items) {
    const variant = variantById.get(item.variantId)!;
    if (!variant.product.isActive) throw AppError.badRequest(`${variant.product.name} is no longer available`);
    if (variant.stock < item.quantity) {
      throw AppError.conflict(`Not enough stock for ${variant.product.name} (${variant.size}/${variant.color})`);
    }
  }

  const flashByProduct = await getActiveFlashInfoByProduct(variants.map((v) => v.productId));

  const subtotal = input.items.reduce((sum, item) => {
    const variant = variantById.get(item.variantId)!;
    return sum + effectivePrice(variant, flashByProduct) * item.quantity;
  }, 0);

  let discount = 0;
  let couponId: string | null = null;
  if (input.couponCode) {
    const evaluation = await evaluateCoupon(input.couponCode, subtotal);
    discount = evaluation.discount;
    couponId = evaluation.coupon!.id;
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
  const shippingFee =
    input.shippingDivision === "Dhaka" ? Number(settings.shippingFeeDhaka) : Number(settings.shippingFeeOutsideDhaka);
  const total = subtotal - discount + shippingFee;

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
        statusHistory: { create: { status: "PENDING" } },
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

export async function getOrderById(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include });
  if (!order) throw AppError.notFound("Order not found");
  return order;
}

/** Ownership-checked order detail for a logged-in customer's own order page. Attaches live
 * per-item availability (current price/stock/image) via the same manual variantId -> Product join
 * used elsewhere in this file (OrderItem has no Prisma relation to ProductVariant, only a plain
 * id column) — this is what "Reorder" checks before adding anything back to the cart. */
export async function getOrderForCustomer(customerId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include });
  if (!order || order.deletedAt || order.customerId !== customerId) throw AppError.notFound("Order not found");

  const variantIds = order.items.map((i) => i.variantId);
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

  const items = order.items.map((item) => {
    const variant = variantById.get(item.variantId);
    const available = variant && variant.product.isActive && !variant.product.deletedAt && variant.stock > 0;
    return {
      ...item,
      live: available
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

  const returnRequests = await prisma.returnRequest.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });

  return { ...order, items, returnRequests };
}

/** Guest order tracking — requires the phone on the order too, so an order number alone (visible in a shared link, browser history, etc.) isn't enough to see someone else's address. */
export async function trackOrder(orderNumber: string, phone: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include });
  if (!order || order.deletedAt || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  return order;
}

export async function listOrders(query: OrderListQuery) {
  const where = {
    // "deleted=true" is the dedicated admin restore view (only soft-deleted orders); otherwise the
    // normal listing never shows them.
    deletedAt: query.deleted === "true" ? { not: null } : null,
    ...(query.status ? { status: query.status } : {}),
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

  return paginate(
    query,
    (p) => prisma.order.findMany({ where, include, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.order.count({ where }),
  );
}

export async function updateOrderStatus(id: string, input: UpdateOrderStatusInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.update({
      where: { id },
      data: {
        status: input.status,
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

export async function updateOrderDetails(id: string, input: UpdateOrderDetailsInput) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  return prisma.order.update({ where: { id }, data: input, include });
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
