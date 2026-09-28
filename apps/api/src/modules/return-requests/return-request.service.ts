import { Prisma } from "@prisma/client";
import { formatVariantSuffix, isPurchasable } from "@clothing-brand/shared";
import type { CreateReturnRequestInput, ReviewReturnRequestInput, ReturnRequestListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { generateOrderNumber } from "../../lib/order-number";
import { applyOrderTransition, runTransitionSideEffects } from "../orders/order.service";
import { recordSale, releaseOrderLines } from "../inventory/inventory.service";

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

/** Approving a RETURN moves the order to RETURNED through the order state machine (which also restocks the
 * outstanding units, idempotently) in the SAME transaction as the request's own PENDING → APPROVED claim: if the
 * order can't be returned (e.g. it isn't delivered), nothing changes and the request stays PENDING. There's no
 * refund-API integration, so money is handled separately via Record refund. Approving an EXCHANGE takes a
 * different path entirely (createExchangeOrder below): the original order's status is untouched (the sale
 * stands) and a replacement order is created instead. */
export async function reviewReturnRequest(id: string, input: ReviewReturnRequestInput, adminId: string) {
  const request = await getReturnRequestById(id);
  if (request.status !== "PENDING") throw AppError.conflict("This return request has already been reviewed");

  const outcome = await prisma.$transaction(async (tx) => {
    // Conditional on status still being PENDING — two admins reviewing at once: only one claim wins.
    const result = await tx.returnRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.status, adminNote: input.adminNote ?? null, reviewedAt: new Date(), reviewedByAdminId: adminId },
    });
    if (result.count === 0) throw AppError.conflict("This return request has already been reviewed");

    if (input.status !== "APPROVED") return null;
    if (request.type === "EXCHANGE") {
      await createExchangeOrder(tx, request, adminId);
      return null;
    }
    return applyOrderTransition(tx, request.orderId, { status: "RETURNED", note: `Return approved: ${request.reason}` }, { adminId });
  });
  if (outcome) await runTransitionSideEffects(outcome);

  return prisma.returnRequest.findUnique({ where: { id }, include });
}

/** Creates the replacement shipment for an approved EXCHANGE request, inside the approval's transaction: takes
 * the requested item out of stock (re-checked here — it may have sold out since the request), puts the original
 * item back (a RETURN on the original order's line, so it can never be restocked twice), and opens a new
 * companion Order starting at CONFIRMED (an admin already approved it). Since exchanges are no longer limited to
 * a same-priced same-product swap, the new item's price may exceed what the customer already paid: any positive
 * gap becomes a COD `total` collected by the courier on delivery — there's no refund-API integration to pay out
 * the other direction, so a downgrade stays free rather than owing the customer a refund. */
async function createExchangeOrder(
  tx: Prisma.TransactionClient,
  request: NonNullable<Awaited<ReturnType<typeof getReturnRequestById>>>,
  adminId: string,
) {
  const originalOrder = await tx.order.findUnique({ where: { id: request.orderId }, include: { items: true } });
  if (!originalOrder) throw AppError.notFound("Original order not found");

  const originalItem = originalOrder.items.find((i) => i.id === request.orderItemId);
  if (!originalItem) throw AppError.badRequest("The original item on this order could not be found");
  if (!request.requestedVariantId) throw AppError.badRequest("No replacement size/color was recorded for this exchange");

  const requestedVariant = await tx.productVariant.findUnique({
    where: { id: request.requestedVariantId },
    include: { product: true },
  });
  // A trashed/unpublished product or an inactive variant can't be shipped as a replacement.
  if (!requestedVariant || !isPurchasable(requestedVariant.product, requestedVariant)) {
    throw AppError.badRequest("The requested size/color is no longer available");
  }

  const price = Number(requestedVariant.price ?? requestedVariant.product.basePrice);
  const subtotal = price * originalItem.quantity;
  const alreadyPaidValue = Number(originalItem.priceSnapshot) * originalItem.quantity;
  // Only ever collects more, never refunds — a cheaper replacement is still a free exchange (no
  // refund path exists), an equal-or-pricier one bills the gap as COD on the new shipment.
  const amountDue = Math.max(0, subtotal - alreadyPaidValue);
  const discount = subtotal - amountDue;

  const exchangeNote =
    amountDue > 0
      ? `Exchange for order ${originalOrder.orderNumber} (${originalItem.productNameSnapshot}${formatVariantSuffix(originalItem.sizeSnapshot, originalItem.colorSnapshot)} → ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)}) — BDT ${amountDue} due COD on delivery for the price difference`
      : `Free exchange for order ${originalOrder.orderNumber} (${originalItem.productNameSnapshot}${formatVariantSuffix(originalItem.sizeSnapshot, originalItem.colorSnapshot)} → ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)})`;

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

  // Same "stock changed underneath us" guard checkout uses — a 409 here rolls the whole approval back.
  try {
    await recordSale(tx, exchangeOrder.id, [{ variantId: requestedVariant.id, quantity: originalItem.quantity }], { adminId, note: "Exchange shipment" });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) {
      throw AppError.conflict(
        `Not enough stock left for ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)} to fulfil this exchange`,
      );
    }
    throw err;
  }
  await releaseOrderLines(tx, originalOrder.id, "return", {
    adminId,
    note: "Stock restored — exchange approved",
    lines: [{ orderItemId: originalItem.id, quantity: originalItem.quantity }],
  });

  await tx.returnRequest.update({ where: { id: request.id }, data: { exchangeOrderId: exchangeOrder.id } });

  return exchangeOrder;
}
