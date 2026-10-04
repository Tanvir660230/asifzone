import { Prisma } from "@prisma/client";
import {
  DEFAULT_ROUNDING_POLICY,
  add,
  clampNonNegative,
  computeTax,
  formatVariantSuffix,
  fromMajor,
  isPurchasable,
  multiply,
  subtract,
  toMajor,
  zero,
} from "@clothing-brand/shared";
import type { CreateReturnRequestInput, ReviewReturnRequestInput, ReturnRequestListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { generateOrderNumber } from "../../lib/order-number";
import { applyOrderTransition, runTransitionSideEffects } from "../orders/order.service";
import { recordSale, releaseOrderLines } from "../inventory/inventory.service";
import { quoteCart } from "../../domain/pricing/pricing.service";
import { loadTaxConfig } from "../../domain/pricing/pricing-config";
import { recordExchangeCovered, requestRefund } from "../../domain/payments/payment-ledger.service";
import { captureLineSnapshots, lineSnapshotData } from "../../domain/orders/line-snapshots";

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
    if (item.restockedQuantity > 0) throw AppError.conflict("This item has already been returned or exchanged");

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

/** Creates the replacement shipment for an approved EXCHANGE request, inside the approval's transaction.
 *
 * D6 — priced by the canonical pricing service at the CURRENT effective selling price (list → variant → live flash sale,
 * stock-limit aware; no bundle or coupon, no shipping) and compared with what the customer actually paid for the item
 * being returned (its order-line snapshot, net of the discounts allocated to it — history, not the current price).
 *   • replacement costs more  → the difference is the new order's total, collected COD on delivery;
 *   • replacement costs less  → the difference is owed back: a REQUESTED Refund on the original order (payment ledger),
 *                                completed by an admin once paid out;
 *   • equal                   → a free exchange.
 * Then: takes the replacement out of stock (re-checked — it may have sold out since the request), puts the original
 * item back (a RETURN on the original order's line, so it can never be restocked twice), and opens the companion Order
 * at CONFIRMED with its own pricing/tax snapshot. */
async function createExchangeOrder(
  tx: Prisma.TransactionClient,
  request: NonNullable<Awaited<ReturnType<typeof getReturnRequestById>>>,
  adminId: string,
) {
  const originalOrder = await tx.order.findUnique({ where: { id: request.orderId }, include: { items: true } });
  if (!originalOrder) throw AppError.notFound("Original order not found");

  const originalItem = originalOrder.items.find((i) => i.id === request.orderItemId);
  if (!originalItem) throw AppError.badRequest("The original item on this order could not be found");
  // Phase 9 (D-1): a replacement ships only in exchange for units that actually come back. A line already restocked (an
  // earlier exchange of the same item, a return, a partial-delivery reconciliation) can't be exchanged again.
  if (originalItem.restockedQuantity > 0) {
    throw AppError.conflict("This item has already been returned or exchanged — it can't be exchanged again");
  }
  if (!request.requestedVariantId) throw AppError.badRequest("No replacement size/color was recorded for this exchange");

  const requestedVariant = await tx.productVariant.findUnique({
    where: { id: request.requestedVariantId },
    include: { product: true },
  });
  // A trashed/unpublished product or an inactive variant can't be shipped as a replacement.
  if (!requestedVariant || !isPurchasable(requestedVariant.product, requestedVariant)) {
    throw AppError.badRequest("The requested size/color is no longer available");
  }

  // The exchange quote: the canonical pipeline, current prices, flash only.
  const { quote } = await quoteCart(
    { items: [{ variantId: requestedVariant.id, quantity: originalItem.quantity }], promotions: "FLASH_ONLY", customerId: originalOrder.customerId },
    tx,
  );
  const line = quote.lines[0];
  if (!line) throw AppError.badRequest("The requested size/color is no longer available");
  const cur = quote.currency;
  const newValue = quote.subtotal;
  // What the customer paid for the returned units: the line's snapshot price net of its allocated discounts (orders
  // placed before Phase 2 have no allocation snapshot — their plain line value is used, as before).
  const paidValue = clampNonNegative(
    subtract(
      multiply(fromMajor(originalItem.priceSnapshot.toString(), cur), originalItem.quantity),
      add(fromMajor(originalItem.bundleDiscountAllocated?.toString() ?? "0", cur), fromMajor(originalItem.couponDiscountAllocated?.toString() ?? "0", cur)),
    ),
  );
  const amountDue = clampNonNegative(subtract(newValue, paidValue));
  const refundDue = clampNonNegative(subtract(paidValue, newValue));
  const credit = subtract(newValue, amountDue); // what the returned item's value covers (the new order's discount)
  const tax = computeTax(await loadTaxConfig(tx), amountDue, zero(cur), DEFAULT_ROUNDING_POLICY);

  const label = `${originalItem.productNameSnapshot}${formatVariantSuffix(originalItem.sizeSnapshot, originalItem.colorSnapshot)} → ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)}`;
  const exchangeNote =
    amountDue.amount > 0
      ? `Exchange for order ${originalOrder.orderNumber} (${label}) — ${cur} ${toMajor(amountDue)} due COD on delivery for the price difference`
      : refundDue.amount > 0
        ? `Exchange for order ${originalOrder.orderNumber} (${label}) — ${cur} ${toMajor(refundDue)} owed back to the customer (refund requested)`
        : `Free exchange for order ${originalOrder.orderNumber} (${label})`;

  const replacementSnapshots = await captureLineSnapshots(tx, [requestedVariant.id], cur);
  const exchangeOrder = await tx.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      customerId: originalOrder.customerId,
      status: "CONFIRMED",
      paymentMethod: amountDue.amount > 0 ? "COD" : originalOrder.paymentMethod,
      // Payment status is derived by the payment ledger: UNPAID until the COD difference is collected, or settled at
      // zero just below when the returned item covers the whole price.
      customerName: originalOrder.customerName,
      customerEmail: originalOrder.customerEmail,
      customerPhone: originalOrder.customerPhone,
      shippingDivision: originalOrder.shippingDivision,
      shippingDistrict: originalOrder.shippingDistrict,
      shippingArea: originalOrder.shippingArea,
      shippingAddressLine: originalOrder.shippingAddressLine,
      adminNotes: exchangeNote,
      subtotal: toMajor(newValue),
      // Discount = the value the returned item already covers; the rest (if any) is `total`, collected COD. Keeps
      // subtotal a real record of the new item's current value (useful for "cost of exchanges" reporting).
      discount: toMajor(credit),
      couponDiscount: 0,
      flashDiscount: toMajor(quote.flashDiscount),
      shippingFee: 0,
      shippingWaived: false,
      total: toMajor(amountDue),
      pricingVersion: quote.pricingVersion,
      taxMode: tax.mode,
      taxRate: tax.ratePct,
      shippingTaxRate: tax.shipping.ratePct,
      taxableAmount: toMajor(tax.taxableAmount),
      taxAmount: toMajor(tax.taxAmount),
      shippingTaxAmount: toMajor(tax.shipping.taxAmount),
      items: {
        create: line.segments.map((seg) => ({
          variantId: requestedVariant.id,
          productNameSnapshot: requestedVariant.product.name,
          skuSnapshot: requestedVariant.sku,
          sizeSnapshot: requestedVariant.size,
          colorSnapshot: requestedVariant.color,
          priceSnapshot: toMajor(seg.unitPrice),
          quantity: seg.quantity,
          listPriceSnapshot: toMajor(seg.listUnitPrice),
          flashSaleId: seg.flash?.flashSaleId ?? null,
          flashSaleItemId: seg.flash?.flashSaleItemId ?? null,
          bundleDiscountAllocated: 0,
          couponDiscountAllocated: 0,
          // Recorded for the replacement line; a replacement is not a sale, so no COGS/sales read it (P6-5).
          ...lineSnapshotData(replacementSnapshots, requestedVariant.id),
        })),
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
    await recordSale(tx, exchangeOrder.id, [{ variantId: requestedVariant.id, quantity: originalItem.quantity }], {
      adminId,
      note: "Exchange shipment",
      untrackedVariantIds: requestedVariant.product.trackInventory ? undefined : new Set([requestedVariant.id]),
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) {
      throw AppError.conflict(
        `Not enough stock left for ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)} to fulfil this exchange`,
      );
    }
    throw err;
  }
  const { released } = await releaseOrderLines(tx, originalOrder.id, "return", {
    adminId,
    note: "Stock restored — exchange approved",
    lines: [{ orderItemId: originalItem.id, quantity: originalItem.quantity }],
  });
  // The release is a conditional update: if a concurrent return/exchange took these units first, nothing was released —
  // then the whole approval (replacement order, its stock, any refund) rolls back instead of shipping a second item.
  const returnedUnits = released.filter((r) => r.orderItemId === originalItem.id).reduce((n, r) => n + r.quantity, 0);
  if (returnedUnits !== originalItem.quantity) {
    throw AppError.conflict("This item has already been returned or exchanged — it can't be exchanged again");
  }

  // Fully covered by the returned item: nothing to collect — settled at zero in the ledger (status PAID, as before).
  if (amountDue.amount === 0) await recordExchangeCovered(tx, exchangeOrder.id, adminId);

  // D6: a cheaper replacement means money is owed back — a REQUESTED refund on the original order (no gateway refund
  // API), completed by an admin once paid out. Capped by what was received for that order (PL-2).
  if (refundDue.amount > 0) {
    await requestRefund(tx, originalOrder.id, { amount: toMajor(refundDue), reason: `Exchange price difference — ${label}` }, adminId);
  }

  await tx.returnRequest.update({ where: { id: request.id }, data: { exchangeOrderId: exchangeOrder.id } });

  return exchangeOrder;
}
