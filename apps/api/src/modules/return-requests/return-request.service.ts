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
import type { CreateReturnRequestInput, ReturnCompensation, ReviewReturnRequestInput, ReturnRequestListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { generateOrderNumber } from "../../lib/order-number";
import { applyOrderTransition, runTransitionSideEffects } from "../orders/order.service";
import { expectOrderLineReturns, notifyStockMoved, recordSale, releaseOrderLines, writeOffParcelUnits } from "../inventory/inventory.service";
import { returnsRuleActive } from "../returns/goods-awaiting-return.service";
import { fillMoved, fillToOrderFloors, withFillToOrder } from "../../domain/stock/fill-capacity.service";
import { quoteCart } from "../../domain/pricing/pricing.service";
import { loadTaxConfig } from "../../domain/pricing/pricing-config";
import { issueStoreCreditFromOrder, recordExchangeCovered, requestRefund, summarizeOrderPayments } from "../../domain/payments/payment-ledger.service";
import { captureLineSnapshots, lineSnapshotData } from "../../domain/orders/line-snapshots";
import { openReturnLeg } from "../../domain/shipments/shipment-sync";

const include = {
  order: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } },
  exchangeOrder: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } },
};

/** Staff also see the order's lines — approving a return can mark units that came back damaged. */
const adminInclude = {
  ...include,
  order: {
    select: {
      ...include.order.select,
      items: { select: { id: true, productNameSnapshot: true, sizeSnapshot: true, colorSnapshot: true, quantity: true, restockedQuantity: true } },
    },
  },
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
        include: { ...adminInclude, customer: { select: { name: true, email: true } } },
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
  // Blueprint P0.4: with the returns rule in force nothing is back at approval — damage is recorded when it is received.
  if (input.status === "APPROVED" && input.damaged?.length && (await returnsRuleActive())) {
    throw new AppError(400, "Record damaged items when the return is received back", { code: "DAMAGE_AT_RECEIPT" });
  }

  let moved: string[] = [];
  const outcome = await prisma.$transaction(async (tx) => {
    // Conditional on status still being PENDING — two admins reviewing at once: only one claim wins.
    const result = await tx.returnRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.status, adminNote: input.adminNote ?? null, reviewedAt: new Date(), reviewedByAdminId: adminId },
    });
    if (result.count === 0) throw AppError.conflict("This return request has already been reviewed");

    if (input.status !== "APPROVED") return null;
    // Courier costs (docs/COURIER_COSTS.md): the parcel coming back is a shipment leg of its own, with its own charge.
    await openReturnLeg(tx, request, adminId);
    if (request.type === "EXCHANGE") {
      moved = (await createExchangeOrder(tx, request, adminId, input.compensation)).moved;
      return null;
    }
    const before = input.damaged?.length ? await restockedByLine(tx, request.orderId) : null;
    const outcome = await applyOrderTransition(tx, request.orderId, { status: "RETURNED", note: `Return approved: ${request.reason}` }, { adminId, returnRequestId: request.id });
    if (before && input.damaged) {
      const damage = await writeOffDamagedReturn(tx, request.orderId, before, input.damaged, adminId);
      moved = damage.moved;
      // A variant all of whose returned units were written off is not back in stock: no "back in stock" message for it.
      outcome.replenished = outcome.replenished.filter((v) => !damage.allDamaged.has(v));
    }
    // Staff may settle the return as store credit right away (everything still owed back on the order); otherwise it
    // stays in the refund-due queue for a refund, as before.
    if (input.compensation === "STORE_CREDIT") {
      const entry = await issueStoreCreditFromOrder(tx, {
        orderId: request.orderId,
        type: "RETURN",
        reason: `Return approved — ${request.reason}`,
        sourceType: "RETURN_REQUEST",
        sourceId: request.id,
        idempotencyKey: `credit:return:${request.id}`,
        adminId,
      }).catch((err: unknown) => {
        // Nothing was received for this order (an unpaid COD return): there is nothing to credit — the return still stands.
        if (err instanceof AppError && (err.details as { code?: string } | undefined)?.code === "CREDIT_EXCEEDS_REFUND_DUE") return null;
        throw err;
      });
      await tx.returnRequest.update({ where: { id: request.id }, data: { compensation: entry ? "STORE_CREDIT" : "NONE", compensationAmount: entry ? entry.amount : 0 } });
    }
    return outcome;
  });
  if (outcome) await runTransitionSideEffects(outcome);
  notifyStockMoved(moved);

  return prisma.returnRequest.findUnique({ where: { id }, include: adminInclude });
}

async function restockedByLine(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, restockedQuantity: true } });
  return new Map(items.map((i) => [i.id, i.restockedQuantity]));
}

/** An approved return's unsellable units: the RETURNED transition just put them back, so they leave again at the line's own
 * cost (writeOffParcelUnits — shrinkage, outside the order). Never more than THIS approval brought back per line (`before`:
 * each line's restocked count before the transition); repeated lines are added up first. */
async function writeOffDamagedReturn(
  tx: Prisma.TransactionClient,
  orderId: string,
  before: Map<string, number>,
  damaged: Array<{ orderItemId: string; quantity: number }>,
  adminId: string,
) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNumber: true, items: { select: { id: true, variantId: true, restockedQuantity: true, unitCostSnapshot: true } } } });
  const byId = new Map(order.items.map((i) => [i.id, i]));
  const wanted = new Map<string, number>();
  for (const d of damaged) wanted.set(d.orderItemId, (wanted.get(d.orderItemId) ?? 0) + d.quantity);
  const units: Array<{ variantId: string; quantity: number; unitCostMinor: number | null; reason: "DAMAGED" }> = [];
  const good = new Set<string>();
  const touched = new Set<string>();
  for (const item of order.items) {
    const back = item.restockedQuantity - (before.get(item.id) ?? item.restockedQuantity);
    const d = wanted.get(item.id) ?? 0;
    if (d > back) throw AppError.badRequest(`Only ${back} unit(s) of this item came back with this return`);
    if (back > d) good.add(item.variantId);
    if (back > 0) touched.add(item.variantId);
    if (d) units.push({ variantId: item.variantId, quantity: d, unitCostMinor: item.unitCostSnapshot, reason: "DAMAGED" });
  }
  for (const id of wanted.keys()) if (!byId.has(id)) throw AppError.badRequest("That item isn't on this order");
  await writeOffParcelUnits(tx, { id: orderId, orderNumber: order.orderNumber }, units, { adminId, note: "customer return" });
  return { moved: units.map((u) => u.variantId), allDamaged: new Set([...touched].filter((v) => !good.has(v))) };
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
/** THE price of an exchange (D6) — shared by the approval below and the read-only preview, so what staff see before
 * approving is exactly what approval does. Refuses (like approval) when the item was already returned/exchanged or the
 * requested variant can't be sold any more. `stockAvailable` says whether the replacement units are in stock right now
 * (approval re-checks under the stock lock). */
async function priceExchange(db: Prisma.TransactionClient | typeof prisma, request: NonNullable<Awaited<ReturnType<typeof getReturnRequestById>>>) {
  const originalOrder = await db.order.findUnique({ where: { id: request.orderId }, include: { items: true } });
  if (!originalOrder) throw AppError.notFound("Original order not found");

  const originalItem = originalOrder.items.find((i) => i.id === request.orderItemId);
  if (!originalItem) throw AppError.badRequest("The original item on this order could not be found");
  // Phase 9 (D-1): a replacement ships only in exchange for units that actually come back. A line already restocked (an
  // earlier exchange of the same item, a return, a partial-delivery reconciliation) can't be exchanged again.
  if (originalItem.restockedQuantity > 0) {
    throw AppError.conflict("This item has already been returned or exchanged — it can't be exchanged again");
  }
  if (!request.requestedVariantId) throw AppError.badRequest("No replacement size/color was recorded for this exchange");

  const requestedVariant = await db.productVariant.findUnique({
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
    db as Prisma.TransactionClient,
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
  const tax = computeTax(await loadTaxConfig(db as Prisma.TransactionClient), amountDue, zero(cur), DEFAULT_ROUNDING_POLICY);
  // A fill-to-order replacement sells its filled bottles plus what can still be made (docs/STOCK_HUB.md §3).
  const [forSale] = await withFillToOrder(db, requestedVariant.product, [requestedVariant]);
  const stockAvailable = !requestedVariant.product.trackInventory || forSale!.stock >= originalItem.quantity;
  return { originalOrder, originalItem, requestedVariant, quote, line, cur, newValue, paidValue, amountDue, refundDue, credit, tax, stockAvailable };
}

/** What approving this exchange WOULD do — nothing is written: the original line and what was paid for it, the
 * replacement at today's price, the difference and where it goes (due on the replacement / store balance / refund owed). */
export async function previewExchange(id: string) {
  const request = await getReturnRequestById(id);
  if (request.type !== "EXCHANGE") throw AppError.badRequest("Only an exchange request has an exchange preview");
  if (request.status !== "PENDING") throw AppError.conflict("This request has already been reviewed");
  const p = await priceExchange(prisma, request);
  const position = (await summarizeOrderPayments([p.originalOrder.id])).get(p.originalOrder.id)!;
  return {
    currency: p.cur,
    quantity: p.originalItem.quantity,
    original: {
      orderItemId: p.originalItem.id,
      productName: p.originalItem.productNameSnapshot,
      size: p.originalItem.sizeSnapshot,
      color: p.originalItem.colorSnapshot,
      /** What the customer paid for these units (snapshot price net of allocated discounts). */
      paidValue: toMajor(p.paidValue),
    },
    replacement: {
      variantId: p.requestedVariant.id,
      productName: p.requestedVariant.product.name,
      size: p.requestedVariant.size,
      color: p.requestedVariant.color,
      /** Today's effective price for the same quantity. */
      value: toMajor(p.newValue),
      inStock: p.stockAvailable,
    },
    /** > 0: the replacement order collects this. */
    amountDue: toMajor(p.amountDue),
    /** > 0: owed back to the customer (store credit by default, D15). */
    amountOwedBack: toMajor(p.refundDue),
    /** Whether the owed-back amount can go to store balance (needs a customer account) / be refunded (capped by what was received). */
    canCredit: p.originalOrder.customerId !== null && position.refundable >= toMajor(p.refundDue),
    canRefund: position.refundable >= toMajor(p.refundDue),
  };
}

async function createExchangeOrder(
  tx: Prisma.TransactionClient,
  request: NonNullable<Awaited<ReturnType<typeof getReturnRequestById>>>,
  adminId: string,
  compensation?: ReturnCompensation,
) {
  const { originalOrder, originalItem, requestedVariant, quote, line, cur, newValue, amountDue, refundDue, credit, tax } = await priceExchange(tx, request);

  const label = `${originalItem.productNameSnapshot}${formatVariantSuffix(originalItem.sizeSnapshot, originalItem.colorSnapshot)} → ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)}`;
  const exchangeNote =
    amountDue.amount > 0
      ? `Exchange for order ${originalOrder.orderNumber} (${label}) — ${cur} ${toMajor(amountDue)} due COD on delivery for the price difference`
      : refundDue.amount > 0
        ? `Exchange for order ${originalOrder.orderNumber} (${label}) — ${cur} ${toMajor(refundDue)} owed back to the customer (${compensation === "REFUND" || !originalOrder.customerId ? "refund requested" : "store credit"})`
        : `Free exchange for order ${originalOrder.orderNumber} (${label})`;

  // Phase 4B: the replacement is a new stock exit — its own cost, determined at that exit (recordSale), never the original
  // item's.
  const replacementSnapshots = await captureLineSnapshots(tx, [requestedVariant.id], cur);
  // Blueprint P0.4 (R3, S5; Q13 = C): with the returns rule in force the replacement ships first and the original waits as
  // Goods awaiting return until it is received — it is not restocked at approval.
  const awaitOriginal = await returnsRuleActive(tx);
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
          note: `Exchange for order ${originalOrder.orderNumber} — ${awaitOriginal ? "original item to come back" : "original item restocked"}`,
          changedByAdminId: adminId,
        },
      },
    },
  });

  // Same "stock changed underneath us" guard checkout uses — a 409 here rolls the whole approval back. A fill-to-order
  // replacement may take its stock below zero by what can still be made: the checkout's floors, under the materials' locks.
  const replacementLines = await tx.orderItem.findMany({ where: { orderId: exchangeOrder.id }, select: { id: true } });
  const fill =
    requestedVariant.product.fillToOrder && requestedVariant.product.trackInventory
      ? await fillToOrderFloors(tx, [{ variantId: requestedVariant.id, quantity: originalItem.quantity }], [originalItem.variantId]) // + the original coming back: one id order
      : null;
  try {
    await recordSale(tx, exchangeOrder.id, [{ variantId: requestedVariant.id, quantity: originalItem.quantity, orderItemIds: replacementLines.map((l) => l.id) }], {
      adminId,
      note: "Exchange shipment",
      untrackedVariantIds: requestedVariant.product.trackInventory ? undefined : new Set([requestedVariant.id]),
      floors: fill?.floors,
    });
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) {
      throw AppError.conflict(
        `Not enough stock left for ${requestedVariant.product.name}${formatVariantSuffix(requestedVariant.size, requestedVariant.color)} to fulfil this exchange`,
      );
    }
    throw err;
  }
  const released = awaitOriginal
    ? (await expectOrderLineReturns(tx, originalOrder.id, { source: "EXCHANGE", returnRequestId: request.id, adminId, note: "Exchange approved — waiting for the original", lines: [{ orderItemId: originalItem.id, quantity: originalItem.quantity }] }))
        .map((e) => ({ orderItemId: e.orderItemId, variantId: e.variantId, quantity: e.quantity, awaiting: true }))
    : (await releaseOrderLines(tx, originalOrder.id, "return", {
        adminId,
        note: "Stock restored — exchange approved",
        lines: [{ orderItemId: originalItem.id, quantity: originalItem.quantity }],
      })).released.map((r) => ({ ...r, awaiting: false }));
  // The release is a conditional update: if a concurrent return/exchange took these units first, nothing was released —
  // then the whole approval (replacement order, its stock, any refund) rolls back instead of shipping a second item.
  const returnedUnits = released.filter((r) => r.orderItemId === originalItem.id).reduce((n, r) => n + r.quantity, 0);
  if (returnedUnits !== originalItem.quantity) {
    throw AppError.conflict("This item has already been returned or exchanged — it can't be exchanged again");
  }

  // Fully covered by the returned item: nothing to collect — settled at zero in the ledger (status PAID, as before).
  if (amountDue.amount === 0) await recordExchangeCovered(tx, exchangeOrder.id, adminId);

  // D6: a cheaper replacement means money is owed back on the original order, capped by what was received for it (PL-2).
  // D11 (docs/ORDER_ADJUSTMENTS.md §9): by default it goes to the customer's store balance; staff may choose a refund
  // (a REQUESTED refund, paid out by hand) instead — and an order with no customer account can only be refunded.
  let settled: { kind: "STORE_CREDIT" | "REFUND" | "NONE"; amount: number } = { kind: "NONE", amount: 0 };
  if (refundDue.amount > 0) {
    const asCredit = compensation !== "REFUND" && compensation !== "NONE" && originalOrder.customerId !== null;
    if (asCredit) {
      await issueStoreCreditFromOrder(tx, {
        orderId: originalOrder.id,
        type: "EXCHANGE",
        amount: refundDue,
        cap: "REFUNDABLE",
        reason: `Exchange price difference — ${label}`,
        sourceType: "RETURN_REQUEST",
        sourceId: request.id,
        idempotencyKey: `credit:exchange:${request.id}`,
        adminId,
      });
      settled = { kind: "STORE_CREDIT", amount: toMajor(refundDue) };
    } else if (compensation !== "NONE") {
      await requestRefund(tx, originalOrder.id, { amount: toMajor(refundDue), reason: `Exchange price difference — ${label}` }, adminId);
      settled = { kind: "REFUND", amount: toMajor(refundDue) };
    }
  }

  await tx.returnRequest.update({
    where: { id: request.id },
    data: { exchangeOrderId: exchangeOrder.id, compensation: settled.kind, compensationAmount: settled.amount },
  });

  // For notifyStockMoved after commit: the replacement (and its materials) left, the original came back.
  return { exchangeOrder, moved: [...fillMoved(fill), ...released.filter((r) => !r.awaiting).map((r) => r.variantId)] };
}
