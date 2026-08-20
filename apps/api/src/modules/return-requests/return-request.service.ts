import { Prisma } from "@prisma/client";
import type { CreateReturnRequestInput, ReviewReturnRequestInput, ReturnRequestListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { generateOrderNumber } from "../../lib/order-number";
import { updateOrderStatus, restockReturnedOrderItems } from "../orders/order.service";

const include = {
  order: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } },
  exchangeOrder: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } },
};

export async function createReturnRequest(customerId: string, input: CreateReturnRequestInput) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
  if (!order || order.customerId !== customerId) throw AppError.notFound("Order not found");
  if (order.status !== "DELIVERED") {
    throw AppError.badRequest("Only delivered orders are eligible for a return request");
  }

  const existingPending = await prisma.returnRequest.findFirst({
    where: { orderId: input.orderId, status: "PENDING" },
  });
  if (existingPending) throw AppError.conflict("A return request for this order is already pending review");

  // EXCHANGE-only: resolve and snapshot which line item and which replacement variant were picked
  // — snapshotting size/color here (like OrderItem itself does) means the request stays displayable
  // even if the variant/product is later edited or deleted. Stock availability is deliberately not
  // checked here (only at approval time, in createExchangeOrder) since it may change between now
  // and review — this only validates the *request itself* makes sense.
  let exchangeFields: {
    orderItemId: string;
    originalSizeSnapshot: string;
    originalColorSnapshot: string;
    requestedVariantId: string;
    requestedSizeSnapshot: string;
    requestedColorSnapshot: string;
  } | null = null;

  if (input.type === "EXCHANGE") {
    const item = order.items.find((i) => i.id === input.orderItemId);
    if (!item) throw AppError.badRequest("Select an item from this order to exchange");

    const requestedVariant = await prisma.productVariant.findUnique({ where: { id: input.requestedVariantId } });
    if (!requestedVariant) throw AppError.badRequest("The selected item is no longer available");

    // Exchanges aren't restricted to the same product any more — a customer can request a
    // completely different item, not just a different size/color of what they already have.
    // createExchangeOrder (below) handles the price difference: any positive gap is collected via
    // COD on the replacement shipment rather than assumed free like a same-price swap.
    if (requestedVariant.id === item.variantId) {
      throw AppError.badRequest("Choose a different item to exchange for");
    }

    exchangeFields = {
      orderItemId: item.id,
      originalSizeSnapshot: item.sizeSnapshot,
      originalColorSnapshot: item.colorSnapshot,
      requestedVariantId: requestedVariant.id,
      requestedSizeSnapshot: requestedVariant.size,
      requestedColorSnapshot: requestedVariant.color,
    };
  }

  try {
    return await prisma.returnRequest.create({
      data: {
        orderId: input.orderId,
        customerId,
        type: input.type,
        reason: input.reason,
        note: input.note ?? null,
        ...exchangeFields,
      },
      include,
    });
  } catch (err) {
    // Backstopped by a partial unique index (one PENDING request per order — see the migration
    // and the comment on ReturnRequest.status in schema.prisma) for the race the check above can't
    // fully close on its own.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A return request for this order is already pending review");
    }
    throw err;
  }
}

export async function listMyReturnRequests(customerId: string, query: ReturnRequestListQuery) {
  const where = { customerId, ...(query.status ? { status: query.status } : {}) };
  return paginate(
    query,
    (p) => prisma.returnRequest.findMany({ where, include, orderBy: { createdAt: "desc" }, ...p }),
    () => prisma.returnRequest.count({ where }),
  );
}

// --- admin ---

export async function listReturnRequestsAdmin(query: ReturnRequestListQuery) {
  const where = query.status ? { status: query.status } : {};
  return paginate(
    query,
    (p) =>
      prisma.returnRequest.findMany({
        where,
        include: { ...include, customer: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        ...p,
      }),
    () => prisma.returnRequest.count({ where }),
  );
}

async function getReturnRequestById(id: string) {
  const request = await prisma.returnRequest.findUnique({ where: { id } });
  if (!request) throw AppError.notFound("Return request not found");
  return request;
}

/** Approving a RETURN reuses the existing order-status machinery (transitions the order to
 * RETURNED, with its own status-history entry) rather than tracking a parallel status — there's no
 * refund-API integration, so "refund status" is just the order's own status/paymentStatus from
 * here on. Approving an EXCHANGE takes a different path entirely (createExchangeOrder below): the
 * original order is untouched (the sale stands, the customer already paid for it) and a new $0
 * replacement order is created instead. */
export async function reviewReturnRequest(id: string, input: ReviewReturnRequestInput, adminId: string) {
  const request = await getReturnRequestById(id);
  if (request.status !== "PENDING") throw AppError.conflict("This return request has already been reviewed");

  // Conditional on status still being PENDING (not a plain update) — closes the race where two
  // admins review the same request at once: only the update that actually flips PENDING wins,
  // the loser's count is 0 and gets a clean conflict instead of both silently "succeeding" and
  // potentially double-triggering the order-status transition below.
  const result = await prisma.returnRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: input.status, adminNote: input.adminNote ?? null, reviewedAt: new Date(), reviewedByAdminId: adminId },
  });
  if (result.count === 0) throw AppError.conflict("This return request has already been reviewed");

  if (input.status === "APPROVED") {
    if (request.type === "EXCHANGE") {
      await createExchangeOrder(request, adminId);
    } else {
      const order = await updateOrderStatus(
        request.orderId,
        { status: "RETURNED", note: `Return approved: ${request.reason}` },
        adminId,
      );
      await restockReturnedOrderItems(order.id, order.items, adminId);
    }
  }

  return prisma.returnRequest.findUnique({ where: { id }, include });
}

/** Creates the replacement shipment for an approved EXCHANGE request: decrements stock for the
 * requested item (re-checked here, not trusted from request-creation time — it may have sold out
 * since), restocks the original item back to inventory, and opens a new companion Order — copying
 * the original's shipping/contact details, starting at CONFIRMED (an admin already approved it, so
 * it skips the confirmation-call queue). Since exchanges are no longer limited to a same-priced
 * same-product swap, the new item's price may exceed what the customer already paid: any positive
 * gap becomes a COD `total` collected by the courier on delivery, same as any other COD order —
 * there's no refund-API integration to pay out the other direction, so a downgrade stays free
 * rather than owing the customer a refund. Left for the admin to book with Steadfast the same way
 * any other order is booked. */
async function createExchangeOrder(
  request: NonNullable<Awaited<ReturnType<typeof getReturnRequestById>>>,
  adminId: string,
) {
  const originalOrder = await prisma.order.findUnique({ where: { id: request.orderId }, include: { items: true } });
  if (!originalOrder) throw AppError.notFound("Original order not found");

  const originalItem = originalOrder.items.find((i) => i.id === request.orderItemId);
  if (!originalItem) throw AppError.badRequest("The original item on this order could not be found");
  if (!request.requestedVariantId) throw AppError.badRequest("No replacement size/color was recorded for this exchange");

  const requestedVariant = await prisma.productVariant.findUnique({
    where: { id: request.requestedVariantId },
    include: { product: true },
  });
  if (!requestedVariant) throw AppError.badRequest("The requested size/color is no longer available");

  const price = Number(requestedVariant.price ?? requestedVariant.product.basePrice);
  const subtotal = price * originalItem.quantity;
  const alreadyPaidValue = Number(originalItem.priceSnapshot) * originalItem.quantity;
  // Only ever collects more, never refunds — a cheaper replacement is still a free exchange (no
  // refund path exists), an equal-or-pricier one bills the gap as COD on the new shipment.
  const amountDue = Math.max(0, subtotal - alreadyPaidValue);
  const discount = subtotal - amountDue;

  return prisma.$transaction(async (tx) => {
    // Conditional decrement, same "stock changed underneath us" guard createOrder uses at checkout
    // — the requested size may have sold out in the time between the customer's request and this
    // approval.
    const decremented = await tx.productVariant.updateMany({
      where: { id: requestedVariant.id, stock: { gte: originalItem.quantity } },
      data: { stock: { decrement: originalItem.quantity } },
    });
    if (decremented.count === 0) {
      throw AppError.conflict(
        `Not enough stock left for ${requestedVariant.product.name} (${requestedVariant.size}/${requestedVariant.color}) to fulfil this exchange`,
      );
    }

    const exchangeNote =
      amountDue > 0
        ? `Exchange for order ${originalOrder.orderNumber} (${originalItem.productNameSnapshot} ${originalItem.sizeSnapshot}/${originalItem.colorSnapshot} → ${requestedVariant.product.name} ${requestedVariant.size}/${requestedVariant.color}) — BDT ${amountDue} due COD on delivery for the price difference`
        : `Free exchange for order ${originalOrder.orderNumber} (${originalItem.productNameSnapshot} ${originalItem.sizeSnapshot}/${originalItem.colorSnapshot} → ${requestedVariant.product.name} ${requestedVariant.size}/${requestedVariant.color})`;

    const exchangeOrder = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: originalOrder.customerId,
        status: "CONFIRMED",
        paymentMethod: amountDue > 0 ? "COD" : originalOrder.paymentMethod,
        paymentStatus: amountDue > 0 ? "UNPAID" : "PAID",
        customerName: originalOrder.customerName,
        customerEmail: originalOrder.customerEmail,
        customerPhone: originalOrder.customerPhone,
        shippingDivision: originalOrder.shippingDivision,
        shippingDistrict: originalOrder.shippingDistrict,
        shippingArea: originalOrder.shippingArea,
        shippingAddressLine: originalOrder.shippingAddressLine,
        adminNotes: exchangeNote,
        subtotal,
        // Discount covers whatever value the customer already paid via the original item — the
        // rest (if any) is `total`, collected as COD. Keeps subtotal a real record of the new
        // item's value (useful for "cost of exchanges" reporting) rather than always netting to 0.
        discount,
        shippingFee: 0,
        total: amountDue,
        items: {
          create: {
            variantId: requestedVariant.id,
            productNameSnapshot: requestedVariant.product.name,
            skuSnapshot: requestedVariant.sku,
            sizeSnapshot: requestedVariant.size,
            colorSnapshot: requestedVariant.color,
            priceSnapshot: price,
            quantity: originalItem.quantity,
          },
        },
        statusHistory: {
          create: {
            status: "CONFIRMED",
            note: `Exchange for order ${originalOrder.orderNumber} — original item restocked`,
            changedByAdminId: adminId,
          },
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        variantId: requestedVariant.id,
        change: -originalItem.quantity,
        reason: "ORDER",
        orderId: exchangeOrder.id,
        adminId,
        note: "Exchange shipment",
      },
    });

    const restocked = await tx.productVariant.updateMany({
      where: { id: originalItem.variantId },
      data: { stock: { increment: originalItem.quantity } },
    });
    if (restocked.count > 0) {
      await tx.stockMovement.create({
        data: {
          variantId: originalItem.variantId,
          change: originalItem.quantity,
          reason: "RETURN",
          orderId: request.orderId,
          adminId,
          note: "Stock restored — exchange approved",
        },
      });
    }

    await tx.returnRequest.update({ where: { id: request.id }, data: { exchangeOrderId: exchangeOrder.id } });

    return exchangeOrder;
  });
}
