/**
 * The fact loader (docs/METRICS_REGISTRY.md) — the ONLY code that reads sales facts for metrics. It turns Order/OrderItem
 * snapshots, OrderStatusHistory, Payment/Refund (ledger), StockMovement RETURN rows and approved exchanges into the pure
 * engine's OrderFact objects. It uses Prisma's typed API only (correct UTC semantics, no raw time comparisons) and never
 * writes anything.
 *
 * For a range, it loads exactly the orders that have an event inside it — placement, first delivery, a cancellation (the
 * P5-2 reversal instant), a payment, a refund or a returned unit — which covers every time basis a metric can use, so no
 * contribution inside the range is missed.
 */
import { fromMajor, type BusinessRange, type InventoryVariantFact, type LineFact, type OrderFact } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

const DELIVERED_STATUSES = ["DELIVERED", "PARTIALLY_DELIVERED"] as const;
const BATCH = 500;

function minor(v: { toString(): string } | number | null | undefined, currency: string): number {
  return v === null || v === undefined ? 0 : fromMajor(v.toString(), currency).amount;
}
function minorOrNull(v: { toString(): string } | number | null | undefined, currency: string): number | null {
  return v === null || v === undefined ? null : fromMajor(v.toString(), currency).amount;
}

/** Order ids with any metric-relevant event in [startUtc, endUtc). `null` = every order (lifetime range). */
export async function candidateOrderIds(range: Pick<BusinessRange, "startUtc" | "endUtc" | "preset">): Promise<string[] | null> {
  if (range.preset === "lifetime") return null;
  const window = { gte: range.startUtc, lt: range.endUtc };
  const [placed, delivered, cancelled, paid, refunded, returned] = await Promise.all([
    prisma.order.findMany({ where: { createdAt: window }, select: { id: true } }),
    prisma.orderStatusHistory.findMany({ where: { status: { in: [...DELIVERED_STATUSES] }, createdAt: window }, select: { orderId: true }, distinct: ["orderId"] }),
    prisma.orderStatusHistory.findMany({ where: { status: "CANCELLED", createdAt: window }, select: { orderId: true }, distinct: ["orderId"] }),
    prisma.payment.findMany({ where: { settledAt: window, orderId: { not: null } }, select: { orderId: true }, distinct: ["orderId"] }),
    prisma.refund.findMany({ where: { completedAt: window }, select: { orderId: true }, distinct: ["orderId"] }),
    prisma.stockMovement.findMany({ where: { reason: "RETURN", createdAt: window, orderId: { not: null } }, select: { orderId: true }, distinct: ["orderId"] }),
  ]);
  const ids = new Set<string>();
  for (const r of placed) ids.add(r.id);
  for (const r of [...delivered, ...cancelled, ...paid, ...refunded, ...returned]) if (r.orderId) ids.add(r.orderId);
  return [...ids];
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  customerId: true,
  sessionId: true,
  status: true,
  paymentMethod: true,
  deletedAt: true,
  createdAt: true,
  subtotal: true,
  discount: true,
  bundleDiscount: true,
  couponDiscount: true,
  flashDiscount: true,
  shippingFee: true,
  shippingWaived: true,
  priceAdjustment: true,
  total: true,
  taxAmount: true,
  taxMode: true,
  shippingTaxAmount: true,
  shippingDivision: true,
  shippingDistrict: true,
  couponId: true,
  bundleId: true,
  items: {
    select: {
      id: true,
      variantId: true,
      productNameSnapshot: true,
      skuSnapshot: true,
      sizeSnapshot: true,
      colorSnapshot: true,
      priceSnapshot: true,
      quantity: true,
      returnedQuantity: true,
      bundleDiscountAllocated: true,
      couponDiscountAllocated: true,
      flashSaleId: true,
    },
    orderBy: { id: "asc" as const },
  },
  payments: { select: { amount: true, status: true, provider: true, settledAt: true } },
  refunds: { select: { amount: true, status: true, completedAt: true } },
  statusHistory: { where: { status: { in: [...DELIVERED_STATUSES, "CANCELLED" as const] } }, select: { status: true, createdAt: true }, orderBy: { createdAt: "asc" as const } },
};

/** Loads OrderFacts for the given ids (or every order when `ids` is null). */
export async function loadOrderFacts(ids: string[] | null, currency: string): Promise<OrderFact[]> {
  const rows = [];
  if (ids === null) {
    rows.push(...(await prisma.order.findMany({ select: ORDER_SELECT })));
  } else {
    for (let i = 0; i < ids.length; i += BATCH) {
      rows.push(...(await prisma.order.findMany({ where: { id: { in: ids.slice(i, i + BATCH) } }, select: ORDER_SELECT })));
    }
  }
  if (!rows.length) return [];
  const orderIds = rows.map((r) => r.id);

  const [returnMovements, exchangeRequests, replacementRefs, variants] = await Promise.all([
    batched(orderIds, (chunk) =>
      prisma.stockMovement.findMany({ where: { reason: "RETURN", orderId: { in: chunk } }, select: { orderId: true, variantId: true, change: true, createdAt: true } }),
    ),
    batched(orderIds, (chunk) =>
      prisma.returnRequest.findMany({
        where: { orderId: { in: chunk }, type: "EXCHANGE", status: "APPROVED", orderItemId: { not: null } },
        select: { orderId: true, orderItemId: true, reviewedAt: true, updatedAt: true },
      }),
    ),
    batched(orderIds, (chunk) => prisma.returnRequest.findMany({ where: { exchangeOrderId: { in: chunk } }, select: { exchangeOrderId: true } })),
    loadVariantAttribution([...new Set(rows.flatMap((r) => r.items.map((i) => i.variantId)))], currency),
  ]);

  const movementsBy = groupBy(returnMovements, (m) => m.orderId!);
  const exchangesBy = groupBy(exchangeRequests, (e) => e.orderId);
  const replacementIds = new Set(replacementRefs.map((r) => r.exchangeOrderId!));

  return rows.map((o): OrderFact => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerId: o.customerId,
    sessionId: o.sessionId,
    status: o.status,
    paymentMethod: o.paymentMethod,
    deleted: o.deletedAt !== null,
    isExchangeReplacement: replacementIds.has(o.id),
    placedAt: o.createdAt,
    firstDeliveredAt: o.statusHistory.find((h) => h.status !== "CANCELLED")?.createdAt ?? null,
    cancelledAt: o.statusHistory.find((h) => h.status === "CANCELLED")?.createdAt ?? null,
    subtotal: minor(o.subtotal, currency),
    discount: minor(o.discount, currency),
    bundleDiscount: minor(o.bundleDiscount, currency),
    couponDiscount: minorOrNull(o.couponDiscount, currency),
    flashDiscount: minorOrNull(o.flashDiscount, currency),
    shippingFee: minor(o.shippingFee, currency),
    shippingWaived: o.shippingWaived,
    priceAdjustment: minor(o.priceAdjustment, currency),
    total: minor(o.total, currency),
    taxAmount: minorOrNull(o.taxAmount, currency),
    taxMode: o.taxMode,
    shippingTaxAmount: minorOrNull(o.shippingTaxAmount, currency),
    shippingDivision: o.shippingDivision,
    shippingDistrict: o.shippingDistrict,
    couponId: o.couponId,
    bundleId: o.bundleId,
    lines: o.items.map((i): LineFact => {
      const v = variants.get(i.variantId);
      return {
        orderItemId: i.id,
        variantId: i.variantId,
        productId: v?.productId ?? null,
        productName: i.productNameSnapshot,
        categoryId: v?.categoryId ?? null,
        categoryName: v?.categoryName ?? null,
        brand: v?.brand ?? null,
        sku: i.skuSnapshot,
        size: i.sizeSnapshot,
        color: i.colorSnapshot,
        quantity: i.quantity,
        unitPrice: minor(i.priceSnapshot, currency),
        bundleDiscountAllocated: minorOrNull(i.bundleDiscountAllocated, currency),
        couponDiscountAllocated: minorOrNull(i.couponDiscountAllocated, currency),
        returnedQuantity: i.returnedQuantity,
        flashSaleId: i.flashSaleId,
        currentUnitCost: v?.unitCost ?? 0,
      };
    }),
    payments: o.payments.map((p) => ({ amount: minor(p.amount, currency), status: p.status, provider: p.provider, settledAt: p.settledAt })),
    refunds: o.refunds.map((r) => ({ amount: minor(r.amount, currency), status: r.status, completedAt: r.completedAt })),
    returnMovements: (movementsBy.get(o.id) ?? []).map((m) => ({ variantId: m.variantId, units: m.change, at: m.createdAt })),
    exchangedLines: (exchangesBy.get(o.id) ?? []).map((e) => ({ orderItemId: e.orderItemId!, approvedAt: e.reviewedAt ?? e.updatedAt })),
  }));
}

/** Current product/category/brand/cost of each variant — attribution only (P5-6, P5-7); a missing variant is unattributed. */
async function loadVariantAttribution(variantIds: string[], currency: string) {
  const out = new Map<string, { productId: string; categoryId: string | null; categoryName: string | null; brand: string | null; unitCost: number }>();
  const rows = await batched(variantIds, (chunk) =>
    prisma.productVariant.findMany({
      where: { id: { in: chunk } },
      select: { id: true, costPrice: true, product: { select: { id: true, brand: true, costPrice: true, categoryId: true, category: { select: { name: true } } } } },
    }),
  );
  for (const v of rows) {
    out.set(v.id, {
      productId: v.product.id,
      categoryId: v.product.categoryId,
      categoryName: v.product.category?.name ?? null,
      brand: v.product.brand,
      unitCost: minor(v.costPrice ?? v.product.costPrice, currency),
    });
  }
  return out;
}

/** Point-in-time ledger positions need every non-trashed order's money rows (no lines). */
export async function loadPositionFacts(currency: string): Promise<OrderFact[]> {
  const rows = await prisma.order.findMany({
    where: { deletedAt: null },
    select: { id: true, total: true, paymentMethod: true, status: true, payments: { select: { amount: true, status: true, provider: true, settledAt: true } }, refunds: { select: { amount: true, status: true, completedAt: true } } },
  });
  return rows.map((o) => ({
    ...EMPTY_ORDER,
    id: o.id,
    status: o.status,
    paymentMethod: o.paymentMethod,
    total: minor(o.total, currency),
    payments: o.payments.map((p) => ({ amount: minor(p.amount, currency), status: p.status, provider: p.provider, settledAt: p.settledAt })),
    refunds: o.refunds.map((r) => ({ amount: minor(r.amount, currency), status: r.status, completedAt: r.completedAt })),
  }));
}

const EMPTY_ORDER: OrderFact = {
  id: "",
  orderNumber: "",
  customerId: null,
  sessionId: null,
  status: "",
  paymentMethod: "",
  deleted: false,
  isExchangeReplacement: false,
  placedAt: new Date(0),
  firstDeliveredAt: null,
  cancelledAt: null,
  subtotal: 0,
  discount: 0,
  bundleDiscount: 0,
  couponDiscount: null,
  flashDiscount: null,
  shippingFee: 0,
  shippingWaived: null,
  priceAdjustment: 0,
  total: 0,
  taxAmount: null,
  taxMode: null,
  shippingTaxAmount: null,
  shippingDivision: "",
  shippingDistrict: "",
  couponId: null,
  bundleId: null,
  lines: [],
  payments: [],
  refunds: [],
  returnMovements: [],
  exchangedLines: [],
};

/** Variant stock rows for inventory metrics — read-only (InventoryService remains the only stock writer). */
export async function loadInventoryFacts(currency: string): Promise<InventoryVariantFact[]> {
  const rows = await prisma.productVariant.findMany({
    select: {
      id: true,
      stock: true,
      isActive: true,
      costPrice: true,
      product: { select: { id: true, trackInventory: true, lowStockThreshold: true, status: true, deletedAt: true, costPrice: true } },
    },
  });
  return rows.map((v) => ({
    variantId: v.id,
    productId: v.product.id,
    stock: v.stock,
    trackInventory: v.product.trackInventory,
    lowStockThreshold: v.product.lowStockThreshold,
    held: v.isActive && v.product.deletedAt === null,
    purchasable: v.isActive && v.product.deletedAt === null && v.product.status === "PUBLISHED",
    currentUnitCost: minor(v.costPrice ?? v.product.costPrice, currency),
  }));
}

export async function loadCourierLoss(range: Pick<BusinessRange, "startUtc" | "endUtc">, currency: string): Promise<Array<{ amount: number; at: Date }>> {
  const rows = await prisma.courierLossEvent.findMany({ where: { createdAt: { gte: range.startUtc, lt: range.endUtc } }, select: { amount: true, createdAt: true } });
  return rows.map((r) => ({ amount: minor(r.amount, currency), at: r.createdAt }));
}

async function batched<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH) out.push(...(await fn(ids.slice(i, i + BATCH))));
  return out;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}
