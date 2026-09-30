/** Test-only builders for the metrics engine's OrderFact / LineFact (amounts in paisa, instants UTC). */
import type { LineFact, OrderFact } from "@clothing-brand/shared";

export const T = (taka: number) => Math.round(taka * 100);

let seq = 0;
export function line(over: Partial<LineFact> = {}): LineFact {
  seq++;
  return {
    orderItemId: `item${seq}`,
    variantId: `var${seq}`,
    productId: "prodA",
    productName: "Product A",
    categoryId: "catA",
    categoryName: "Category A",
    brand: "BrandA",
    sku: `SKU${seq}`,
    size: "M",
    color: "Black",
    quantity: 1,
    unitPrice: T(1000),
    bundleDiscountAllocated: null,
    couponDiscountAllocated: null,
    returnedQuantity: 0,
    flashSaleId: null,
    currentUnitCost: T(400),
    ...over,
  };
}

/** A COD order for one line of 1000 + 60 shipping, placed at `placedAt`. */
export function order(over: Partial<OrderFact> = {}): OrderFact {
  seq++;
  const lines = over.lines ?? [line()];
  const subtotal = over.subtotal ?? lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const discount = over.discount ?? 0;
  const shippingFee = over.shippingFee ?? T(60);
  return {
    id: `order${seq}`,
    orderNumber: `ORD${seq}`,
    customerId: "cust1",
    sessionId: null,
    status: "PENDING",
    paymentMethod: "COD",
    deleted: false,
    isExchangeReplacement: false,
    placedAt: new Date("2026-09-10T06:00:00Z"),
    firstDeliveredAt: null,
    cancelledAt: null,
    subtotal,
    discount,
    bundleDiscount: 0,
    couponDiscount: 0,
    flashDiscount: 0,
    shippingFee,
    shippingWaived: false,
    priceAdjustment: 0,
    total: subtotal - discount + shippingFee,
    taxAmount: 0,
    taxMode: "INCLUSIVE",
    shippingTaxAmount: 0,
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    couponId: null,
    bundleId: null,
    payments: [],
    refunds: [],
    returnMovements: [],
    exchangedLines: [],
    ...over,
    lines,
  };
}

/** A delivered COD order: realised at `deliveredAt`, cash collected (Phase 4 COD payment) at the same time. */
export function deliveredCod(deliveredAt: Date, over: Partial<OrderFact> = {}): OrderFact {
  const o = order({ status: "DELIVERED", firstDeliveredAt: deliveredAt, ...over });
  if (!over.payments) o.payments = [{ amount: o.total, status: "SUCCEEDED", provider: "COD", settledAt: deliveredAt }];
  return o;
}

/** A paid online order: realised at the payment. */
export function paidOnline(paidAt: Date, over: Partial<OrderFact> = {}): OrderFact {
  const o = order({ status: "CONFIRMED", paymentMethod: "EPS_PG", placedAt: paidAt, ...over });
  if (!over.payments) o.payments = [{ amount: o.total, status: "SUCCEEDED", provider: "EPS_PG", settledAt: paidAt }];
  return o;
}
