import {
  formatDateTime,
  formatMoney,
  describeRefusedTransition,
  formatVariantLabel,
  formatVariantSuffix,
  getOrderTransition,
  allocateProportionally,
  computeOrderTotals,
  fromMajor,
  isAvailable,
  maxSellableQuantity,
  resolveZone,
  toMajor,
  type Quote,
  orderStatusEnum,
  PRE_SHIPMENT_STATUSES,
  MONEY_HELD_PAYMENT_STATUSES,
  ORDER_QUEUE_FILTERS,
  ORDER_QUEUE_IDS,
  PRICE_ADJUSTMENT_LOCKED_STATUSES,
  type OrderQueueId,
  type OrderTransitionRule,
  clampNonNegative,
  subtract,
} from "@clothing-brand/shared";
import type {
  CheckoutInput,
  AdminCreateOrderInput,
  OrderListQuery,
  OrderListItemSummary,
  DeliveryScore,
  OrderItemLiveInfo,
  OrderStatus,
  PaymentStatus,
  UpdateOrderStatusInput,
  UpdateOrderDetailsInput,
  HoldOrderInput,
  AdjustOrderPriceInput,
  ReconcilePartialDeliveryInput,
  BulkOrderStatusResult,
} from "@clothing-brand/shared";
import { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient, type Db } from "../../config/prisma";
import { captureLineSnapshots, lineSnapshotData } from "../../domain/orders/line-snapshots";
import { redis } from "../../config/redis";
import { namespace } from "../../config/installation";
import { AppError } from "../../lib/app-error";
import { generateOrderNumber } from "../../lib/order-number";
import { paginate } from "../../lib/paginate";
import { notify } from "../../lib/notify";
import type { CustomerTouchpoint } from "../../lib/order-sms";
import { recordOutboxEvents, type OutboxIntent } from "../../domain/outbox/outbox";
import { incrementCouponUsage } from "../coupons/coupon.service";
import { flashUnitsSold, priceProductsForDisplay, quoteCart, toQuoteDto, type PricedQuote, type PriceableProduct } from "../../domain/pricing/pricing.service";
import { LEGACY_ZONE_KEYS, loadShippingZones } from "../../domain/pricing/pricing-config";
import { getSettings } from "../settings/settings.service";
import { awardDeliveryPoints, findOrCreateGuestCustomer, checkAndUpdateDeliveryScore, loyaltyBase, reverseDeliveryPoints } from "../customers/customer.service";
import { clearCart } from "../cart/cart.service";
import { startPaymentSession } from "../payments/payment.service";
import { csvCell } from "../../lib/csv";
import { notifyReplenished, recordSale, releaseOrderLines, reReserveOrderLines } from "../inventory/inventory.service";
import { computeMetrics } from "../../domain/metrics/metrics.service";
import {
  REFUND_QUEUE_WHERE,
  RETURNED_REFUND_DUE_WHERE,
  getOrderPaymentSummary,
  recordCodCollection,
  recordGatewaySettlement,
  recordMarkedPaid,
  payWithStoreCredit,
  settleReservedStoreCredit,
  summarizeOrderPayments,
} from "../../domain/payments/payment-ledger.service";
import type { MetaRequestContext } from "../../lib/meta/capi";
import { getCurrency, getTimezone } from "../../domain/config/commerce-settings";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";

export const orderInclude = {
  items: true,
  statusHistory: { orderBy: { createdAt: "asc" as const }, include: { changedByAdmin: { select: { name: true } } } },
};
const include = orderInclude;

/** Order-level pricing facts snapshotted onto an Order (PRICING_INVARIANTS §8). Plain JSON (major units) so a gateway
 * checkout can carry it through PaymentSession.checkoutPayload unchanged. New fields are optional because payloads
 * written before Phase 2 may still settle. */
export interface OrderPricingSnapshot {
  subtotal: number;
  discount: number;
  couponId: string | null;
  couponFreeShipping: boolean;
  bundleId: string | null;
  bundleDiscount: number;
  shippingFee: number;
  total: number;
  pricingVersion?: number;
  flashDiscount?: number;
  couponDiscount?: number;
  shippingWaived?: boolean;
  shippingZoneKey?: string | null;
  taxMode?: "INCLUSIVE" | "EXCLUSIVE";
  taxRate?: number;
  shippingTaxRate?: number;
  taxableAmount?: number;
  taxAmount?: number;
  shippingTaxAmount?: number;
}

/** One order line = one unit price. A cart line that is partly flash-priced (D4) becomes two snapshots. */
export interface OrderItemSnapshot {
  variantId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  sizeSnapshot: string;
  colorSnapshot: string;
  priceSnapshot: number;
  quantity: number;
  listPriceSnapshot?: number | null;
  flashSaleId?: string | null;
  flashSaleItemId?: string | null;
  bundleDiscountAllocated?: number | null;
  couponDiscountAllocated?: number | null;
  /** Product.freeDelivery when priced (absent on gateway payloads written before it existed → NULL). */
  freeDeliverySnapshot?: boolean | null;
}

export interface DerivedOrderPricing extends OrderPricingSnapshot {
  customerId: string;
  quote: Quote;
  quoteToken: string;
  itemSnapshots: OrderItemSnapshot[];
  /** Raw catalog rows (names, thresholds) for post-commit alerts. */
  rows: PricedQuote["rows"];
}

/** Flattens a quote into the order's line snapshots: one per price segment, with the line's bundle/coupon allocation
 * split across its segments in proportion to their amounts (sums exactly). */
export function toItemSnapshots(quote: Quote): OrderItemSnapshot[] {
  return quote.lines.flatMap((line) => {
    const bundleParts = allocateProportionally(line.bundleDiscount, line.segments.map((s) => s.total.amount));
    const couponParts = allocateProportionally(line.couponDiscount, line.segments.map((s) => s.total.amount));
    return line.segments.map((seg, i) => ({
      variantId: line.variantId,
      productNameSnapshot: line.productName,
      skuSnapshot: line.sku,
      sizeSnapshot: line.size,
      colorSnapshot: line.color,
      priceSnapshot: toMajor(seg.unitPrice),
      quantity: seg.quantity,
      listPriceSnapshot: toMajor(seg.listUnitPrice),
      flashSaleId: seg.flash?.flashSaleId ?? null,
      flashSaleItemId: seg.flash?.flashSaleItemId ?? null,
      bundleDiscountAllocated: toMajor(bundleParts[i]!),
      couponDiscountAllocated: toMajor(couponParts[i]!),
      freeDeliverySnapshot: line.freeDelivery,
    }));
  });
}

/** Refuses an order whose quote can't be placed, with the same messages checkout has always used. */
function assertOrderable(quote: Quote, input: CheckoutInput, rows: PricedQuote["rows"]) {
  for (const w of quote.warnings) {
    if (w.code === "UNKNOWN_ITEM") throw AppError.badRequest(w.message);
    if (w.code === "UNAVAILABLE") throw AppError.badRequest(w.message);
    if (w.code === "INSUFFICIENT_STOCK") {
      const row = rows.get(w.variantId);
      throw AppError.conflict(`Not enough stock for ${row?.product.name ?? "an item"}${row ? formatVariantSuffix(row.size, row.color) : ""}`);
    }
  }
  if (input.couponCode) {
    const rejected = quote.rejectedPromotions.find((r) => r.kind === "COUPON");
    if (rejected) throw AppError.badRequest(rejected.message);
  }
  if (!quote.shipping.resolved) {
    throw AppError.badRequest(quote.shipping.reason === "NO_ZONE" ? "We can't deliver to this address yet" : "A delivery address is required");
  }
}

/** Everything about a checkout that can be computed without writing anything — ONE call to the canonical pricing
 * service (docs/PRICING_INVARIANTS.md), plus payment-method availability. Shared by createOrder and the storefront
 * gateway flow (payment.service.ts initiatePendingPayment prices the gateway session with it). Never writes stock.
 *
 * `input.quoteToken` (the quote the customer was shown): when present and no longer matching the server's price, the
 * order is refused with 409 QUOTE_CHANGED carrying the fresh quote — a stale price is never charged. */
export async function deriveOrderPricing(input: CheckoutInput, customerId: string | null, db: Db = prisma): Promise<DerivedOrderPricing> {
  // A guest (no session cookie) still gets tied to a real Customer row, matched by email/phone —
  // see findOrCreateGuestCustomer for why (repeat-guest recognition, and a base to merge into once
  // they register/log in).
  if (!customerId) {
    customerId = await findOrCreateGuestCustomer(input.customerName, input.customerEmail ?? null, input.customerPhone);
  }

  const settings = await getSettings();
  if (input.paymentMethod === "COD" && !settings.codEnabled) {
    throw AppError.badRequest("Cash on Delivery is currently unavailable — please pay online instead");
  }
  if (input.paymentMethod === "SSLCOMMERZ" && !settings.onlinePaymentEnabled) {
    throw AppError.badRequest("Online payment is currently unavailable — please choose Cash on Delivery instead");
  }
  if (input.paymentMethod === "EPS_PG" && !settings.epsPaymentEnabled) {
    throw AppError.badRequest("Online payment is currently unavailable — please choose Cash on Delivery instead");
  }

  const priced = await quoteCart(
    {
      items: input.items,
      couponCode: input.couponCode ?? null,
      address: { district: input.shippingDistrict, division: input.shippingDivision },
      customerId,
    },
    db,
  );
  const { quote } = priced;
  assertOrderable(quote, input, priced.rows);
  if (input.quoteToken && input.quoteToken !== priced.token) {
    throw new AppError(409, "Prices in your cart have changed — please review the updated total", { code: "QUOTE_CHANGED", quote: toQuoteDto(priced) });
  }

  const shipping = quote.shipping.resolved ? quote.shipping : null;
  return {
    customerId,
    quote,
    quoteToken: priced.token,
    rows: priced.rows,
    itemSnapshots: toItemSnapshots(quote),
    subtotal: toMajor(quote.subtotal),
    discount: toMajor(quote.discount),
    couponId: quote.coupon?.id ?? null,
    couponFreeShipping: quote.coupon?.freeShipping ?? false,
    bundleId: quote.bundle?.bundleId ?? null,
    bundleDiscount: toMajor(quote.bundleDiscount),
    shippingFee: shipping ? toMajor(shipping.fee) : 0,
    total: toMajor(quote.total),
    pricingVersion: quote.pricingVersion,
    flashDiscount: toMajor(quote.flashDiscount),
    couponDiscount: toMajor(quote.couponDiscount),
    shippingWaived: shipping?.waived ?? false,
    shippingZoneKey: shipping?.zoneKey ?? null,
    taxMode: quote.tax.mode,
    taxRate: quote.tax.ratePct,
    shippingTaxRate: quote.tax.shipping.ratePct,
    taxableAmount: toMajor(quote.tax.taxableAmount),
    taxAmount: toMajor(quote.tax.taxAmount),
    shippingTaxAmount: toMajor(quote.tax.shipping.taxAmount),
  };
}

/** D4 at commit time: flash-priced units are re-checked under a row lock on each flash-sale item, so two concurrent
 * checkouts can never both take the last flash unit. A shortfall means the price the customer saw no longer holds. */
export async function claimFlashUnits(tx: Prisma.TransactionClient, snapshots: OrderItemSnapshot[]) {
  const claims = new Map<string, number>();
  for (const s of snapshots) if (s.flashSaleItemId) claims.set(s.flashSaleItemId, (claims.get(s.flashSaleItemId) ?? 0) + s.quantity);
  if (!claims.size) return;
  const ids = [...claims.keys()];
  const locked = await tx.$queryRaw<Array<{ id: string; stockLimit: number | null }>>`
    SELECT id, "stockLimit" FROM "FlashSaleItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `;
  const sold = await flashUnitsSold(ids, tx);
  for (const item of locked) {
    if (item.stockLimit === null) continue;
    // `sold` already includes this order's own lines (inserted above in the same transaction).
    if ((sold.get(item.id) ?? 0) > item.stockLimit) {
      throw new AppError(409, "The flash-sale price for an item in your cart has just sold out — please review the updated total", { code: "QUOTE_CHANGED" });
    }
  }
}

/** Inserts the actual Order row (+ items/statusHistory/StockMovement, coupon-usage increment) and
 * fires the post-commit side effects (admin notification, customer SMS, cart-mirror clear,
 * low-stock alerts) — the one place that writes an Order at all. `init` picks the row's starting
 * status: PENDING for a checkout that hasn't been paid yet (COD, admin-entered), or CONFIRMED for a
 * storefront digital payment materializing its order only now that the gateway has confirmed success
 * (see payment.service.ts's settlePaymentSession). The payment status is never set here: the order
 * starts UNPAID and the payment ledger derives it from the settlement recorded in this same
 * transaction (`gatewaySettlement`, or an admin's `markPaidByAdminId`) — docs/PAYMENT_LEDGER.md.
 *
 * Every price comes from `pricing` (the canonical quote, or — for a settling gateway payment — the snapshot of the quote
 * the customer paid). Nothing here computes a price.
 *
 * `allowOversell`, set only by that settlement path, governs what happens if stock (or the flash-sale limit) ran out while
 * the customer was on the gateway page: since money has already changed hands, the order is still created with the
 * price that was paid, and stock may go below zero with an admin alert instead of the 409 a pre-payment checkout gets. */
export async function insertOrderRecord(
  input: CheckoutInput,
  pricing: OrderPricingSnapshot & { customerId: string | null; itemSnapshots?: OrderItemSnapshot[]; rows?: PricedQuote["rows"] },
  init: { status: OrderStatus },
  opts: {
    changedByAdminId?: string;
    statusNote?: string;
    customerSmsTouchpoint?: CustomerTouchpoint;
    allowOversell?: boolean;
    // Locked-in item snapshots from checkout-initiation time (payment.service.ts's initiatePendingPayment) — the lines
    // exactly as the customer was quoted and charged.
    itemSnapshots?: OrderItemSnapshot[];
    idempotencyKey?: string | null;
    // Set only by the two storefront paths (COD checkout, settled gateway payment) — its presence is
    // what marks this as a website conversion to report to Meta. An admin-entered phone/Facebook
    // order never passes it: that sale didn't happen on the website.
    metaContext?: MetaRequestContext;
    // The verified gateway payment that pays for this order (a settling pre-order session) — recorded in the ledger in
    // the same transaction, so the order is never PAID without its Payment row.
    gatewaySettlement?: {
      paymentSessionId: string;
      provider: "SSLCOMMERZ" | "EPS_PG";
      amount: number;
      verifiedAmount: number;
      providerTransactionId: string;
      rawResponse?: unknown;
    };
    // An admin-entered order the staff member ticked "paid" on — a MANUAL settlement in the same transaction.
    markPaidByAdminId?: string;
    // Pay from this customer's store balance in the order's own transaction (docs/ORDER_ADJUSTMENTS.md §6): the signed-in
    // account at checkout, or the customer staff selected. Only ever the order's own customer.
    storeCreditCustomerId?: string | null;
    // A gateway checkout that reserved store balance: the reservation becomes this order's STORE_CREDIT payment.
    reservedStoreCredit?: { paymentSessionId: string; customerId: string };
    // Fully paid when written (store balance covered it): move it straight to CONFIRMED, like a settled gateway order.
    confirmWhenPaid?: boolean;
  } = {},
) {
  const snapshots = opts.itemSnapshots ?? pricing.itemSnapshots ?? [];
  if (!snapshots.length) throw AppError.badRequest("Cart is empty");
  const oversoldItems: { name: string; size: string; color: string }[] = [];
  let stockAfter = new Map<string, number>();
  const untracked = new Set([...(pricing.rows?.values() ?? [])].filter((r) => !r.product.trackInventory).map((r) => r.id));
  const currency = await getCurrency();

  const order = await prisma.$transaction(async (tx) => {
    // Phase 6: cost and attribution as the catalog stands when the line is written (docs/PHASE_6_AUDIT.md).
    const lineSnapshots = await captureLineSnapshots(tx, snapshots.map((s) => s.variantId), currency);
    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: pricing.customerId,
        sessionId: input.sessionId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        paymentMethod: input.paymentMethod,
        customerName: input.customerName,
        customerEmail: input.customerEmail ?? null,
        customerPhone: input.customerPhone,
        shippingDivision: input.shippingDivision,
        shippingDistrict: input.shippingDistrict,
        shippingArea: input.shippingArea,
        shippingAddressLine: input.shippingAddressLine,
        notes: input.notes ?? null,
        subtotal: pricing.subtotal,
        discount: pricing.discount,
        shippingFee: pricing.shippingFee,
        total: pricing.total,
        couponId: pricing.couponId,
        bundleId: pricing.bundleId,
        bundleDiscount: pricing.bundleDiscount,
        // Phase 2 snapshot (absent on a gateway payload written before Phase 2 → NULL = unknown).
        pricingVersion: pricing.pricingVersion ?? null,
        flashDiscount: pricing.flashDiscount ?? null,
        couponDiscount: pricing.couponDiscount ?? null,
        shippingWaived: pricing.shippingWaived ?? null,
        shippingZoneKey: pricing.shippingZoneKey ?? null,
        taxMode: pricing.taxMode ?? null,
        taxRate: pricing.taxRate ?? null,
        shippingTaxRate: pricing.shippingTaxRate ?? null,
        taxableAmount: pricing.taxableAmount ?? null,
        taxAmount: pricing.taxAmount ?? null,
        shippingTaxAmount: pricing.shippingTaxAmount ?? null,
        status: init.status,
        items: {
          create: snapshots.map((s) => ({
            variantId: s.variantId,
            productNameSnapshot: s.productNameSnapshot,
            skuSnapshot: s.skuSnapshot,
            sizeSnapshot: s.sizeSnapshot,
            colorSnapshot: s.colorSnapshot,
            priceSnapshot: s.priceSnapshot,
            quantity: s.quantity,
            listPriceSnapshot: s.listPriceSnapshot ?? null,
            flashSaleId: s.flashSaleId ?? null,
            flashSaleItemId: s.flashSaleItemId ?? null,
            bundleDiscountAllocated: s.bundleDiscountAllocated ?? null,
            couponDiscountAllocated: s.couponDiscountAllocated ?? null,
            freeDeliverySnapshot: s.freeDeliverySnapshot ?? null,
            ...lineSnapshotData(lineSnapshots, s.variantId),
          })),
        },
        statusHistory: {
          create: {
            status: init.status,
            changedByAdminId: opts.changedByAdminId ?? null,
            note: opts.statusNote ?? null,
          },
        },
      },
      include,
    });

    // D4: flash-priced units claimed under a lock (a paid settlement keeps the price it paid).
    if (!opts.allowOversell) await claimFlashUnits(tx, snapshots);

    // Stock: one sale per variant (a split line's segments add up). A short line aborts the whole order with a 409 —
    // unless payment already succeeded (allowOversell). Untracked products (D5) never block on stock.
    const perVariant = new Map<string, number>();
    for (const s of snapshots) perVariant.set(s.variantId, (perVariant.get(s.variantId) ?? 0) + s.quantity);
    const sale = await recordSale(
      tx,
      created.id,
      [...perVariant].map(([variantId, quantity]) => ({ variantId, quantity })),
      { allowOversell: opts.allowOversell, untrackedVariantIds: untracked },
    );
    stockAfter = sale.stockAfter;
    for (const variantId of sale.oversold) {
      const snapshot = snapshots.find((s) => s.variantId === variantId);
      oversoldItems.push({ name: snapshot?.productNameSnapshot ?? variantId, size: snapshot?.sizeSnapshot ?? "", color: snapshot?.colorSnapshot ?? "" });
    }

    if (pricing.couponId) await incrementCouponUsage(tx, pricing.couponId);

    // Payment ledger (docs/PAYMENT_LEDGER.md): the settlement that pays for this order, in the same transaction.
    if (opts.gatewaySettlement) await recordGatewaySettlement(tx, { orderId: created.id, ...opts.gatewaySettlement });
    if (opts.reservedStoreCredit) await settleReservedStoreCredit(tx, { orderId: created.id, ...opts.reservedStoreCredit });
    let paidFromBalance = false;
    if (opts.storeCreditCustomerId && opts.storeCreditCustomerId === pricing.customerId) {
      paidFromBalance = Boolean(
        await payWithStoreCredit(tx, {
          orderId: created.id,
          customerId: opts.storeCreditCustomerId,
          idempotencyKey: `credit:order:${created.id}:checkout`,
          adminId: opts.changedByAdminId ?? null,
        }),
      );
    }
    if (opts.markPaidByAdminId) await recordMarkedPaid(tx, created.id, opts.markPaidByAdminId);
    if (opts.confirmWhenPaid && paidFromBalance) {
      const now = await tx.order.findUniqueOrThrow({ where: { id: created.id }, select: { status: true, paymentStatus: true } });
      if (now.status === "PENDING" && now.paymentStatus === "PAID") {
        await applyOrderTransition(tx, created.id, { status: "CONFIRMED", note: "Paid from store balance" });
      }
    }

    // Phase 8: the side-effect intents commit (or roll back) WITH the order — delivered afterwards by the outbox worker.
    const placed = { aggregateType: "Order", aggregateId: created.id, eventType: "order.placed.v1" } as const;
    const intents: OutboxIntent[] = [
      { ...placed, consumer: "customer-order-sms", eventKey: `order:${created.id}:placed`, payload: { orderId: created.id, touchpoint: opts.customerSmsTouchpoint ?? "PLACED" } },
      { ...placed, consumer: "admin-order-alert-sms", eventKey: `order:${created.id}:placed`, payload: { orderId: created.id } },
    ];
    if (opts.gatewaySettlement) {
      intents.push({ aggregateType: "Order", aggregateId: created.id, eventType: "payment.settled.v1", consumer: "payment-receipt-email", eventKey: `order:${created.id}:paid`, payload: { orderId: created.id } });
    }
    if (opts.metaContext && getProviders().serverEvents.enabled()) {
      intents.push({ ...placed, consumer: "meta-capi-purchase", eventKey: `order:${created.id}`, payload: { orderId: created.id, context: { ...opts.metaContext } } });
    }
    await recordOutboxEvents(tx, intents);

    return opts.gatewaySettlement || opts.markPaidByAdminId || opts.reservedStoreCredit || paidFromBalance
      ? tx.order.findUniqueOrThrow({ where: { id: created.id }, include })
      : created;
  });

  notify({
    type: "order.created",
    title: `New order ${order.orderNumber}`,
    body: `${order.customerName} · ${new Set(snapshots.map((s) => s.variantId)).size} item(s)`,
    link: `/admin/orders/${order.id}`,
  });

  if (oversoldItems.length > 0) {
    notify({
      type: "product.low_stock",
      title: `Oversold on paid order ${order.orderNumber}`,
      body: oversoldItems.map((i) => `${i.name}${formatVariantSuffix(i.size, i.color)}`).join(", "),
      link: `/admin/orders/${order.id}`,
    });
  }

  // A real purchase just happened — the server-side cart mirror (if any) is stale now, so the
  // abandonment sweep must not fire on it.
  if (pricing.customerId) {
    clearCart(pricing.customerId).catch((err) => captureError(err, { msg: "[cart] clear after order failed:" }));

    // Same Steadfast fraud_check the admin used to trigger by hand with "Check score" on the order
    // list — fired automatically the moment the order lands, so the delivery-score badge is already
    // populated by the time anyone opens the order. Fire-and-forget: Steadfast being slow/down must
    // never delay or fail checkout.
    checkAndUpdateDeliveryScore(pricing.customerId, order.customerPhone).catch((err) =>
      captureError(err, { msg: `[courier] auto delivery-score check failed for order ${order.orderNumber}:` }),
    );
  }

  for (const [variantId, remaining] of stockAfter) {
    const row = pricing.rows?.get(variantId);
    if (!row) continue;
    if (row.product.trackInventory && remaining <= row.product.lowStockThreshold) {
      notify({
        type: "product.low_stock",
        title: `Low stock: ${row.product.name}`,
        body: `${formatVariantLabel(row.size, row.color, "/") || row.sku} — ${Math.max(0, remaining)} left`,
        link: `/admin/products/${row.productId}/edit`,
      });
    }
  }

  return order;
}

export async function createOrder(
  input: CheckoutInput,
  customerId: string | null = null,
  // Only the admin "Create order" path sets changedByAdminId/statusNote — attributes the order's opening PENDING
  // statusHistory entry to the staff member who entered it. idempotencyKey comes from the Idempotency-Key header;
  // metaContext (storefront checkout only) marks a website conversion to report to Meta.
  opts: {
    changedByAdminId?: string;
    statusNote?: string;
    idempotencyKey?: string | null;
    metaContext?: MetaRequestContext;
    markPaidByAdminId?: string;
    /** Pay from this customer's store balance (the signed-in account, or the customer staff selected). */
    storeCreditCustomerId?: string | null;
    /** Store balance covered the whole order: confirm it like a settled online payment. */
    initialStatus?: "CONFIRMED";
  } = {},
) {
  // Idempotency: one lock-and-dedupe mechanism, keyed by the Idempotency-Key header when the client sends one (durable:
  // Order.idempotencyKey is unique), else by the storefront's own client-generated sessionId (the pre-existing
  // double-submit guard — never by phone: a phone+total match once let anyone who knew a stranger's phone number and
  // order total get that stranger's order echoed back). Scoped to still-PENDING/UNPAID orders for the session fallback,
  // so a genuine retry after FAILED/CANCELLED creates a fresh attempt.
  const key = opts.idempotencyKey ?? null;
  if (key) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey: key }, include });
    if (existing) return existing;
  }

  const pricing = await deriveOrderPricing(input, customerId);

  const lockKey = key ? namespace.lock(`order-idem:${key}`) : input.sessionId ? namespace.lock(`order-create:${input.sessionId}`) : null;
  const findDuplicate = () =>
    key
      ? prisma.order.findUnique({ where: { idempotencyKey: key }, include })
      : prisma.order.findFirst({
          where: {
            deletedAt: null,
            status: "PENDING",
            paymentStatus: "UNPAID",
            sessionId: input.sessionId,
            total: pricing.total,
            createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
          },
          orderBy: { createdAt: "desc" },
          include,
        });

  if (lockKey) {
    // Closes the gap between checking for a duplicate and committing the new order. Best-effort like every other use of
    // this Redis client: if Redis is unreachable, fail open — with an Idempotency-Key the unique index is the backstop.
    const acquired = await redis.set(lockKey, "1", "PX", 10_000, "NX").catch(() => "OK");
    if (!acquired) {
      // Another request for this exact key/session already holds the lock — poll briefly for its row.
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const existing = await findDuplicate();
        if (existing) return existing;
      }
    } else {
      const duplicate = await findDuplicate();
      if (duplicate) {
        await redis.del(lockKey).catch(() => {});
        return duplicate;
      }
    }
  }

  try {
    return await insertOrderRecord(input, pricing, { status: "PENDING" }, {
      changedByAdminId: opts.changedByAdminId,
      statusNote: opts.statusNote,
      idempotencyKey: key,
      metaContext: opts.metaContext,
      markPaidByAdminId: opts.markPaidByAdminId,
      storeCreditCustomerId: opts.storeCreditCustomerId ?? null,
      confirmWhenPaid: opts.initialStatus === "CONFIRMED",
    });
  } catch (err) {
    // Two requests with the same key raced past the lock (Redis down): the unique index let exactly one in.
    if (key && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: key }, include });
      if (existing) return existing;
    }
    throw err;
  } finally {
    // The row is committed (or the attempt failed) — release the lock rather than wait out its TTL.
    if (lockKey) await redis.del(lockKey).catch(() => {});
  }
}

/** The admin "Create order" page's entrypoint — for phone/Facebook orders a staff member types in
 * themselves. Deliberately a thin wrapper around createOrder rather than a parallel implementation:
 * routing through the exact same stock-decrement/pricing/snapshot transaction is what guarantees a
 * manually-entered order can never drift out of sync with real stock or the catalog's current
 * price — there is only one order-creation code path, admin or storefront. A manual order defaults
 * to the same UNPAID-until-collected state as any other COD order unless staff tick "paid"; then the
 * payment ledger records a MANUAL settlement inside the order's own insert transaction (never a
 * separate follow-up write that could half-apply). */
export async function createManualOrder(input: AdminCreateOrderInput, adminId: string, idempotencyKey?: string | null) {
  const order = await createOrder(input, input.customerId ?? null, {
    changedByAdminId: adminId,
    statusNote: "Order manually entered from the admin panel",
    idempotencyKey,
    markPaidByAdminId: input.markPaid ? adminId : undefined,
    // Staff may apply the selected customer's store balance (§16: usable on manual orders); the rest stays due.
    storeCreditCustomerId: input.useStoreCredit && input.customerId ? input.customerId : null,
  });

  return getOrderById(order.id);
}

/** Manual variantId -> Product join shared by getOrderById (admin) and getOrderForCustomer —
 * OrderItem has no Prisma relation to ProductVariant, only a plain id column, so this is the one
 * place that resolves it. `requireAvailable: true` (customer "Reorder") hides the product/thumbnail
 * link the moment it's not currently purchasable; admin never needs that gate — a staff member
 * should be able to open a product from an order regardless of its current stock/active state. */
async function attachLiveItemInfo<T extends { variantId: string }>(
  items: T[],
  opts: { requireAvailable: boolean },
): Promise<(T & { live: OrderItemLiveInfo | null })[]> {
  const variantIds = items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      price: true,
      compareAtPrice: true,
      stock: true,
      isActive: true,
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          basePrice: true,
          compareAtPrice: true,
          trackInventory: true,
          isActive: true,
          deletedAt: true,
          images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));
  // The reorder price is the current server-resolved selling price (flash included) — a display cache for the cart,
  // re-quoted at checkout like any other cart line (PRICING_INVARIANTS §7).
  const byProduct = new Map<string, PriceableProduct>();
  for (const v of variants) {
    const entry = byProduct.get(v.product.id) ?? { id: v.product.id, basePrice: v.product.basePrice, compareAtPrice: v.product.compareAtPrice, variants: [] };
    entry.variants!.push({ id: v.id, price: v.price, compareAtPrice: v.compareAtPrice, isActive: v.isActive });
    byProduct.set(v.product.id, entry);
  }
  const pricing = await priceProductsForDisplay([...byProduct.values()]);

  return items.map((item) => {
    const variant = variantById.get(item.variantId);
    const available =
      variant && variant.isActive && variant.product.isActive && !variant.product.deletedAt && isAvailable(variant.product.trackInventory, variant.stock);
    const usable = opts.requireAvailable ? available : Boolean(variant);
    return {
      ...item,
      live:
        usable && variant
          ? {
              productId: variant.product.id,
              productSlug: variant.product.slug,
              productName: variant.product.name,
              imageUrl: variant.product.images[0]?.url ?? null,
              price: pricing.get(variant.product.id)?.variants[variant.id]?.selling ?? Number(variant.price ?? variant.product.basePrice),
              maxStock: maxSellableQuantity(variant.product.trackInventory, variant.stock),
            }
          : null,
    };
  });
}

export async function getOrderById(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include });
  if (!order) throw AppError.notFound("Order not found");
  const [items, payment] = await Promise.all([attachLiveItemInfo(order.items, { requireAvailable: false }), getOrderPaymentSummary(id)]);
  return { ...order, items, payment };
}

/** The admin order detail's related records — return/exchange requests, the courier-loss ledger, whether this order is an
 * exchange replacement, and the customer's cached delivery score. Read-only, and only for the admin detail view (not every
 * internal getOrderById caller). */
export async function getAdminOrderContext(order: { id: string; customerId: string | null }) {
  const [returnRequests, courierLosses, exchangeSource, deliveryScores] = await Promise.all([
    prisma.returnRequest.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
      include: { exchangeOrder: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } } },
    }),
    prisma.courierLossEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
    prisma.returnRequest.findFirst({ where: { exchangeOrderId: order.id }, select: { id: true, order: { select: { id: true, orderNumber: true } } } }),
    order.customerId ? buildDeliveryScoreByCustomerId([order.customerId]) : Promise.resolve(new Map<string, DeliveryScore>()),
  ]);
  return {
    returnRequests,
    courierLosses,
    exchangeOf: exchangeSource ? { returnRequestId: exchangeSource.id, order: exchangeSource.order } : null,
    deliveryScore: order.customerId ? (deliveryScores.get(order.customerId) ?? null) : null,
  };
}

/** Powers bulk label printing — fetches many orders in one round-trip instead of N single-order
 * GETs. Re-sorts to match the caller's id order and silently drops any id no longer found (e.g. an
 * order permanently deleted between selection and print) rather than failing the whole batch. */
export async function getOrdersByIds(ids: string[]) {
  const [orders, payments] = await Promise.all([prisma.order.findMany({ where: { id: { in: ids } }, include }), summarizeOrderPayments(ids)]);
  // Labels print the courier's COD amount from the payment ledger (`payment.codToCollect`), never `total`.
  const byId = new Map(orders.map((o) => [o.id, { ...o, payment: payments.get(o.id) }]));
  return ids.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o));
}

/** Ownership-checked order detail for a logged-in customer's own order page. Attaches live
 * per-item availability (current price/stock/image) via the same manual variantId -> Product join
 * used elsewhere in this file (OrderItem has no Prisma relation to ProductVariant, only a plain
 * id column) — this is what "Reorder" checks before adding anything back to the cart. */
export async function getOrderForCustomer(customerId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include });
  if (!order || order.deletedAt || order.customerId !== customerId) throw AppError.notFound("Order not found");

  const items = await attachLiveItemInfo(order.items, { requireAvailable: true });

  const returnRequests = await prisma.returnRequest.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    include: { exchangeOrder: { select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } } },
  });

  return { ...order, items, returnRequests };
}

/** Guest order tracking — requires the phone on the order too, so an order number alone (visible in a shared link, browser history, etc.) isn't enough to see someone else's address. */
export async function trackOrder(orderNumber: string, phone: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include });
  if (!order || order.deletedAt || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  return order;
}

// Two minutes is the same window createOrder's duplicate-submit guard uses — long enough that a
// customer who just got redirected to the gateway and immediately bounces back isn't told their own
// in-flight attempt is "in progress" by mistake, short enough that a genuinely abandoned session
// doesn't block a real retry for long.
const ACTIVE_SESSION_RETRY_GRACE_MS = 2 * 60 * 1000;

/** Starts a fresh payment attempt on an existing order — the storefront's "Retry payment" action
 * after a failed/abandoned checkout. Ownership-checked the same way trackOrder is (orderNumber +
 * phone, no account required). Deliberately scoped to still-PENDING orders only: stock is still
 * reserved for those, so nothing else needs to happen before starting a new PaymentSession. A
 * CANCELLED order (stock already restocked) requires a fresh checkout instead — retrying it here
 * would need to re-reserve stock that may already have been sold to someone else. */
export async function retryPayment(orderNumber: string, phone: string, ipAddress?: string) {
  const order = await prisma.order.findUnique({ where: { orderNumber }, include: { items: true } });
  if (!order || order.deletedAt || order.customerPhone !== phone) throw AppError.notFound("Order not found");
  if (order.paymentMethod === "COD") throw AppError.badRequest("This order is Cash on Delivery");
  if (["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CREDITED"].includes(order.paymentStatus)) {
    throw AppError.badRequest("This order is already settled");
  }
  if (order.status !== "PENDING") {
    throw AppError.badRequest("This order can no longer be paid online — please contact support");
  }

  // Closes the gap between checking for an existing ACTIVE session and starting a new one — same
  // best-effort Redis lock pattern as createOrder's duplicate-submit guard, just order-scoped
  // instead of storefront-sessionId-scoped (retry has no client-generated sessionId to key off).
  // The DB-level one-ACTIVE-session-per-order partial unique index is the real backstop either way.
  const lockKey = namespace.lock(`payment-retry:${order.id}`);
  const acquired = await redis.set(lockKey, "1", "PX", 10_000, "NX").catch(() => "OK");
  if (!acquired) throw AppError.conflict("A payment attempt is already in progress for this order");

  try {
    const active = await prisma.paymentSession.findFirst({ where: { orderId: order.id, status: "ACTIVE" } });
    if (active) {
      if (Date.now() - active.createdAt.getTime() < ACTIVE_SESSION_RETRY_GRACE_MS) {
        throw AppError.conflict("A payment attempt is already in progress — please finish or wait a moment before retrying");
      }
      // Stale — no callback ever arrived and it's outlasted the grace window. Expire it explicitly
      // rather than leaving it for the reconciliation cron, so retry isn't blocked waiting on the
      // next sweep.
      await prisma.paymentSession.update({ where: { id: active.id }, data: { status: "EXPIRED" } });
    }
    return await startPaymentSession(order, ipAddress);
  } finally {
    await redis.del(lockKey).catch(() => {});
  }
}

/** Shared by listOrders and exportOrdersCsv so the two never drift on what a given filter set matches. */
function buildOrderWhere(query: OrderListQuery) {
  return {
    // "deleted=true" is the dedicated admin restore view (only soft-deleted orders); otherwise the
    // normal listing never shows them.
    deletedAt: query.deleted === "true" ? { not: null } : null,
    // `statusIn` (a quick-filter preset like "Cancelled/Returned") takes priority over the plain
    // single-value `status` filter when both are somehow present.
    ...(query.statusIn?.length ? { status: { in: query.statusIn } } : query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
    ...(query.courierBooked === "true"
      ? { courierConsignmentId: { not: null } }
      : query.courierBooked === "false"
        ? { courierConsignmentId: null }
        : {}),
    ...(query.courierStatus ? { courierStatus: query.courierStatus } : {}),
    ...(query.shippingDivision ? { shippingDivision: query.shippingDivision } : {}),
    ...(query.shippingDistrict ? { shippingDistrict: query.shippingDistrict } : {}),
    // The confirmation-call callback queue — implies status PENDING regardless of what `status`/
    // `statusIn` above resolved to, since the frontend only ever sends this on its own (same
    // mutually-exclusive pattern as the other quick filters).
    ...(query.followUpDue === "true" ? { status: "PENDING" as const, followUpAt: { lte: new Date() } } : {}),
    // The refund-risk queue — CANCELLED orders still holding customer money (one shared predicate from the payment
    // ledger), surfaced via the "Cancelled but paid" admin alert (updateOrderStatus/getOrderStats).
    ...(query.cancelledButPaid === "true" ? REFUND_QUEUE_WHERE : {}),
    ...(query.refundDue === "true" ? RETURNED_REFUND_DUE_WHERE : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { orderNumber: { contains: query.search, mode: "insensitive" as const } },
            { customerName: { contains: query.search, mode: "insensitive" as const } },
            { customerPhone: { contains: query.search } },
          ],
        }
      : {}),
    // Its own AND arm so this OR can't collide with the search OR above.
    ...(query.courierIssue === "true" ? { AND: [COURIER_ISSUE_WHERE] } : {}),
  };
}

/** A parcel still on its way (booked, not yet delivered or closed) that the courier has put on hold, or whose last status
 * sync failed (a stuck or voided booking shows up here first) — the orders list's "Courier issues" queue. */
const COURIER_ISSUE_WHERE = {
  courierConsignmentId: { not: null },
  status: { in: [...PRE_SHIPMENT_STATUSES, "SHIPPED"] },
  OR: [{ courierStatus: "hold" }, { courierSyncError: { not: null } }],
} satisfies Prisma.OrderWhereInput;

/** Shared by listOrders and exportOrdersCsv — defaults to newest-first when the admin hasn't
 * clicked a sortable column header. */
function buildOrderOrderBy(query: OrderListQuery) {
  return { [query.sortBy ?? "createdAt"]: query.sortDir ?? "desc" };
}

export async function listOrders(query: OrderListQuery) {
  const where = buildOrderWhere(query);
  const orderBy = buildOrderOrderBy(query);

  // The list table only ever shows order-level fields (number, customer, total, status, date) —
  // it never touches the full line items or the status timeline. Those are exactly what the shared
  // `include` pulls in (a join per row for items, plus statusHistory joined to changedByAdmin), so
  // skipping them here is what keeps this endpoint fast as order history grows. `items`/`statusHistory`
  // are filled in as empty arrays purely to satisfy the shared `Order` type — the list page never
  // reads them; it reads `itemsSummary` instead (see below), which is deliberately cheap: bounded by
  // one page of orders, not the whole table.
  const result = await paginate(
    query,
    (p) => prisma.order.findMany({ where, orderBy, ...p }),
    () => prisma.order.count({ where }),
  );

  // Independent per-page lookups — run together rather than one after the other.
  const [itemsSummaryByOrderId, deliveryScoreByCustomerId] = await Promise.all([
    buildItemsSummary(result.items.map((o) => o.id)),
    buildDeliveryScoreByCustomerId(result.items.map((o) => o.customerId).filter((id): id is string => id !== null)),
  ]);

  return {
    ...result,
    items: result.items.map((order) => ({
      ...order,
      items: [],
      statusHistory: [],
      itemsSummary: itemsSummaryByOrderId.get(order.id) ?? { totalItems: 0, firstItem: null },
      deliveryScore: order.customerId ? (deliveryScoreByCustomerId.get(order.customerId) ?? null) : null,
    })),
  };
}

/** Batched lookup backing the admin orders list's delivery-score badge — one Customer query for the
 * whole page rather than a join per row, mirroring buildItemsSummary below. Only ever reads the
 * cached fields written by checkDeliveryScoresBulk (courier.service.ts); this never calls Steadfast
 * itself. */
async function buildDeliveryScoreByCustomerId(customerIds: string[]) {
  const scores = new Map<string, DeliveryScore>();
  const uniqueIds = Array.from(new Set(customerIds));
  if (uniqueIds.length === 0) return scores;

  const customers = await prisma.customer.findMany({
    where: { id: { in: uniqueIds }, deliveryScoreCheckedAt: { not: null } },
    select: {
      id: true,
      deliverySuccessRate: true,
      deliveryTotalParcels: true,
      deliverySuccessParcels: true,
      deliveryCancelledParcels: true,
      deliveryCancellationRate: true,
      deliveryVolumeRange: true,
      deliveryFraudReports: true,
      deliveryScoreCheckedAt: true,
    },
  });

  for (const c of customers) {
    scores.set(c.id, {
      successRate: c.deliverySuccessRate,
      totalParcels: c.deliveryTotalParcels ?? 0,
      successParcels: c.deliverySuccessParcels,
      cancelledParcels: c.deliveryCancelledParcels,
      cancellationRate: c.deliveryCancellationRate,
      volumeRange: c.deliveryVolumeRange,
      fraudReports: c.deliveryFraudReports,
      checkedAt: c.deliveryScoreCheckedAt!.toISOString(),
    });
  }

  return scores;
}

/** Batched "what's in this order" summary for the admin orders list's Product column — one row of
 * line items per order id, plus a single follow-up ProductVariant/Product join for the first item
 * of each order (for its name/thumbnail/link). Bounded by one page of orders (≈20-100), so it stays
 * cheap even though OrderItem has no Prisma relation to ProductVariant to include directly.
 * `totalItems` counts distinct line items (products), not summed quantity — "+2 more" should read
 * as two more products, not two more units of the first one. */
async function buildItemsSummary(orderIds: string[]) {
  const summaries = new Map<string, { totalItems: number; firstItem: OrderListItemSummary["firstItem"] | null }>();
  if (orderIds.length === 0) return summaries;

  const items = await prisma.orderItem.findMany({
    where: { orderId: { in: orderIds } },
    select: {
      orderId: true,
      variantId: true,
      productNameSnapshot: true,
      sizeSnapshot: true,
      colorSnapshot: true,
      quantity: true,
    },
  });

  const firstItemByOrderId = new Map<string, (typeof items)[number]>();
  // Distinct variants, not rows: a cart line split into a flash-priced and a regular-priced row (D4) is one product.
  const variantsByOrder = new Map<string, Set<string>>();
  for (const item of items) {
    const seen = variantsByOrder.get(item.orderId) ?? new Set<string>();
    seen.add(item.variantId);
    variantsByOrder.set(item.orderId, seen);
    summaries.set(item.orderId, { totalItems: seen.size, firstItem: null });
    if (!firstItemByOrderId.has(item.orderId)) firstItemByOrderId.set(item.orderId, item);
  }

  const variantIds = Array.from(new Set(Array.from(firstItemByOrderId.values(), (i) => i.variantId)));
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      product: {
        select: { id: true, slug: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  for (const [orderId, item] of firstItemByOrderId) {
    const variant = variantById.get(item.variantId);
    const existing = summaries.get(orderId)!;
    summaries.set(orderId, {
      ...existing,
      firstItem: {
        name: item.productNameSnapshot,
        size: item.sizeSnapshot,
        color: item.colorSnapshot,
        quantity: item.quantity,
        productId: variant?.product.id ?? null,
        productSlug: variant?.product.slug ?? null,
        imageUrl: variant?.product.images[0]?.url ?? null,
      },
    });
  }

  return summaries;
}

/** Powers the orders-page KPI strip — a handful of parallel count/aggregate queries (no per-row
 * joins) rather than pulling every order into Node to tally, so it stays cheap as order history grows. */
export async function getOrderStats() {
  const now = new Date();
  const attentionCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // "Today" = the store's business day; orders placed = sale orders placed today, revenue = today's realised net sales —
  // the registry's `orders_placed` / `realised_net_sales` (docs/METRICS_REGISTRY.md), the same numbers as the dashboard and BI.
  const [today, pending, needsAttention, followUpDue, cancelledButPaidCount, statusGroups, queueCountList, returnRequestsPending] = await Promise.all([
    computeMetrics({ metrics: ["orders_placed", "realised_net_sales"], range: { preset: "today" } }, now),
    prisma.order.count({ where: { deletedAt: null, status: { in: ["PENDING", "CONFIRMED"] } } }),
    // A fresh PENDING order isn't "stuck" yet — only one sitting unconfirmed for a day, one whose
    // payment gateway callback actually failed, one Steadfast has put "on hold" (couldn't reach the
    // recipient, address issue, etc.), one whose confirmation-call follow-up is due, or one that's
    // CANCELLED with the gateway payment still uncollected-back, is something an admin needs to go
    // look at.
    prisma.order.count({
      where: {
        deletedAt: null,
        OR: [
          { status: "PENDING", createdAt: { lt: attentionCutoff } },
          { paymentStatus: "FAILED" },
          { courierStatus: "hold" },
          { status: "PENDING", followUpAt: { lte: now } },
          REFUND_QUEUE_WHERE,
        ],
      },
    }),
    // Same predicate as the follow-up arm above, exposed as its own number so the KPI strip and the
    // "Follow-up due" quick-filter pill can both show the exact callback-queue count, not just "how
    // many of several different things need attention" folded into one bucket.
    prisma.order.count({ where: { deletedAt: null, status: "PENDING", followUpAt: { lte: now } } }),
    // Same reasoning as followUpDue above — its own number so the "Cancelled but paid" tile/pill can
    // show the exact refund-risk count, not just its share of the combined needsAttention bucket.
    prisma.order.count({ where: { deletedAt: null, ...REFUND_QUEUE_WHERE } }),
    // Powers the status-filter pills' "(N)" counts — one row per status that has at least one
    // order, zero-filled below for the rest so every pill always shows a count.
    prisma.order.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    // One count per quick filter, through the list's own where builder — a queue's badge is exactly what its filter shows.
    Promise.all(ORDER_QUEUE_IDS.map((id) => prisma.order.count({ where: buildOrderWhere(ORDER_QUEUE_FILTERS[id] as OrderListQuery) }))),
    // Customer return/exchange requests still waiting for a decision (the Return Requests tab).
    prisma.returnRequest.count({ where: { status: "PENDING" } }),
  ]);
  const queueCounts = Object.fromEntries(ORDER_QUEUE_IDS.map((id, i) => [id, queueCountList[i]!])) as Record<OrderQueueId, number>;

  const statusCounts = Object.fromEntries(orderStatusEnum.options.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const group of statusGroups) statusCounts[group.status] = group._count;

  return {
    todayOrders: today.metrics.orders_placed!.value,
    todayRevenue: today.metrics.realised_net_sales!.value,
    pending,
    needsAttention,
    followUpDue,
    cancelledButPaidCount,
    statusCounts,
    queueCounts,
    returnRequestsPending,
  };
}

/** Same filters as listOrders (via buildOrderWhere) but unpaginated — admins export a whole filtered
 * range at once (e.g. a month, for courier/accounting handoff), not just the current page. */
export async function exportOrdersCsv(query: OrderListQuery): Promise<string> {
  const where = buildOrderWhere(query);
  const orders = await prisma.order.findMany({ where, orderBy: buildOrderOrderBy(query) });

  const header = [
    "orderNumber",
    "customerName",
    "customerPhone",
    "customerEmail",
    "status",
    "paymentMethod",
    "paymentStatus",
    "subtotal",
    "discount",
    "shippingFee",
    "priceAdjustment",
    "total",
    "shippingDivision",
    "shippingDistrict",
    "shippingArea",
    "shippingAddressLine",
    "trackingNumber",
    "carrier",
    "createdAt",
  ];

  const rows = orders.map((o) => [
    o.orderNumber,
    o.customerName,
    o.customerPhone,
    o.customerEmail ?? "",
    o.status,
    o.paymentMethod,
    o.paymentStatus,
    o.subtotal,
    o.discount,
    o.shippingFee,
    o.priceAdjustment,
    o.total,
    o.shippingDivision,
    o.shippingDistrict,
    o.shippingArea,
    o.shippingAddressLine,
    o.trackingNumber ?? "",
    o.carrier ?? "",
    o.createdAt.toISOString(),
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

/** Steadfast exposes no per-order fee, only a merchant wallet balance (providers/courier/steadfast.ts) — this is
 * an admin-entered estimate of their return-leg fee (StoreSetting.courierReturnFeeDhaka/
 * OutsideDhaka), zone-matched the same way shippingFee is at checkout. Only called from the two
 * places that actually log a CourierLossEvent, not on every order lookup. */
async function getCourierReturnFee(shippingDistrict: string, shippingDivision?: string): Promise<number> {
  const settings = await getSettings();
  // Zone-matched by the same shipping-zone configuration that priced the delivery (no hard-coded geography): the
  // estimate for the seeded "inside Dhaka district" zone, else the outside estimate.
  const zone = resolveZone(await loadShippingZones(await getCurrency()), { district: shippingDistrict, division: shippingDivision });
  return zone?.key === LEGACY_ZONE_KEYS.insideDhaka ? Number(settings.courierReturnFeeDhaka) : Number(settings.courierReturnFeeOutsideDhaka);
}

type OrderWithHistory = Prisma.OrderGetPayload<{ include: typeof include }>;

/** What a committed transition did — handed to runTransitionSideEffects once the transaction is over. */
export interface OrderTransitionOutcome {
  order: OrderWithHistory;
  previousStatus: OrderStatus;
  previousPaymentStatus: PaymentStatus;
  rule: OrderTransitionRule;
  /** False for a same-status call (a no-op apart from an optional note). */
  changed: boolean;
  /** Variants whose stock went from 0 to positive (back-in-stock emails). */
  replenished: string[];
}

/** The order state machine (docs/ORDER_STATE_MACHINE.md) — the ONLY code that changes Order.status after an order
 * exists. Runs inside the caller's transaction: row-locks the order, validates `from → to` against the shared
 * matrix using the *locked* status (so concurrent transitions serialise and the loser sees the winner's result),
 * applies the stock/payment/courier-loss effects the matrix declares, and writes the status + timeline row.
 * Messages and loyalty points are post-commit (runTransitionSideEffects). */
export async function applyOrderTransition(
  tx: Prisma.TransactionClient,
  orderId: string,
  input: UpdateOrderStatusInput,
  /** `quietNoop`: an automated source (courier webhook / sync) — a same-status call leaves no timeline entry, so a
   * duplicate or late provider push never adds noise (Phase 9). */
  actor: { adminId?: string | null; quietNoop?: boolean } = {},
): Promise<OrderTransitionOutcome> {
  const [locked] = await tx.$queryRaw<
    Array<{
      status: OrderStatus;
      paymentStatus: PaymentStatus;
      paymentMethod: string;
      courierConsignmentId: string | null;
      deletedAt: Date | null;
      shippingDistrict: string;
      couponId: string | null;
      couponReleasedAt: Date | null;
    }>
  >`
    SELECT status, "paymentStatus", "paymentMethod", "courierConsignmentId", "deletedAt", "shippingDistrict", "couponId", "couponReleasedAt"
    FROM "Order" WHERE id = ${orderId} FOR UPDATE
  `;
  if (!locked) throw AppError.notFound("Order not found");
  if (locked.deletedAt) throw AppError.badRequest("Restore this order before making changes");

  const from = locked.status;
  const to = input.status;
  const rule = getOrderTransition(from, to);
  if (!rule) throw AppError.badRequest(describeRefusedTransition(from, to));

  const base = { previousStatus: from, previousPaymentStatus: locked.paymentStatus, rule };

  // Same status: nothing happens — no stock, SMS, points or courier loss (so a re-applied bulk action or a
  // double-clicked button is harmless). A note still lands on the timeline so admins can annotate.
  if (from === to) {
    const order = input.note && !actor.quietNoop
      ? await tx.order.update({
          where: { id: orderId },
          data: { statusHistory: { create: { status: to, note: input.note, changedByAdminId: actor.adminId ?? null } } },
          include,
        })
      : await tx.order.findUniqueOrThrow({ where: { id: orderId }, include });
    return { ...base, order, changed: false, replenished: [] };
  }

  if (rule.requiresRecordedRefund && locked.paymentStatus !== "REFUNDED") {
    throw AppError.badRequest("Record the refund first (Payments → Record refund) — an order is marked refunded only once money has actually gone back");
  }

  let replenished: string[] = [];
  if (rule.stock !== "none") {
    const note = rule.stock === "return" ? `Stock restored — order returned` : `Stock released — order cancelled`;
    const result = await releaseOrderLines(tx, orderId, rule.stock, { adminId: actor.adminId, note });
    replenished = result.replenished;
  }

  if (rule.courierLoss && locked.courierConsignmentId) {
    const amount = await getCourierReturnFee(locked.shippingDistrict);
    await tx.courierLossEvent.create({ data: { orderId, amount, reason: "CANCELLED_POST_BOOKING" } });
  }

  // D7: a cancellation before shipping gives the coupon use back — once, recorded on the order (couponReleasedAt), so the
  // redemption predicate and Coupon.usedCount agree. After shipping the use stands.
  const releaseCoupon = rule.releasesCouponUsage && locked.couponId !== null && locked.couponReleasedAt === null;
  if (releaseCoupon) {
    await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${locked.couponId}`;
  }

  // D1: Cash on Delivery money is collected by the courier at the door — delivery is the collection point. The payment
  // ledger records a COD settlement of the balance due and derives the status (docs/PAYMENT_LEDGER.md §6).
  if (rule.codCollected && locked.paymentMethod === "COD") await recordCodCollection(tx, orderId, actor);

  const order = await tx.order.update({
    where: { id: orderId },
    data: {
      status: to,
      ...(releaseCoupon ? { couponReleasedAt: new Date() } : {}),
      // Leaving PENDING means the confirmation call resolved — an outstanding follow-up hold is stale. Moving *to*
      // PENDING leaves it alone; only the explicit hold action sets it.
      followUpAt: to === "PENDING" ? undefined : null,
      statusHistory: { create: { status: to, note: input.note ?? null, changedByAdminId: actor.adminId ?? null } },
    },
    include,
  });

  // D8 loyalty points are business truth: awarded / reversed IN this transaction (Phase 8), never after it.
  if (rule.awardPoints && order.customerId) await awardDeliveryPoints(tx, order.customerId, order.id, loyaltyBase(order, await getCurrency()));
  if (rule.reversesPoints && order.customerId) await reverseDeliveryPoints(tx, order.customerId, order.id, 1);

  // The customer's status SMS: an outbox intent committed with the transition, keyed by the history row just written.
  if (rule.customerSms) {
    const historyId = order.statusHistory.at(-1)!.id;
    await recordOutboxEvents(tx as AppTransactionClient, [
      {
        eventType: "order.status_changed.v1",
        consumer: "customer-order-sms",
        eventKey: `status:${historyId}`,
        aggregateType: "Order",
        aggregateId: orderId,
        payload: { orderId, touchpoint: rule.customerSms as CustomerTouchpoint },
      },
    ]);
  }
  return { ...base, order, changed: true, replenished };
}

/** Best-effort post-commit effects of a transition: admin alerts and back-in-stock emails. The customer SMS and loyalty
 * points are NOT here any more — the SMS is an outbox intent and the points are written inside the transition's
 * transaction (Phase 8), so neither can be lost after the transition commits. */
export async function runTransitionSideEffects(outcome: OrderTransitionOutcome) {
  const { order, rule, changed, previousPaymentStatus } = outcome;
  if (!changed) return;

  // Money-risk alerts: the payment was already collected, and nothing here sends it back.
  if (rule.alertIfPaid && MONEY_HELD_PAYMENT_STATUSES.includes(previousPaymentStatus)) {
    notify({
      type: rule.alertIfPaid,
      title: rule.alertIfPaid === "order.cancelled_but_paid" ? `Cancelled but paid: ${order.orderNumber}` : `Returned — refund may be owed: ${order.orderNumber}`,
      body: `${order.customerName} · ${formatMoney(Number(order.total), await getCurrency())} — refund may be owed`,
      link: `/admin/orders/${order.id}`,
    });
  }

  notifyReplenished(outcome.replenished);
}

/** The one command every status change goes through (admin picker, bulk, courier, returns): its own transaction +
 * post-commit side effects. Throws 400 for a transition the matrix doesn't allow. */
export async function updateOrderStatus(id: string, input: UpdateOrderStatusInput, changedByAdminId?: string, opts: { quietNoop?: boolean } = {}) {
  return (await changeOrderStatus(id, input, changedByAdminId, opts)).order;
}

/** `updateOrderStatus`, also saying whether the locked transition actually changed the status (`false`: a same-status
 * no-op — e.g. a duplicate courier webhook that lost the race), so a caller's own follow-up can run exactly once. */
export async function changeOrderStatus(id: string, input: UpdateOrderStatusInput, changedByAdminId?: string, opts: { quietNoop?: boolean } = {}) {
  const outcome = await prisma.$transaction((tx) => applyOrderTransition(tx, id, input, { adminId: changedByAdminId, quietNoop: opts.quietNoop }));
  await runTransitionSideEffects(outcome);
  const items = await attachLiveItemInfo(outcome.order.items, { requireAvailable: false });
  return { order: { ...outcome.order, items }, changed: outcome.changed };
}

const ORDER_DETAIL_FIELD_LABELS = {
  customerName: "Name",
  customerPhone: "Phone",
  shippingDivision: "Division",
  shippingDistrict: "District",
  shippingArea: "Area",
  shippingAddressLine: "Address",
} satisfies Partial<Record<keyof UpdateOrderDetailsInput, string>>;

/** Builds a single human-readable diff string ("Name: "X" -> "Y"; Phone: ...") for whichever
 * customer/shipping fields this particular updateOrderDetails call actually changed, or null if
 * none of those six fields were part of the request (e.g. a tracking-number- or admin-notes-only
 * save). Who made the change is already captured by OrderStatusHistory.changedByAdmin — no need to
 * repeat it in the text. */
function buildOrderDetailsDiffNote(
  existing: Pick<
    Awaited<ReturnType<typeof getOrderById>>,
    "customerName" | "customerPhone" | "shippingDivision" | "shippingDistrict" | "shippingArea" | "shippingAddressLine"
  >,
  input: UpdateOrderDetailsInput,
): string | null {
  const changes: string[] = [];
  for (const key of Object.keys(ORDER_DETAIL_FIELD_LABELS) as Array<keyof typeof ORDER_DETAIL_FIELD_LABELS>) {
    const nextValue = input[key];
    if (nextValue !== undefined && nextValue !== existing[key]) {
      changes.push(`${ORDER_DETAIL_FIELD_LABELS[key]}: "${existing[key]}" -> "${nextValue}"`);
    }
  }
  return changes.length ? `Order details updated — ${changes.join("; ")}` : null;
}

export async function updateOrderDetails(id: string, input: UpdateOrderDetailsInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");

  const diffNote = buildOrderDetailsDiffNote(existing, input);
  // Steadfast's parcel is booked with a fixed name/phone/address as of booking time — changing
  // these here would silently desync from what the courier actually has on file (there's no
  // Steadfast API to push a correction). Same guard/remedy as adjustOrderPrice.
  if (diffNote && existing.courierConsignmentId) {
    throw AppError.badRequest("Cannot change name/address after a courier has been booked — unlink the booking first");
  }

  return prisma.order.update({
    where: { id },
    data: {
      ...input,
      ...(diffNote
        ? { statusHistory: { create: { status: existing.status, note: diffNote, changedByAdminId: changedByAdminId ?? null } } }
        : {}),
    },
    include,
  });
}


/** Records the outcome of a confirmation call that was neither a clear yes nor a clear no — sets a
 * follow-up time and bumps the lifetime call-attempt counter, but deliberately does NOT touch
 * `status` (stays PENDING); only orders currently PENDING are eligible, so an order that's already
 * CONFIRMED/CANCELLED/etc. can't accidentally be shoved back into the callback queue. */
export async function holdOrderForFollowUp(id: string, input: HoldOrderInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (existing.status !== "PENDING") {
    throw AppError.badRequest("Only pending orders can be put on a follow-up hold");
  }

  // Display only, in the store timezone (Phase 7); followUpAt itself is stored and compared as an absolute UTC instant.
  const followUp = formatDateTime(input.followUpAt, await getTimezone());
  const note = input.note ? `On hold — follow up ${followUp}: ${input.note}` : `On hold — follow up ${followUp}`;

  return prisma.order.update({
    where: { id },
    data: {
      followUpAt: input.followUpAt,
      callAttempts: { increment: 1 },
      statusHistory: { create: { status: existing.status, note, changedByAdminId: changedByAdminId ?? null } },
    },
    include,
  });
}

/** Undoes an accidental/stale hold without touching status or callAttempts — e.g. an admin picked
 * the wrong follow-up time, or the call actually happened right after clicking Hold. No-ops
 * (returns the order unchanged) if there's no hold to clear. */
export async function clearOrderHold(id: string, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (!existing.followUpAt) return existing;

  return prisma.order.update({
    where: { id },
    data: {
      followUpAt: null,
      statusHistory: { create: { status: existing.status, note: "Follow-up hold cleared", changedByAdminId: changedByAdminId ?? null } },
    },
    include,
  });
}



/** Lets an admin nudge the order total up or down during the confirmation call (a negotiated
 * discount, a remote-area surcharge) — replaces whatever priceAdjustment was already set, it isn't
 * additive, so re-saving the same value is a no-op. Blocked once a courier is booked, since
 * Steadfast's COD amount is fixed to `total` at that point (see hasUsableAddress's neighbor in
 * courier.service.ts), and on terminal orders where the sale is already settled. */
export async function adjustOrderPrice(id: string, input: AdjustOrderPriceInput, changedByAdminId?: string) {
  const existing = await getOrderById(id);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (PRICE_ADJUSTMENT_LOCKED_STATUSES.includes(existing.status)) {
    throw AppError.badRequest(`Cannot adjust price on an order that is ${existing.status.toLowerCase()}`);
  }
  if (existing.courierConsignmentId) {
    throw AppError.badRequest("Cannot adjust price after a courier has been booked — unlink the booking first");
  }

  const previousAdjustment = Number(existing.priceAdjustment);
  if (previousAdjustment === input.priceAdjustment) return existing;
  // PL-7 (docs/PAYMENT_LEDGER.md): once money was received, the total it was received against is frozen — a correction
  // after payment is a refund, never a silent change to what "paid" means.
  if (existing.payment.paid > 0) {
    throw new AppError(409, "This order already has a payment recorded — record a refund instead of adjusting its total", { code: "ORDER_ALREADY_PAID" });
  }

  // The one totals formula, fed ONLY by this order's own immutable snapshot (PRICING_INVARIANTS §9) — never the live
  // coupon, flash sale, product price or tax setting. Whether shipping was charged is itself a snapshot
  // (shippingWaived, backfilled from each old order's own arithmetic).
  if (existing.shippingWaived === null) {
    throw AppError.conflict("This order's pricing snapshot is incomplete (shipping waiver unknown) — it can't be adjusted automatically");
  }
  const cur = await getCurrency();
  const m = (v: unknown) => fromMajor(String(v ?? 0), cur);
  const bundle = m(existing.bundleDiscount);
  const totals = computeOrderTotals({
    subtotal: m(existing.subtotal),
    bundleDiscount: bundle,
    // Pre-Phase-2 orders have no couponDiscount snapshot: derive it exactly in minor units (Phase 11, F-20 — never floats).
    couponDiscount: existing.couponDiscount != null ? m(existing.couponDiscount) : clampNonNegative(subtract(m(existing.discount), bundle)),
    shippingCharged: existing.shippingWaived ? m(0) : m(existing.shippingFee),
    taxAdded: existing.taxMode === "EXCLUSIVE" ? m(existing.taxAmount) : m(0),
    priceAdjustment: fromMajor(String(input.priceAdjustment), cur),
  });
  if (totals.negative) throw AppError.badRequest("Total cannot be negative");
  const newTotal = toMajor(totals.total);

  const note =
    `Price adjustment: ${formatMoney(previousAdjustment, cur)} -> ${formatMoney(input.priceAdjustment, cur)} (total ${formatMoney(Number(existing.total), cur)} -> ${formatMoney(newTotal, cur)})` +
    (input.note ? ` — ${input.note}` : "");

  return prisma.$transaction(async (tx) => {
    // Re-checked under the row lock: a payment recorded between the read above and this write must win.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
    const paidRows = await tx.payment.count({ where: { orderId: id, status: "SUCCEEDED", amount: { gt: 0 } } });
    if (paidRows > 0) {
      throw new AppError(409, "This order already has a payment recorded — record a refund instead of adjusting its total", { code: "ORDER_ALREADY_PAID" });
    }
    return tx.order.update({
      where: { id },
      data: {
        priceAdjustment: input.priceAdjustment,
        total: newTotal,
        statusHistory: { create: { status: existing.status, note, changedByAdminId: changedByAdminId ?? null } },
      },
      include,
    });
  });
}

// markOrderPaid, markOrderFailed, isOrderPaid, and setPaymentSessionKey used to live here — they're
// superseded by settlePaymentSession/markPaymentSessionFailed/isPaymentSessionSettled/
// startPaymentSession/initiatePendingPayment in payments/payment.service.ts, which operate on
// PaymentSession (an order can now have more than one payment attempt, or none at all until
// settlement) rather than directly on Order's deprecated paymentSessionKey/paymentTransactionId
// fields. cancelUnstartedOrder (restocked+cancelled an Order whose payment session failed to start)
// used to live here too — no longer reachable now that a digital-payment checkout never creates an
// Order before settlement in the first place (see order.controller.ts's create).

/** Soft-deletes an order (OWNER-only, see order.routes.ts) — hides it from every default query but never
 * physically removes the row, since it's a financial/audit record. A pre-shipment order still holds its stock
 * reservation, so its outstanding units are released (CANCELLATION); an order whose goods already left
 * (shipped/delivered/closed) changes no stock — trashing is record-keeping, not a return. Idempotent per line
 * (inventory.service releaseOrderLines), so an already-cancelled or already-returned order puts nothing back. */
export async function deleteOrder(orderId: string, adminId: string) {
  const { order, replenished } = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus; deletedAt: Date | null }>>`
      SELECT status, "deletedAt" FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `;
    if (!locked) throw AppError.notFound("Order not found");
    if (locked.deletedAt) return { order: await tx.order.findUniqueOrThrow({ where: { id: orderId }, include }), replenished: [] as string[] };

    let released: string[] = [];
    if (PRE_SHIPMENT_STATUSES.includes(locked.status)) {
      const result = await releaseOrderLines(tx, orderId, "release", { adminId, note: "Stock released — order moved to Trash" });
      released = result.replenished;
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { deletedAt: new Date(), deletedByAdminId: adminId }, include });
    return { order: updated, replenished: released };
  });
  notifyReplenished(replenished);
  return order;
}

/** Resolves a PARTIALLY_DELIVERED order (Steadfast reported "partial_delivered" — the customer
 * accepted only some of the parcel) by having an admin declare how many units of each line item
 * actually came back; anything not listed (or listed as 0) is assumed kept by the customer.
 * Restocks exactly those units (capped at what is still outstanding for the line) and logs a
 * PARTIAL_RETURN CourierLossEvent if anything came back — the return leg cost the same courier round
 * trip as a full cancellation. Status deliberately stays PARTIALLY_DELIVERED afterward (never
 * rewritten to DELIVERED): the exact COD amount actually collected on a partial delivery isn't
 * knowable from Steadfast's API, so `total`/delivery-points/the DELIVERED SMS are all intentionally
 * left untouched rather than guessed at — this only fixes the stock-accuracy gap, not the order's
 * financial record. */
export async function reconcilePartialDelivery(orderId: string, input: ReconcilePartialDeliveryInput, adminId: string) {
  const existing = await getOrderById(orderId);
  if (existing.deletedAt) throw AppError.badRequest("Restore this order before making changes");
  if (existing.status !== "PARTIALLY_DELIVERED") {
    throw AppError.badRequest("Only a partially-delivered order can be reconciled");
  }
  if (existing.partialDeliveryReconciledAt) {
    throw AppError.conflict("This order has already been reconciled");
  }

  const itemById = new Map(existing.items.map((item) => [item.id, item]));
  for (const entry of input.items) {
    const item = itemById.get(entry.orderItemId);
    if (!item) throw AppError.badRequest(`Order item ${entry.orderItemId} does not belong to this order`);
    if (entry.returnedQuantity > item.quantity) {
      throw AppError.badRequest(
        `Returned quantity for ${item.productNameSnapshot} cannot exceed the ordered quantity (${item.quantity})`,
      );
    }
  }

  const returnedEntries = input.items.filter((entry) => entry.returnedQuantity > 0);
  const courierLossFee = returnedEntries.length > 0 ? await getCourierReturnFee(existing.shippingDistrict) : null;

  const { order, replenished } = await prisma.$transaction(async (tx) => {
    // Row lock + re-check: two admins reconciling at once must not both restock.
    const [locked] = await tx.$queryRaw<Array<{ partialDeliveryReconciledAt: Date | null }>>`
      SELECT "partialDeliveryReconciledAt" FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `;
    if (locked?.partialDeliveryReconciledAt) throw AppError.conflict("This order has already been reconciled");

    const result = returnedEntries.length
      ? await releaseOrderLines(tx, orderId, "return", {
          adminId,
          note: "Stock restored — partial delivery reconciliation",
          lines: returnedEntries.map((entry) => ({ orderItemId: entry.orderItemId, quantity: entry.returnedQuantity })),
        })
      : { released: [], replenished: [] };

    if (courierLossFee !== null) {
      await tx.courierLossEvent.create({ data: { orderId, amount: courierLossFee, reason: "PARTIAL_RETURN" } });
    }

    const note = returnedEntries.length
      ? `Partial delivery reconciled — ${returnedEntries.length} item(s) returned and restocked`
      : "Partial delivery reconciled — customer kept the full shipment";

    // Gives the returned portion its own visible record in the same Return Requests list an admin
    // already checks for customer-initiated returns, rather than leaving it discoverable only by
    // reading this order's status history. Auto-approved (not PENDING) since the items are already
    // physically back — there's no review decision left to make, just a paper trail of what came
    // back and why. Skipped for the rare pre-findOrCreateGuestCustomer order with no linked
    // Customer, since ReturnRequest.customerId is required.
    if (returnedEntries.length > 0 && existing.customerId) {
      const itemLines = returnedEntries.map((entry) => {
        const item = itemById.get(entry.orderItemId)!;
        return `${item.productNameSnapshot}${formatVariantSuffix(item.sizeSnapshot, item.colorSnapshot)} x${entry.returnedQuantity}`;
      });
      await tx.returnRequest.create({
        data: {
          orderId,
          customerId: existing.customerId,
          type: "RETURN",
          reason: "Courier partial delivery — rejected by customer",
          note: itemLines.join(", "),
          status: "APPROVED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
        },
      });
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        partialDeliveryReconciledAt: new Date(),
        statusHistory: { create: { status: "PARTIALLY_DELIVERED", note, changedByAdminId: adminId } },
      },
      include,
    });
    return { order: updated, replenished: result.replenished };
  });
  notifyReplenished(replenished);
  return order;
}

/** Un-hides a soft-deleted order. A pre-shipment order had its reservation released when it was trashed, so
 * restoring takes those units back (all-or-nothing — 409 if they have been sold since, so the order can never
 * come back active without the stock it needs). Closed or shipped orders changed no stock when trashed, so
 * restoring them is purely a record correction. */
export async function restoreOrder(orderId: string, adminId?: string) {
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus; deletedAt: Date | null }>>`
      SELECT status, "deletedAt" FROM "Order" WHERE id = ${orderId} FOR UPDATE
    `;
    if (!locked) throw AppError.notFound("Order not found");
    if (!locked.deletedAt) return tx.order.findUniqueOrThrow({ where: { id: orderId }, include });

    if (PRE_SHIPMENT_STATUSES.includes(locked.status)) {
      await reReserveOrderLines(tx, orderId, { adminId, note: "Stock re-reserved — order restored from Trash" });
    }
    return tx.order.update({ where: { id: orderId }, data: { deletedAt: null, deletedByAdminId: null }, include });
  });
}

/** Irreversible — only meaningful for an order already in Trash (mirrors permanentlyDeleteCategory).
 * OrderItem/OrderStatusHistory/ReturnRequest all cascade-delete with the order. StockMovement.orderId
 * is a plain historical column with no FK relation to Order (it's an append-only ledger), so it's
 * untouched and simply keeps a now-orphaned reference — by design, an audit ledger is meant to
 * outlive the order it references. */
export async function permanentlyDeleteOrder(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order.deletedAt) throw AppError.badRequest("Move the order to Trash before deleting it permanently");

  await prisma.order.delete({ where: { id: orderId } });
}

/** Bulk status change: every order goes through the same state machine as a single change (its own transaction,
 * validation and side effects), one at a time so a batch touching the same variants doesn't contend. An order the
 * matrix refuses is reported, not fatal to the rest of the batch. */
export async function bulkUpdateOrderStatus(ids: string[], status: OrderStatus, adminId: string): Promise<BulkOrderStatusResult> {
  const result: BulkOrderStatusResult = { updated: [], unchanged: [], failed: [] };
  for (const id of ids) {
    try {
      const outcome = await prisma.$transaction((tx) => applyOrderTransition(tx, id, { status }, { adminId }));
      await runTransitionSideEffects(outcome);
      (outcome.changed ? result.updated : result.unchanged).push(id);
    } catch (err) {
      const orderNumber = (await prisma.order.findUnique({ where: { id }, select: { orderNumber: true } }))?.orderNumber ?? null;
      result.failed.push({ id, orderNumber, reason: err instanceof AppError ? err.message : "Unexpected error" });
      if (!(err instanceof AppError)) captureError(err, { msg: `[orders] bulk status ${id} failed:` });
    }
  }
  return result;
}

export interface BulkOrderOutcome {
  succeeded: string[];
  failed: Array<{ id: string; orderNumber: string | null; reason: string }>;
}

/** Runs one order command per id, one at a time (each is its own transaction), and reports each outcome — a refused
 * order (e.g. restore → 409 stock gone) never hides which others went through. */
async function forEachOrder(ids: string[], label: string, run: (id: string) => Promise<unknown>): Promise<BulkOrderOutcome> {
  const result: BulkOrderOutcome = { succeeded: [], failed: [] };
  for (const id of ids) {
    try {
      await run(id);
      result.succeeded.push(id);
    } catch (err) {
      const orderNumber = (await prisma.order.findUnique({ where: { id }, select: { orderNumber: true } }))?.orderNumber ?? null;
      result.failed.push({ id, orderNumber, reason: err instanceof AppError ? err.message : "Unexpected error" });
      if (!(err instanceof AppError)) captureError(err, { msg: `[orders] bulk ${label} ${id} failed:` });
    }
  }
  return result;
}

export function bulkDeleteOrders(ids: string[], adminId: string) {
  return forEachOrder(ids, "trash", (id) => deleteOrder(id, adminId));
}

export function bulkRestoreOrders(ids: string[], adminId: string) {
  return forEachOrder(ids, "restore", (id) => restoreOrder(id, adminId));
}

export function bulkPermanentlyDeleteOrders(ids: string[]) {
  return forEachOrder(ids, "permanent delete", (id) => permanentlyDeleteOrder(id));
}
