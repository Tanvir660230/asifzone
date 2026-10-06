/**
 * Canonical sales facts and their pure derivations (docs/METRICS_REGISTRY.md §2–§3). The API's fact loader builds these
 * objects from Order/OrderItem snapshots (Phase 2), OrderStatusHistory (Phase 1), Payment/Refund (Phase 4) and the
 * stock ledger's RETURN rows; nothing here reads current prices, tax settings, zones, coupons or flash sales.
 *
 * Money is integer minor units (store currency). Instants are UTC `Date`s.
 */
import { allocateProportionally } from "../engines/rounding";
import { money } from "../engines/money";

export interface LineFact {
  orderItemId: string;
  variantId: string;
  /** The line's product: `OrderItem.productIdSnapshot`, else the variant's product (a variant never changes product);
   * null when neither exists — "unattributed". */
  productId: string | null;
  productName: string;
  /** Category and brand AS RECORDED on the line (Phase 6 snapshots) — never today's catalog. `attributionRecorded` is
   * false for lines written before Phase 6: their category/brand are unknown ("Not recorded"), not reconstructed. */
  attributionRecorded: boolean;
  categoryId: string | null;
  categoryName: string | null;
  /** null with `attributionRecorded` = unbranded. */
  brand: string | null;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  /** `priceSnapshot` (post-flash unit price charged), minor units. */
  unitPrice: number;
  bundleDiscountAllocated: number | null;
  couponDiscountAllocated: number | null;
  returnedQuantity: number;
  flashSaleId: string | null;
  /** `OrderItem.unitCostSnapshot`: per-unit cost recorded when the line was written (minor units). null = unknown — no
   * cost configured, or the line predates Phase 6. Historical COGS/margin never read the current cost price. */
  unitCostSnapshot: number | null;
}

export interface OrderFact {
  id: string;
  orderNumber: string;
  customerId: string | null;
  /** Storefront session that placed the order (conversion / campaign attribution). */
  sessionId: string | null;
  status: string;
  paymentMethod: string;
  deleted: boolean;
  /** Referenced by ReturnRequest.exchangeOrderId. */
  isExchangeReplacement: boolean;
  placedAt: Date;
  /** First OrderStatusHistory entry DELIVERED or PARTIALLY_DELIVERED. */
  firstDeliveredAt: Date | null;
  /** First OrderStatusHistory entry CANCELLED — the cancellation instant (P5-2). Null when never cancelled, and for a
   * legacy cancelled order that has no history entry. */
  cancelledAt: Date | null;
  subtotal: number;
  discount: number;
  bundleDiscount: number;
  couponDiscount: number | null;
  flashDiscount: number | null;
  shippingFee: number;
  shippingWaived: boolean | null;
  priceAdjustment: number;
  total: number;
  taxAmount: number | null;
  taxMode: string | null;
  /** Shipping part of `taxAmount` (D10 snapshot); null before Phase 2. */
  shippingTaxAmount: number | null;
  shippingDivision: string;
  shippingDistrict: string;
  couponId: string | null;
  bundleId: string | null;
  lines: LineFact[];
  payments: Array<{ amount: number; status: "SUCCEEDED" | "FAILED"; provider: string; settledAt: Date }>;
  refunds: Array<{ amount: number; status: "REQUESTED" | "COMPLETED"; completedAt: Date | null }>;
  /** Σ store credit issued from this order's money, minor units (CustomerCreditEntry; absent = 0). Not cash. */
  credited?: number;
  /** Stock-ledger RETURN rows for this order: units back from the customer (return date = `at`). */
  returnMovements: Array<{ variantId: string; units: number; at: Date }>;
  /** Original lines of APPROVED EXCHANGE requests (their returned units are not returns — P5-3). */
  exchangedLines: Array<{ orderItemId: string; approvedAt: Date }>;
}

/** Cancelled now, or ever (the state machine allows CANCELLED → REFUNDED, so the current status alone isn't enough). */
export function isCancelled(o: Pick<OrderFact, "status" | "cancelledAt">): boolean {
  return o.status === "CANCELLED" || o.cancelledAt !== null;
}

/** TARGET §11 SALE_ORDER (placement-basis metrics): not trashed, never cancelled, not an exchange replacement. */
export function isSaleOrder(o: Pick<OrderFact, "deleted" | "status" | "cancelledAt" | "isExchangeReplacement">): boolean {
  return !o.deleted && !isCancelled(o) && !o.isExchangeReplacement;
}

/** Operational order: any status, not trashed, not an exchange replacement. */
export function isOperationalOrder(o: Pick<OrderFact, "deleted" | "isExchangeReplacement">): boolean {
  return !o.deleted && !o.isExchangeReplacement;
}

export interface Realisation {
  /** D1 realisation instant (P5-1). */
  at: Date;
  /** The cancellation instant when the order was cancelled after it was realised (P5-2 reversal), else null. */
  reversedAt: Date | null;
}

/** D1 realisation (P5-1): COD at first delivery; otherwise at the first successful payment — only if that happened before
 * any cancellation. A realised order cancelled later keeps its realisation and is reversed at `reversedAt` (P5-2). A
 * legacy cancelled order with no cancellation instant can't be reversed at a known time and is excluded. */
export function realisationOf(o: OrderFact): Realisation | null {
  if (o.deleted || o.isExchangeReplacement) return null;
  if (isCancelled(o) && !o.cancelledAt) return null;
  let at: Date | null = null;
  if (o.paymentMethod === "COD") at = o.firstDeliveredAt;
  else for (const p of o.payments) if (p.status === "SUCCEEDED" && (!at || p.settledAt < at)) at = p.settledAt;
  if (!at) return null;
  if (o.cancelledAt && at.getTime() >= o.cancelledAt.getTime()) return null;
  return { at, reversedAt: o.cancelledAt };
}

/** The realisation instant of a realised order that still stands (not reversed by a later cancellation); null otherwise. */
export function realisedAt(o: OrderFact): Date | null {
  const r = realisationOf(o);
  return r && !r.reversedAt ? r.at : null;
}

/** Line discounts that sum exactly to `Order.discount`: the Phase 2 allocations when recorded (as weights, so a clamped
 * discount still sums exactly), else pro-rated by line gross (D1 "pro-rated discount" for pre-Phase-2 orders). */
export function lineDiscounts(o: OrderFact): number[] {
  const hasAllocations = o.lines.some((l) => l.bundleDiscountAllocated !== null || l.couponDiscountAllocated !== null);
  const weights = o.lines.map((l) =>
    hasAllocations ? (l.bundleDiscountAllocated ?? 0) + (l.couponDiscountAllocated ?? 0) : l.unitPrice * l.quantity,
  );
  const useWeights = weights.some((w) => w > 0) ? weights : o.lines.map((l) => l.unitPrice * l.quantity);
  return allocateProportionally(money(o.discount, "X"), useWeights).map((m) => m.amount);
}

export function lineGross(l: LineFact): number {
  return l.unitPrice * l.quantity;
}

/** Line net as charged (gross − allocated discount); VAT-inclusive on tax-inclusive orders. */
export function lineNets(o: OrderFact): number[] {
  const d = lineDiscounts(o);
  return o.lines.map((l, i) => lineGross(l) - d[i]!);
}

/** Merchandise VAT from the order's own tax snapshot (C2) — never the current tax setting. EXCLUSIVE: 0 (the charged
 * price excludes VAT). INCLUSIVE: taxAmount − shippingTaxAmount. Null = unknown (no snapshot): nothing is guessed. */
export function merchandiseVat(o: OrderFact): number | null {
  if (o.taxMode === "EXCLUSIVE") return 0;
  if (o.taxMode !== "INCLUSIVE" || o.taxAmount === null) return null;
  if (o.taxAmount === 0) return 0;
  if (o.shippingTaxAmount === null) return null;
  return Math.max(0, o.taxAmount - o.shippingTaxAmount);
}

/** The order's merchandise VAT split across lines by line net — an allocation (largest remainder), since VAT was never
 * recorded per line. Zeros when the VAT is 0 or unknown. */
export function lineMerchandiseVat(o: OrderFact): number[] {
  const vat = merchandiseVat(o) ?? 0;
  const nets = lineNets(o);
  if (vat === 0 || !nets.some((n) => n > 0)) return nets.map(() => 0);
  return allocateProportionally(money(vat, "X"), nets.map((n) => Math.max(0, n))).map((m) => m.amount);
}

export interface RefundAllocation {
  at: Date;
  amount: number;
  /** Step 1 — covers payment overage; never a sales reduction (C4). */
  overpayment: number;
  /** Step 2 — merchandise as charged, capped at the remaining eligible merchandise (C3). */
  merchandise: number;
  /** The VAT-exclusive equivalent of `merchandise` — what `realised_net_sales` falls by. */
  merchandiseExVat: number;
  /** Step 3 — the rest: shipping, shipping VAT, exclusive VAT, price adjustment (not merchandise). */
  other: number;
}

/** Splits each COMPLETED refund of the order, in completion order: payment overage first, then merchandise up to the
 * remaining eligible merchandise (nothing before realisation), then non-merchandise. Never pro-rata. */
export function refundAllocations(o: OrderFact): RefundAllocation[] {
  const real = realisationOf(o);
  const merchCharged = lineNets(o).reduce((s, n) => s + n, 0);
  const merchExVat = merchCharged - (merchandiseVat(o) ?? 0);
  let remCharged = real ? merchCharged : 0;
  let remExVat = real ? merchExVat : 0;
  let overageUsed = 0;
  const payments = o.payments.filter((p) => p.status === "SUCCEEDED");
  const refunds = o.refunds
    .filter((r): r is typeof r & { completedAt: Date } => r.status === "COMPLETED" && r.completedAt !== null)
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  return refunds.map((r) => {
    const paid = payments.reduce((s, p) => (p.settledAt.getTime() <= r.completedAt.getTime() ? s + p.amount : s), 0);
    const overpayment = Math.min(r.amount, Math.max(0, paid - o.total - overageUsed));
    overageUsed += overpayment;
    const rest = r.amount - overpayment;
    let merchandise = 0;
    let merchandiseExVat = 0;
    if (real && r.completedAt.getTime() >= real.at.getTime() && remCharged > 0) {
      merchandise = Math.min(rest, remCharged);
      merchandiseExVat = merchandise === remCharged ? remExVat : Math.min(remExVat, Math.round((merchandise * merchExVat) / merchCharged));
      remCharged -= merchandise;
      remExVat -= merchandiseExVat;
    }
    return { at: r.completedAt, amount: r.amount, overpayment, merchandise, merchandiseExVat, other: rest - merchandise };
  });
}

/** Shipping actually charged (§3): the waiver snapshot when known, else the order's own arithmetic. */
export function shippingCharged(o: OrderFact): number {
  if (o.shippingWaived === true) return 0;
  if (o.shippingWaived === false) return o.shippingFee;
  const taxAdded = o.taxMode === "EXCLUSIVE" ? (o.taxAmount ?? 0) : 0;
  return Math.max(0, o.total - (o.subtotal - o.discount) - o.priceAdjustment - taxAdded);
}

export function couponDiscountOf(o: OrderFact): number {
  return o.couponDiscount ?? Math.max(0, o.discount - o.bundleDiscount);
}

export interface ReturnEvent {
  variantId: string;
  units: number;
  at: Date;
  /** units × net unit value of the variant in this order (minor units). */
  value: number;
  /** `value` excluding merchandise VAT (the order's snapshot, allocated to lines). */
  valueExVat: number;
  /** A representative line of the variant (for product/category attribution). */
  line: LineFact;
  /** units × recorded unit cost; null when any line of the variant has no recorded cost (unknown). */
  cost: number | null;
}

/** Returned units valued from snapshots (§3), with exchange-returned units removed chronologically (P5-3). */
export function returnEvents(o: OrderFact): ReturnEvent[] {
  if (!o.returnMovements.length) return [];
  const discounts = lineDiscounts(o);
  const vat = lineMerchandiseVat(o);
  const byVariant = new Map<string, { net: number; netExVat: number; qty: number; cost: number | null; line: LineFact }>();
  o.lines.forEach((l, i) => {
    const entry = byVariant.get(l.variantId) ?? { net: 0, netExVat: 0, qty: 0, cost: 0, line: l };
    const net = lineGross(l) - discounts[i]!;
    entry.net += net;
    entry.netExVat += net - vat[i]!;
    entry.qty += l.quantity;
    entry.cost = entry.cost === null || l.unitCostSnapshot === null ? null : entry.cost + l.quantity * l.unitCostSnapshot;
    byVariant.set(l.variantId, entry);
  });

  // Exchanged units per variant, consumed from the earliest RETURN movements at/after the exchange approval.
  const exchangedByVariant = new Map<string, Array<{ units: number; approvedAt: Date }>>();
  for (const ex of o.exchangedLines) {
    const line = o.lines.find((l) => l.orderItemId === ex.orderItemId);
    if (!line) continue;
    const list = exchangedByVariant.get(line.variantId) ?? [];
    list.push({ units: line.quantity, approvedAt: ex.approvedAt });
    exchangedByVariant.set(line.variantId, list);
  }

  const events: ReturnEvent[] = [];
  const movements = [...o.returnMovements].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const mv of movements) {
    const info = byVariant.get(mv.variantId);
    if (!info || info.qty === 0) continue;
    let units = mv.units;
    const pending = exchangedByVariant.get(mv.variantId) ?? [];
    for (const ex of pending) {
      // An exchange restock is written in the approval transaction, so it is at (or a hair after) approvedAt.
      if (units <= 0 || ex.units <= 0 || mv.at.getTime() < ex.approvedAt.getTime() - 60_000) continue;
      const take = Math.min(units, ex.units);
      ex.units -= take;
      units -= take;
    }
    if (units <= 0) continue;
    events.push({
      variantId: mv.variantId,
      units,
      at: mv.at,
      value: Math.round((info.net * units) / info.qty),
      valueExVat: Math.round((info.netExVat * units) / info.qty),
      line: info.line,
      cost: info.cost === null ? null : Math.round((info.cost * units) / info.qty),
    });
  }
  return events;
}

/** Variant/stock rows for inventory metrics (read-only; InventoryService stays the only writer). */
export interface InventoryVariantFact {
  variantId: string;
  productId: string;
  stock: number;
  trackInventory: boolean;
  lowStockThreshold: number;
  /** Variant active and product not trashed — physical stock held (drafts included). */
  held: boolean;
  /** Product published, not trashed, variant active — sellable. */
  purchasable: boolean;
  currentUnitCost: number;
}
