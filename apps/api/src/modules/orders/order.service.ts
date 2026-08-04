import type { CheckoutInput, OrderListQuery, UpdateOrderStatusInput } from "@clothing-brand/shared";
import { SHIPPING_FEE_FLAT } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { generateOrderNumber } from "../../lib/order-number";
import { evaluateCoupon, incrementCouponUsage } from "../coupons/coupon.service";
import { computeFlashPrice, getActiveFlashInfoByProduct, type ActiveFlashInfo } from "../flash-sales/flash-sale-pricing";

const include = { items: true };

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

  const shippingFee = SHIPPING_FEE_FLAT;
  const total = subtotal - discount + shippingFee;

  const order = await prisma.$transaction(async (tx) => {
    for (const item of input.items) {
      const result = await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (result.count === 0) {
        throw AppError.conflict("Stock changed while placing your order — please review your cart");
      }
    }

    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId,
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

  return order;
}

export async function getOrderById(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include });
  if (!order) throw AppError.notFound("Order not found");
  return order;
}

/** Guest order tracking — requires the phone on the order too, so an order number alone (visible in a shared link, browser history, etc.) isn't enough to see someone else's address. */
export async function trackOrder(orderNumber: string, phone: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include });
  if (!order || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  return order;
}

export async function listOrders(query: OrderListQuery) {
  const where = {
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

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.order.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function updateOrderStatus(id: string, input: UpdateOrderStatusInput) {
  await getOrderById(id);
  return prisma.order.update({ where: { id }, data: { status: input.status }, include });
}

export async function markOrderPaid(orderNumber: string, transactionId: string) {
  return prisma.order.update({
    where: { orderNumber },
    data: { paymentStatus: "PAID", status: "CONFIRMED", paymentTransactionId: transactionId },
  });
}

export async function markOrderFailed(orderNumber: string) {
  return prisma.order.update({ where: { orderNumber }, data: { paymentStatus: "FAILED" } });
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
