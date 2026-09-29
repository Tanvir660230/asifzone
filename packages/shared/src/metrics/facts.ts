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
  /** Current product of the variant (null when the variant no longer exists — "unattributed"). */
  productId: string | null;
  productName: string;
  /** Current category/brand of that product (no historical snapshot exists — P5-7). */
  categoryId: string | null;
  categoryName: string | null;
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
  /** Current unit cost (variant ?? product ?? 0) — used only by metrics flagged *estimated* (P5-6). */
  currentUnitCost: number;
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
  shippingDivision: string;
  shippingDistrict: string;
  couponId: string | null;
  bundleId: string | null;
  lines: LineFact[];
  payments: Array<{ amount: number; status: "SUCCEEDED" | "FAILED"; provider: string; settledAt: Date }>;
  refunds: Array<{ amount: number; status: "REQUESTED" | "COMPLETED"; completedAt: Date | null }>;
  /** Stock-ledger RETURN rows for this order: units back from the customer (return date = `at`). */
  returnMovements: Array<{ variantId: string; units: number; at: Date }>;
  /** Original lines of APPROVED EXCHANGE requests (their returned units are not returns — P5-3). */
  exchangedLines: Array<{ orderItemId: string; approvedAt: Date }>;
}

/** TARGET §11 SALE_ORDER: not trashed, not cancelled, not an exchange replacement. */
export function isSaleOrder(o: Pick<OrderFact, "deleted" | "status" | "isExchangeReplacement">): boolean {
  return !o.deleted && o.status !== "CANCELLED" && !o.isExchangeReplacement;
}

/** Operational order: any status, not trashed, not an exchange replacement. */
export function isOperationalOrder(o: Pick<OrderFact, "deleted" | "isExchangeReplacement">): boolean {
  return !o.deleted && !o.isExchangeReplacement;
}

/** D1 realisation instant (P5-1): COD at first delivery; otherwise at the first successful payment. Null = not realised. */
export function realisedAt(o: OrderFact): Date | null {
  if (!isSaleOrder(o)) return null;
  if (o.paymentMethod === "COD") return o.firstDeliveredAt;
  let first: Date | null = null;
  for (const p of o.payments) if (p.status === "SUCCEEDED" && (!first || p.settledAt < first)) first = p.settledAt;
  return first;
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
  /** A representative line of the variant (for product/category attribution). */
  line: LineFact;
  /** units × current unit cost (for estimated COGS reversal). */
  currentCost: number;
}

/** Returned units valued from snapshots (§3), with exchange-returned units removed chronologically (P5-3). */
export function returnEvents(o: OrderFact): ReturnEvent[] {
  if (!o.returnMovements.length) return [];
  const discounts = lineDiscounts(o);
  const byVariant = new Map<string, { net: number; qty: number; line: LineFact }>();
  o.lines.forEach((l, i) => {
    const entry = byVariant.get(l.variantId) ?? { net: 0, qty: 0, line: l };
    entry.net += lineGross(l) - discounts[i]!;
    entry.qty += l.quantity;
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
      line: info.line,
      currentCost: units * info.line.currentUnitCost,
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
