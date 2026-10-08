/**
 * The one customer-facing view of an order (Phase 10, docs/PHASE_10_AUDIT.md G-3). Everything a customer or guest receives
 * about an order — checkout response, guest tracking, the account's order list and detail — goes through here, so what
 * they may see is decided in one place, by whitelist:
 *
 *  - never staff-only data: internal notes (`adminNotes`), who on the team did what, follow-up / call-attempt state,
 *    courier sync errors and booking claims, idempotency / session keys, deletion markers;
 *  - never internal attribution or cost: product / category / brand snapshots, flash-sale item ids — and cost is already
 *    omitted globally (Phase 6);
 *  - the timeline shows the order's status journey: one entry per status change, with the note written on that change.
 *    Same-status entries are staff annotations (follow-up holds, address / price edits, payment and refund bookkeeping)
 *    and stay internal (BUSINESS_DECISIONS P10-1).
 */

const ORDER_FIELDS = [
  "id",
  "orderNumber",
  "customerId",
  "status",
  "paymentMethod",
  "paymentStatus",
  "customerName",
  "customerEmail",
  "customerPhone",
  "shippingDivision",
  "shippingDistrict",
  "shippingArea",
  "shippingAddressLine",
  "subtotal",
  "discount",
  "shippingFee",
  "total",
  "priceAdjustment",
  "couponId",
  "bundleId",
  "bundleDiscount",
  "flashDiscount",
  "couponDiscount",
  "shippingWaived",
  "taxMode",
  "taxRate",
  "shippingTaxRate",
  "taxableAmount",
  "taxAmount",
  "shippingTaxAmount",
  "notes", // the customer's own note at checkout
  "trackingNumber",
  "carrier",
  "courierConsignmentId",
  "courierStatus",
  "courierTrackingLink",
  "createdAt",
  "updatedAt",
  "previewImageUrl", // first line's product photo, attached by the customer order list
] as const;

const ITEM_FIELDS = [
  "id",
  "orderId",
  "variantId",
  "productNameSnapshot",
  "skuSnapshot",
  "sizeSnapshot",
  "colorSnapshot",
  "priceSnapshot",
  "listPriceSnapshot",
  "quantity",
  "returnedQuantity",
  "bundleDiscountAllocated",
  "couponDiscountAllocated",
  "live", // attached by attachLiveItemInfo (current availability for "buy again")
] as const;

const RETURN_REQUEST_FIELDS = [
  "id",
  "orderId",
  "orderItemId",
  "type",
  "status",
  "reason",
  "note",
  "adminNote", // the team's reply, shown to the customer as "Note from support"
  "originalSizeSnapshot",
  "originalColorSnapshot",
  "requestedSizeSnapshot",
  "requestedColorSnapshot",
  "exchangeOrderId",
  "exchangeOrder",
  "compensation", // what the customer got back (STORE_CREDIT / REFUND / NONE) and how much — their own money
  "compensationAmount",
  "order",
  "reviewedAt",
  "createdAt",
  "updatedAt",
] as const;

type Row = Record<string, unknown>;

function pick<K extends string>(row: Row, fields: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

/** The status journey: the first entry, then every entry whose status differs from the one before it. */
export function customerTimeline(history: ReadonlyArray<{ id: string; status: string; note: string | null; createdAt: Date }>) {
  return history
    .filter((entry, i) => i === 0 || entry.status !== history[i - 1]!.status)
    .map((entry) => ({ id: entry.id, status: entry.status, note: entry.note, createdAt: entry.createdAt }));
}

export function toCustomerReturnRequest(request: Row) {
  return pick(request, RETURN_REQUEST_FIELDS);
}

export function toCustomerOrder(order: Row) {
  const view: Row = pick(order, ORDER_FIELDS);
  if (Array.isArray(order.items)) view.items = (order.items as Row[]).map((item) => pick(item, ITEM_FIELDS));
  if (Array.isArray(order.statusHistory)) view.statusHistory = customerTimeline(order.statusHistory as never);
  if (Array.isArray(order.returnRequests)) view.returnRequests = (order.returnRequests as Row[]).map(toCustomerReturnRequest);
  return view;
}
