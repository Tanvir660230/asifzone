import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROUNDING_POLICY,
  buildQuote,
  canCompleteRefund,
  checkCreditIssue,
  checkRefund,
  customerCancelBlocker,
  derivePaymentPosition,
  itemReturnBlocker,
  money,
  orderModificationBlocker,
  paymentLinkBlocker,
  toMajor,
  type CatalogVariant,
  type CouponRule,
  type OrderStatus,
  type PaymentLedgerInput,
  type QuoteInputs,
  type ShippingZoneRule,
} from "@clothing-brand/shared";

// docs/ORDER_ADJUSTMENTS.md — the pure rules: product free delivery in the canonical quote, store credit in the payment
// position, and the state guards for modification / cancellation / item returns / payment links. Amounts in taka.

const T = (n: number) => money(Math.round(n * 100), "BDT");
const NOW = new Date("2026-10-06T10:00:00Z");

function variant(id: string, over: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    variantId: id,
    productId: `p-${id}`,
    categoryId: "c1",
    productName: `Product ${id}`,
    sku: id,
    size: "M",
    color: "Black",
    basePrice: T(1000),
    variantPrice: null,
    productCompareAt: null,
    variantCompareAt: null,
    purchasable: true,
    trackInventory: true,
    stock: 100,
    offers: [],
    ...over,
  };
}

const ZONES: ShippingZoneRule[] = [
  { id: "z1", key: "dhaka", name: "Dhaka", priority: 10, isDefault: false, isActive: true, matches: [{ field: "DISTRICT", value: "Dhaka" }], fee: T(60), freeOverAmount: T(5000) },
];

function quote(variants: CatalogVariant[], over: Partial<QuoteInputs> = {}) {
  return buildQuote({
    currency: "BDT",
    now: NOW,
    rounding: DEFAULT_ROUNDING_POLICY,
    items: variants.map((v) => ({ variantId: v.variantId, quantity: 1 })),
    catalog: new Map(variants.map((v) => [v.variantId, v])),
    bundles: [],
    coupon: null,
    couponContext: { customerRedemptions: null, customerPriorOrders: null },
    shippingZones: ZONES,
    address: { district: "Dhaka" },
    tax: { enabled: false, mode: "INCLUSIVE", ratePct: 0, shippingTaxable: true, shippingRatePct: null },
    ...over,
  });
}

const FREE_SHIPPING: CouponRule = {
  id: "fs",
  code: "SHIPFREE",
  type: "FREE_SHIPPING",
  value: null,
  scope: "ALL_PRODUCTS",
  productIds: [],
  categoryIds: [],
  minOrderAmount: null,
  maxDiscountAmount: null,
  minQuantity: null,
  usageLimit: null,
  usedCount: 0,
  perCustomerLimit: null,
  firstOrderOnly: false,
  startsAt: null,
  expiresAt: null,
  isActive: true,
  deleted: false,
};

describe("product free delivery — mixed-cart matrix (§2)", () => {
  it("every line free-delivery → shipping waived (FREE_DELIVERY), lines say so", () => {
    const q = quote([variant("a", { freeDelivery: true }), variant("b", { freeDelivery: true })]);
    expect(q.shipping).toMatchObject({ resolved: true, waived: true, waivedReason: "FREE_DELIVERY", charged: { amount: 0 } });
    expect(q.lines.every((l) => l.freeDelivery)).toBe(true);
    expect(toMajor(q.total)).toBe(2000);
  });
  it("no free-delivery line → the zone fee", () => {
    const q = quote([variant("a"), variant("b")]);
    expect(q.shipping).toMatchObject({ waived: false, waivedReason: null });
    expect(toMajor(q.total)).toBe(2060);
  });
  it("mixed cart → the full zone fee (one free-delivery item never frees the whole order)", () => {
    const q = quote([variant("a", { freeDelivery: true }), variant("b")]);
    expect(q.shipping).toMatchObject({ waived: false });
    expect(toMajor(q.total)).toBe(2060);
  });
  it("free-delivery product + FREE_SHIPPING coupon → waived, reason COUPON (coupon takes precedence)", () => {
    const q = quote([variant("a", { freeDelivery: true })], { coupon: { code: "SHIPFREE", rule: FREE_SHIPPING } });
    expect(q.shipping).toMatchObject({ waived: true, waivedReason: "COUPON" });
  });
  it("mixed cart over the free-over threshold → waived by FREE_OVER (all lines count toward it)", () => {
    const q = quote([variant("a", { freeDelivery: true, basePrice: T(3000) }), variant("b", { basePrice: T(2500) })]);
    expect(q.shipping).toMatchObject({ waived: true, waivedReason: "FREE_OVER" });
  });
  it("removing the only normal product makes the cart free; adding one brings the fee back", () => {
    const free = variant("a", { freeDelivery: true });
    expect(quote([free]).shipping).toMatchObject({ waivedReason: "FREE_DELIVERY" });
    expect(quote([free, variant("b")]).shipping).toMatchObject({ waived: false });
  });
  it("an unpurchasable free-delivery line doesn't decide the waiver", () => {
    const q = quote([variant("a", { freeDelivery: true }), variant("b", { purchasable: false })]);
    expect(q.shipping).toMatchObject({ waivedReason: "FREE_DELIVERY" });
    expect(q.orderable).toBe(false);
  });
  it("absent flag (catalog rows from before the field) means not free", () => {
    expect(quote([variant("a")]).lines[0]!.freeDelivery).toBe(false);
  });
});

function pos(over: { total?: number; paid?: number[]; refunded?: number[]; requested?: number[]; credited?: number[]; returned?: number[]; status?: string; method?: string } = {}) {
  const input: PaymentLedgerInput = {
    currency: "BDT",
    total: T(over.total ?? 3000),
    paymentMethod: over.method ?? "SSLCOMMERZ",
    orderStatus: over.status ?? "CONFIRMED",
    settlements: (over.paid ?? []).map(T),
    failedAttempts: 0,
    refundsCompleted: (over.refunded ?? []).map(T),
    refundsRequested: (over.requested ?? []).map(T),
    credits: (over.credited ?? []).map(T),
    returned: (over.returned ?? []).map(T),
  };
  return derivePaymentPosition(input);
}
const major = (m: Parameters<typeof toMajor>[0]) => toMajor(m);

describe("payment position with store credit (§4–§7, §15)", () => {
  it("paid ৳3,000 then cancelled: refund due 3,000; credited 3,000 → CREDITED, nothing left to refund, payment untouched", () => {
    const before = pos({ paid: [3000], status: "CANCELLED" });
    expect(major(before.refundDue)).toBe(3000);
    const after = pos({ paid: [3000], credited: [3000], status: "CANCELLED" });
    expect(after.status).toBe("CREDITED");
    expect(major(after.paid)).toBe(3000);
    expect(major(after.refunded)).toBe(0);
    expect(major(after.credited)).toBe(3000);
    expect(major(after.refundDue)).toBe(0);
    expect(major(after.refundable)).toBe(0);
    // A closed order owes nothing because its money went to store credit (the credit re-collect rule is for open orders).
    expect(major(after.amountDue)).toBe(0);
    // CR-3: no double compensation — a refund of the credited money is refused.
    expect(checkRefund(after, T(1)).ok).toBe(false);
    expect(canCompleteRefund(after, T(1))).toBe(false);
  });
  it("partial credit on a cancelled order → PARTIALLY_REFUNDED, the rest still refundable", () => {
    const p = pos({ paid: [3000], credited: [1000], status: "CANCELLED" });
    expect(p.status).toBe("PARTIALLY_REFUNDED");
    expect(major(p.refundDue)).toBe(2000);
    expect(major(p.refundable)).toBe(2000);
  });
  it("Case B — paid 2,000, modified to 1,700: 300 owed back; credited → PAID at the new total", () => {
    const owed = pos({ total: 1700, paid: [2000] });
    expect(major(owed.overpaid)).toBe(300);
    expect(major(owed.refundDue)).toBe(300);
    const settled = pos({ total: 1700, paid: [2000], credited: [300] });
    expect(settled.status).toBe("PAID");
    expect(major(settled.refundDue)).toBe(0);
    expect(major(settled.amountDue)).toBe(0);
  });
  it("Case A — paid 2,000, total 2,300 applied (collect later): 300 due, PARTIALLY_PAID; COD would collect it", () => {
    const p = pos({ total: 2300, paid: [2000] });
    expect(p.status).toBe("PARTIALLY_PAID");
    expect(major(p.amountDue)).toBe(300);
    expect(major(pos({ total: 2300, paid: [2000], method: "COD" }).codToCollect)).toBe(300);
  });
  it("credit given back then the total rises again: the credited money is collected again (no free goods)", () => {
    const p = pos({ total: 2000, paid: [2000], credited: [300] });
    expect(major(p.amountDue)).toBe(300);
  });
  it("credit + gateway: store credit 1,000 + online 1,500 on a 2,500 order → PAID", () => {
    expect(pos({ total: 2500, paid: [1000, 1500] }).status).toBe("PAID");
  });
  it("credit issuance is capped at refund due (CR-2)", () => {
    const p = pos({ total: 1700, paid: [2000] });
    expect(checkCreditIssue(p, T(300)).ok).toBe(true);
    expect(checkCreditIssue(p, T(301))).toMatchObject({ ok: false, code: "EXCEEDS_REFUND_DUE" });
    expect(checkCreditIssue(p, T(0))).toMatchObject({ ok: false, code: "NOT_POSITIVE" });
  });
  it("item-level return on a delivered order: the returned value becomes owed back; the total is never rewritten", () => {
    const p = pos({ total: 3300, paid: [3300], returned: [2300], status: "DELIVERED" });
    expect(major(p.refundDue)).toBe(2300);
    expect(major(p.amountDue)).toBe(0);
    const credited = pos({ total: 3300, paid: [3300], returned: [2300], credited: [2300], status: "DELIVERED" });
    expect(credited.status).toBe("PAID");
    expect(major(credited.refundDue)).toBe(0);
  });
});

describe("state guards (§3, §10)", () => {
  const facts = (status: OrderStatus, over: { courier?: boolean; deleted?: boolean; method?: string } = {}) => ({
    status,
    deletedAt: over.deleted ? new Date() : null,
    courierConsignmentId: over.courier ? "123" : null,
    paymentMethod: over.method ?? "COD",
  });
  it("customer: PENDING and CONFIRMED only; never after courier booking", () => {
    expect(orderModificationBlocker(facts("PENDING"), "CUSTOMER")).toBeNull();
    expect(orderModificationBlocker(facts("CONFIRMED"), "CUSTOMER")).toBeNull();
    for (const s of ["PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "REFUNDED", "CANCELLED"] as OrderStatus[]) {
      expect(orderModificationBlocker(facts(s), "CUSTOMER"), s).not.toBeNull();
    }
    expect(orderModificationBlocker(facts("PENDING", { courier: true }), "CUSTOMER")).not.toBeNull();
  });
  it("admin: every pre-shipment status; after shipment only returns/exchanges", () => {
    for (const s of ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"] as OrderStatus[]) expect(orderModificationBlocker(facts(s), "ADMIN"), s).toBeNull();
    expect(orderModificationBlocker(facts("SHIPPED"), "ADMIN")).toMatch(/return or an exchange/);
    expect(orderModificationBlocker(facts("DELIVERED"), "ADMIN")).toMatch(/return or an exchange/);
    expect(orderModificationBlocker(facts("CANCELLED"), "ADMIN")).toMatch(/can't be changed/);
    expect(orderModificationBlocker(facts("PACKED", { courier: true }), "ADMIN")).toMatch(/unlink/);
    expect(orderModificationBlocker(facts("PENDING", { deleted: true }), "ADMIN")).toMatch(/Restore/);
  });
  it("customer cancellation: same window; a repeat on a cancelled order is allowed (idempotent)", () => {
    expect(customerCancelBlocker(facts("PENDING"))).toBeNull();
    expect(customerCancelBlocker(facts("CANCELLED"))).toBeNull();
    expect(customerCancelBlocker(facts("PROCESSING"))).not.toBeNull();
    expect(customerCancelBlocker(facts("CONFIRMED", { courier: true }))).not.toBeNull();
  });
  it("item returns: delivered, or a reconciled partial delivery", () => {
    expect(itemReturnBlocker(facts("DELIVERED"))).toBeNull();
    expect(itemReturnBlocker({ ...facts("PARTIALLY_DELIVERED"), partialDeliveryReconciledAt: null })).not.toBeNull();
    expect(itemReturnBlocker({ ...facts("PARTIALLY_DELIVERED"), partialDeliveryReconciledAt: new Date() })).toBeNull();
    expect(itemReturnBlocker(facts("SHIPPED"))).not.toBeNull();
  });
  it("payment links: open order with something due; never closed, never a courier-booked COD order", () => {
    expect(paymentLinkBlocker(facts("PENDING"), 500)).toBeNull();
    expect(paymentLinkBlocker(facts("PENDING"), 0)).toMatch(/Nothing is due/);
    expect(paymentLinkBlocker(facts("CANCELLED"), 500)).not.toBeNull();
    expect(paymentLinkBlocker(facts("PACKED", { courier: true }), 500)).toMatch(/courier/);
    expect(paymentLinkBlocker(facts("PACKED", { courier: true, method: "SSLCOMMERZ" }), 500)).toBeNull();
  });
});
