/**
 * Order modification (docs/ORDER_ADJUSTMENTS.md §3) — changing an order's items, quantities, variants or delivery address
 * after it was placed, by the customer (PENDING/CONFIRMED) or staff (any pre-shipment status), never once it has shipped.
 *
 *   price      quoteOrderModification: kept units keep the price the order snapshotted; new units are priced today (live
 *              flash sales, quota-checked); the order's coupon is re-checked for its cart conditions and is never worth more
 *              than it was when the order was placed; bundles follow today's rules; shipping comes from today's zones and
 *              the free-delivery rule; tax from the order's own snapshot. The client sends no number at all.
 *   money      from the payment ledger, never from the order total: the new total is compared with what the store holds
 *              for the order (paid − refunded − credited).
 *                - holds more  → applied now; the excess goes to the customer's store balance (Case B)
 *                - holds less, COD / nothing paid yet → applied now; the difference is simply due (courier collects it)
 *                - holds less, online money already received → AWAITING_PAYMENT: nothing changes until the difference is
 *                  paid and verified; the payment's settlement transaction applies the plan (Case A)
 *                - same → applied now, no money moves (Case C)
 *   stock      new units are taken first (guarded — 409 if gone), then removed units go back, all in one transaction: a
 *              failure leaves the order exactly as it was
 *   audit      every change is an OrderModification row: what the order was, what it became, what that did to the money
 */
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import {
  clampNonNegative,
  formatMoney,
  fromMajor,
  orderModificationBlocker,
  subtract,
  toMajor,
  type Money,
  type OrderEditor,
  type OrderModificationInput,
  type OrderModificationLineChange,
  type OrderModificationPreview,
  type OrderStatus,
  type Quote,
  type TaxConfig,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getCurrency } from "../../domain/config/commerce-settings";
import { captureLineSnapshots, lineSnapshotData } from "../../domain/orders/line-snapshots";
import { keptLineKey, quoteOrderModification, type KeptUnits } from "../../domain/pricing/pricing.service";
import { issueStoreCreditFromOrder, lockedPosition, refreshPaymentStatus, requestRefund, summarizeOrderPayments } from "../../domain/payments/payment-ledger.service";
import { notifyReplenished, recordSale, releaseModifiedUnits, stockShortfalls } from "../inventory/inventory.service";
import { closeOpenPaymentRequests } from "../payments/payment-requests";
import { claimFlashUnits, toItemSnapshots, type OrderItemSnapshot } from "./order.service";

type Tx = Prisma.TransactionClient;
type OrderRow = Awaited<ReturnType<typeof loadOrder>>;

export type ModificationActor = { type: "CUSTOMER"; customerId: string } | { type: "ADMIN"; adminId: string };

/** How long a change waiting for its price difference stays payable. */
const AWAITING_PAYMENT_TTL_MS = 48 * 60 * 60 * 1000;

interface PlanTotals {
  subtotal: number;
  discount: number;
  bundleId: string | null;
  bundleDiscount: number;
  couponDiscount: number;
  flashDiscount: number;
  shippingFee: number;
  shippingWaived: boolean;
  shippingZoneKey: string | null;
  taxMode: "INCLUSIVE" | "EXCLUSIVE";
  taxRate: number;
  shippingTaxRate: number;
  taxableAmount: number;
  taxAmount: number;
  shippingTaxAmount: number;
  pricingVersion: number;
  /** Including the order's existing price adjustment. */
  total: number;
}

/** Everything needed to turn the order into its modified self — stored as OrderModification.plan (JSON, major units). */
export interface ModificationPlan {
  baseRevision: number;
  keep: Array<{ orderItemId: string; quantity: number; bundleDiscountAllocated: number; couponDiscountAllocated: number }>;
  remove: string[];
  add: OrderItemSnapshot[];
  release: Array<{ variantId: string; quantity: number }>;
  reserve: Array<{ variantId: string; quantity: number }>;
  untrackedVariantIds: string[];
  totals: PlanTotals;
  couponDropped: boolean;
  address: AddressFields | null;
  shippingWaivedReason: "COUPON" | "FREE_DELIVERY" | "FREE_OVER" | null;
}

interface AddressFields {
  customerName: string;
  customerPhone: string;
  shippingDivision: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
}

interface BuiltModification {
  plan: ModificationPlan;
  preview: OrderModificationPreview;
  before: Prisma.InputJsonValue;
  changed: boolean;
}

function editorOf(actor: ModificationActor): OrderEditor {
  return actor.type;
}

/** Ownership + state. A customer only ever reaches their own order (a stranger's order reads as not found). */
function assertCanModify(order: OrderRow, actor: ModificationActor) {
  if (actor.type === "CUSTOMER" && (order.customerId !== actor.customerId || order.deletedAt)) throw AppError.notFound("Order not found");
  const blocker = orderModificationBlocker(order, editorOf(actor));
  if (blocker) throw new AppError(409, blocker, { code: "ORDER_NOT_EDITABLE" });
  if (order.items.some((i) => i.restockedQuantity > 0 || i.returnedQuantity > 0)) {
    throw new AppError(409, "Part of this order has already been released or returned — it can't be modified", { code: "ORDER_NOT_EDITABLE" });
  }
}

/** The coupon discount the order had when it was placed — the most its coupon may ever be worth after a change (§13). */
async function originalCouponDiscount(db: Tx | typeof prisma, order: OrderRow, currency: string): Promise<Money> {
  const first = await db.orderModification.findFirst({ where: { orderId: order.id }, orderBy: { sequence: "asc" }, select: { before: true } });
  const fromFirst = (first?.before as { totals?: { couponDiscount?: number } } | undefined)?.totals?.couponDiscount;
  if (fromFirst !== undefined) return fromMajor(String(fromFirst), currency);
  if (order.couponDiscount !== null) return fromMajor(order.couponDiscount.toString(), currency);
  return clampNonNegative(subtract(fromMajor(order.discount.toString(), currency), fromMajor(order.bundleDiscount.toString(), currency)));
}

function orderTax(order: OrderRow): TaxConfig | null {
  if (!order.taxMode) return null;
  const rate = Number(order.taxRate ?? 0);
  const shippingRate = Number(order.shippingTaxRate ?? 0);
  return { enabled: rate > 0 || shippingRate > 0, mode: order.taxMode, ratePct: rate, shippingTaxable: shippingRate > 0, shippingRatePct: shippingRate };
}

function snapshotOf(order: OrderRow) {
  return {
    revision: order.revision,
    items: order.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      productName: i.productNameSnapshot,
      size: i.sizeSnapshot,
      color: i.colorSnapshot,
      quantity: i.quantity,
      unitPrice: Number(i.priceSnapshot),
      bundleDiscountAllocated: i.bundleDiscountAllocated === null ? null : Number(i.bundleDiscountAllocated),
      couponDiscountAllocated: i.couponDiscountAllocated === null ? null : Number(i.couponDiscountAllocated),
      freeDelivery: i.freeDeliverySnapshot,
    })),
    totals: {
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      bundleDiscount: Number(order.bundleDiscount),
      couponDiscount: order.couponDiscount === null ? null : Number(order.couponDiscount),
      shippingFee: Number(order.shippingFee),
      shippingWaived: order.shippingWaived,
      priceAdjustment: Number(order.priceAdjustment),
      total: Number(order.total),
      couponId: order.couponId,
      couponReleasedAt: order.couponReleasedAt?.toISOString() ?? null,
    },
    address: addressOf(order),
  };
}

function addressOf(order: Pick<OrderRow, keyof AddressFields>): AddressFields {
  return {
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    shippingDivision: order.shippingDivision,
    shippingDistrict: order.shippingDistrict,
    shippingArea: order.shippingArea,
    shippingAddressLine: order.shippingAddressLine,
  };
}

function shippingCharged(waived: boolean | null, fee: number) {
  return waived ? 0 : fee;
}

/** Builds the priced plan and its customer-facing preview. Reads only (inside the caller's transaction when applying). */
async function buildModification(db: Tx | typeof prisma, order: OrderRow, input: OrderModificationInput, actor: ModificationActor, held: { paid: number; netHeld: number }): Promise<BuiltModification> {
  const currency = await getCurrency();
  const m = (v: unknown) => fromMajor(String(v ?? 0), currency);

  // 1. Desired contents per variant.
  const desired = new Map<string, number>();
  for (const item of input.items) desired.set(item.variantId, (desired.get(item.variantId) ?? 0) + item.quantity);
  for (const [variantId, qty] of desired) if (qty > 20) throw AppError.badRequest(`At most 20 units of one item per order (${variantId})`);

  // 2. Which existing rows keep how many units: the cheapest units are kept first (a reduction never costs the customer a
  //    flash price they had), ties by row id — deterministic.
  const rowsByVariant = new Map<string, OrderRow["items"]>();
  for (const row of order.items) rowsByVariant.set(row.variantId, [...(rowsByVariant.get(row.variantId) ?? []), row]);
  const keep: Array<{ row: OrderRow["items"][number]; quantity: number }> = [];
  const remove: string[] = [];
  const release: Array<{ variantId: string; quantity: number }> = [];
  const addedUnits: Array<{ variantId: string; quantity: number }> = [];
  const allVariants = new Set([...rowsByVariant.keys(), ...desired.keys()]);
  for (const variantId of allVariants) {
    const rows = [...(rowsByVariant.get(variantId) ?? [])].sort((a, b) => Number(a.priceSnapshot) - Number(b.priceSnapshot) || (a.id < b.id ? -1 : 1));
    const current = rows.reduce((n, r) => n + r.quantity, 0);
    let toKeep = Math.min(current, desired.get(variantId) ?? 0);
    for (const row of rows) {
      const k = Math.min(row.quantity, toKeep);
      toKeep -= k;
      if (k > 0) keep.push({ row, quantity: k });
      else remove.push(row.id);
    }
    const released = current - Math.min(current, desired.get(variantId) ?? 0);
    if (released > 0) release.push({ variantId, quantity: released });
    const extra = (desired.get(variantId) ?? 0) - current;
    if (extra > 0) addedUnits.push({ variantId, quantity: extra });
  }

  // 3. Kept units carry their own product/category identity (snapshots; live lookup only for lines from before Phase 6).
  const missing = keep.filter((k) => !k.row.productIdSnapshot || !k.row.categoryIdSnapshot).map((k) => k.row.variantId);
  const live = missing.length
    ? new Map(
        (await db.productVariant.findMany({ where: { id: { in: missing } }, select: { id: true, productId: true, product: { select: { categoryId: true } } } })).map((v) => [
          v.id,
          { productId: v.productId, categoryId: v.product.categoryId },
        ]),
      )
    : new Map<string, { productId: string; categoryId: string }>();
  const kept: KeptUnits[] = keep.map(({ row, quantity }) => ({
    orderItemId: row.id,
    variantId: row.variantId,
    productId: row.productIdSnapshot ?? live.get(row.variantId)?.productId ?? row.variantId,
    categoryId: row.categoryIdSnapshot ?? live.get(row.variantId)?.categoryId ?? "",
    productName: row.productNameSnapshot,
    sku: row.skuSnapshot,
    size: row.sizeSnapshot,
    color: row.colorSnapshot,
    quantity,
    unitPrice: m(row.priceSnapshot),
    listUnitPrice: m(row.listPriceSnapshot ?? row.priceSnapshot),
    freeDelivery: row.freeDeliverySnapshot === true,
  }));

  // 4. Price it.
  const address = input.shipping
    ? { ...addressOf(order), ...Object.fromEntries(Object.entries(input.shipping).filter(([, v]) => v !== undefined)) } as AddressFields
    : addressOf(order);
  const addressChanged = JSON.stringify(address) !== JSON.stringify(addressOf(order));
  const couponActive = order.couponId !== null && order.couponReleasedAt === null;
  const priced = await quoteOrderModification(
    {
      kept,
      added: addedUnits,
      coupon: couponActive ? { couponId: order.couponId!, cap: await originalCouponDiscount(db, order, currency) } : null,
      address: { district: address.shippingDistrict, division: address.shippingDivision },
      tax: orderTax(order),
    },
    db,
  );
  const { quote } = priced;
  for (const w of quote.warnings) {
    if (w.code === "UNKNOWN_ITEM" || w.code === "UNAVAILABLE") throw AppError.badRequest(w.message);
    if (w.code === "INSUFFICIENT_STOCK") {
      const row = priced.rows.get(w.variantId);
      throw new AppError(409, `Not enough stock for ${row?.product.name ?? "an item"}${row ? ` (${[row.size, row.color].filter(Boolean).join(" / ")})` : ""}`, {
        code: "INSUFFICIENT_STOCK",
        variantId: w.variantId,
      });
    }
  }
  if (!quote.shipping.resolved) throw AppError.badRequest(quote.shipping.reason === "NO_ZONE" ? "We can't deliver to this address yet" : "A delivery address is required");
  const couponDropped = couponActive && !quote.coupon;

  // 5. Lines back to rows: kept rows take their new allocation; new units become snapshots (split at a flash limit).
  const keptLines = new Map(quote.lines.filter((l) => l.variantId.startsWith("kept:")).map((l) => [l.variantId, l]));
  const addedQuote: Quote = { ...quote, lines: quote.lines.filter((l) => !l.variantId.startsWith("kept:")) };
  const add = toItemSnapshots(addedQuote);
  const untracked = [...priced.rows.values()].filter((r) => !r.product.trackInventory).map((r) => r.id);

  const shipping = quote.shipping;
  const totalWithAdjustment = toMajor(quote.total) + Number(order.priceAdjustment);
  if (totalWithAdjustment < 0) throw AppError.badRequest("This change would make the order total negative");
  const totals: PlanTotals = {
    subtotal: toMajor(quote.subtotal),
    discount: toMajor(quote.discount),
    bundleId: quote.bundle?.bundleId ?? null,
    bundleDiscount: toMajor(quote.bundleDiscount),
    couponDiscount: toMajor(quote.couponDiscount),
    flashDiscount: toMajor(quote.flashDiscount),
    shippingFee: toMajor(shipping.fee),
    shippingWaived: shipping.waived,
    shippingZoneKey: shipping.zoneKey,
    taxMode: quote.tax.mode,
    taxRate: quote.tax.ratePct,
    shippingTaxRate: quote.tax.shipping.ratePct,
    taxableAmount: toMajor(quote.tax.taxableAmount),
    taxAmount: toMajor(quote.tax.taxAmount),
    shippingTaxAmount: toMajor(quote.tax.shipping.taxAmount),
    pricingVersion: quote.pricingVersion,
    total: Math.round(totalWithAdjustment * 100) / 100,
  };
  const plan: ModificationPlan = {
    baseRevision: order.revision,
    keep: keep.map(({ row, quantity }) => {
      const line = keptLines.get(keptLineKey(row.id));
      return {
        orderItemId: row.id,
        quantity,
        bundleDiscountAllocated: line ? toMajor(line.bundleDiscount) : 0,
        couponDiscountAllocated: line ? toMajor(line.couponDiscount) : 0,
      };
    }),
    remove,
    add,
    release,
    reserve: addedUnits,
    untrackedVariantIds: untracked,
    totals,
    couponDropped,
    address: addressChanged ? address : null,
    shippingWaivedReason: shipping.waivedReason,
  };

  // 6. What it means for the customer.
  const changes = (variantId: string, prev: number, next: number): OrderModificationLineChange => {
    const existing = rowsByVariant.get(variantId)?.[0];
    const line = addedQuote.lines.find((l) => l.variantId === variantId);
    return {
      variantId,
      productName: existing?.productNameSnapshot ?? line?.productName ?? "",
      size: existing?.sizeSnapshot ?? line?.size ?? "",
      color: existing?.colorSnapshot ?? line?.color ?? "",
      previousQuantity: prev,
      newQuantity: next,
      unitPrice: line?.segments[0] ? toMajor(line.segments[0].unitPrice) : null,
    };
  };
  const added: OrderModificationLineChange[] = [];
  const removed: OrderModificationLineChange[] = [];
  const changed: OrderModificationLineChange[] = [];
  for (const variantId of allVariants) {
    const prev = (rowsByVariant.get(variantId) ?? []).reduce((n, r) => n + r.quantity, 0);
    const next = desired.get(variantId) ?? 0;
    if (prev === next) continue;
    (prev === 0 ? added : next === 0 ? removed : changed).push(changes(variantId, prev, next));
  }
  const itemsChanged = added.length + removed.length + changed.length > 0;
  const previous = {
    subtotal: Number(order.subtotal),
    discount: Number(order.discount),
    shippingFee: Number(order.shippingFee),
    shippingCharged: shippingCharged(order.shippingWaived, Number(order.shippingFee)),
    total: Number(order.total),
  };
  const next = {
    subtotal: totals.subtotal,
    discount: totals.discount,
    shippingFee: totals.shippingFee,
    shippingCharged: shippingCharged(totals.shippingWaived, totals.shippingFee),
    total: totals.total,
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  const amountToPay = round(Math.max(0, next.total - held.netHeld));
  const amountCredited = round(Math.max(0, held.netHeld - next.total));
  const awaiting =
    amountToPay > 0 &&
    held.paid > 0 &&
    order.paymentMethod !== "COD" &&
    !(actor.type === "ADMIN" && input.collectDifferenceLater === true);
  const warnings: string[] = [];
  if (couponDropped) warnings.push("Your coupon no longer applies to the changed order and has been removed.");
  else if (couponActive && totals.couponDiscount < toMajor(await originalCouponDiscount(db, order, currency)) && itemsChanged) {
    warnings.push("Your coupon discount was recalculated for the changed items.");
  }
  if (awaiting) warnings.push(`The change takes effect once the difference of ${formatMoney(amountToPay, currency)} is paid.`);
  if (amountToPay > 0 && order.paymentMethod === "COD") warnings.push(`${formatMoney(amountToPay, currency)} is collected on delivery.`);

  const preview: OrderModificationPreview = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    currency,
    added,
    removed,
    changed,
    addressChanged,
    previous,
    next,
    difference: {
      merchandise: round(next.subtotal - previous.subtotal),
      discount: round(next.discount - previous.discount),
      shipping: round(next.shippingCharged - previous.shippingCharged),
      total: round(next.total - previous.total),
    },
    coupon: { code: null, kept: couponActive && !couponDropped, note: couponDropped ? "Removed — the changed order no longer meets its conditions" : null },
    shippingWaivedReason: shipping.waivedReason,
    paid: round(held.netHeld),
    amountToPay,
    amountCredited,
    outcome: awaiting ? "AWAITING_PAYMENT" : "APPLY",
    warnings,
    previewToken: "",
  };
  if (couponActive) preview.coupon.code = (await db.coupon.findUnique({ where: { id: order.couponId! }, select: { code: true } }))?.code ?? null;
  preview.previewToken = crypto
    .createHash("sha256")
    .update(JSON.stringify([order.id, order.revision, plan.keep, plan.remove, plan.add.map((a) => [a.variantId, a.quantity, a.priceSnapshot, a.flashSaleItemId]), totals, plan.address, amountToPay, amountCredited, preview.outcome]))
    .digest("hex")
    .slice(0, 40);
  return { plan, preview, before: snapshotOf(order) as unknown as Prisma.InputJsonValue, changed: itemsChanged || addressChanged };
}

async function heldFor(orderId: string) {
  const s = (await summarizeOrderPayments([orderId])).get(orderId);
  return { paid: s?.paid ?? 0, netHeld: s?.netPaid ?? 0 };
}

async function loadOrder(db: Tx | typeof prisma, orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } } } });
  if (!order) throw AppError.notFound("Order not found");
  return order;
}

/** What the change would do — nothing is written. The preview's token is what `apply` must confirm. */
export async function previewOrderModification(orderId: string, input: OrderModificationInput, actor: ModificationActor): Promise<OrderModificationPreview> {
  const order = await loadOrder(prisma, orderId);
  assertCanModify(order, actor);
  const built = await buildModification(prisma, order, input, actor, await heldFor(orderId));
  if (!built.changed) throw AppError.badRequest("Nothing to change — the order already looks like this");
  return built.preview;
}

/** Writes a priced plan onto the order (stock, lines, totals, coupon usage, address, revision), closes stale payment
 * requests and settles the money difference. The caller holds the order row lock and owns the transaction. */
export async function applyPlan(
  tx: Tx,
  order: OrderRow,
  plan: ModificationPlan,
  ctx: { modificationId: string; sequence: number; adminId?: string | null; note: string; keepSessionId?: string },
): Promise<string[]> {
  const currency = await getCurrency();
  const actor = { adminId: ctx.adminId ?? null, note: `Order modified (#${ctx.sequence})` };
  // Stock: secure the new units first (guarded — throws 409 and rolls everything back), then put removed units back.
  if (plan.reserve.length) {
    try {
      await recordSale(tx, order.id, plan.reserve, { ...actor, untrackedVariantIds: new Set(plan.untrackedVariantIds) });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) {
        throw new AppError(409, "An item you added has just sold out — please review your changes", { code: "INSUFFICIENT_STOCK" });
      }
      throw err;
    }
  }
  const replenished = await releaseModifiedUnits(tx, order.id, plan.release, actor);

  // Lines: removed rows go (the modification's `before` keeps them), kept rows take their new quantity/allocation, new rows
  // are written with the same historical snapshots order creation writes.
  if (plan.remove.length) await tx.orderItem.deleteMany({ where: { id: { in: plan.remove }, orderId: order.id } });
  for (const k of plan.keep) {
    await tx.orderItem.update({
      where: { id: k.orderItemId },
      data: { quantity: k.quantity, bundleDiscountAllocated: k.bundleDiscountAllocated, couponDiscountAllocated: k.couponDiscountAllocated },
    });
  }
  if (plan.add.length) {
    const snapshots = await captureLineSnapshots(tx, plan.add.map((a) => a.variantId), currency);
    await tx.orderItem.createMany({
      data: plan.add.map((s) => ({
        orderId: order.id,
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
        ...lineSnapshotData(snapshots, s.variantId),
      })),
    });
    // D4: flash-priced new units re-checked under the flash item lock, with this order's new lines counted.
    await claimFlashUnits(tx, plan.add);
  }

  // D7: a coupon the changed order no longer qualifies for gives its use back, once; it is not restored later.
  const releaseCoupon = plan.couponDropped && order.couponId !== null && order.couponReleasedAt === null;
  if (releaseCoupon) await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${order.couponId}`;

  const t = plan.totals;
  await tx.order.update({
    where: { id: order.id },
    data: {
      subtotal: t.subtotal,
      discount: t.discount,
      bundleId: t.bundleId,
      bundleDiscount: t.bundleDiscount,
      couponDiscount: t.couponDiscount,
      flashDiscount: t.flashDiscount,
      shippingFee: t.shippingFee,
      shippingWaived: t.shippingWaived,
      shippingZoneKey: t.shippingZoneKey,
      taxMode: t.taxMode,
      taxRate: t.taxRate,
      shippingTaxRate: t.shippingTaxRate,
      taxableAmount: t.taxableAmount,
      taxAmount: t.taxAmount,
      shippingTaxAmount: t.shippingTaxAmount,
      pricingVersion: t.pricingVersion,
      total: t.total,
      ...(releaseCoupon ? { couponReleasedAt: new Date() } : {}),
      ...(plan.address ?? {}),
      revision: { increment: 1 },
      statusHistory: { create: { status: order.status, note: ctx.note, changedByAdminId: ctx.adminId ?? null } },
    },
  });

  // Every open way of paying the old amount is closed (a link/session is tied to the amount it showed).
  await closeOpenPaymentRequests(tx, order.id, "Order changed", { exceptSessionId: ctx.keepSessionId, adminId: ctx.adminId });

  // Money: the store now holds more than the new total → the excess goes to the customer's balance (or, for an order with
  // no customer account, a refund owed). Less → it is simply due (COD collects it; online uses a link / the settlement).
  const { position } = await lockedPosition(tx, order.id);
  if (position.overpaid.amount > 0) {
    if (order.customerId) {
      await issueStoreCreditFromOrder(tx, {
        orderId: order.id,
        type: "ORDER_MODIFICATION",
        amount: position.refundDue,
        reason: `Order ${order.orderNumber} changed — total lowered`,
        sourceType: "ORDER_MODIFICATION",
        sourceId: ctx.modificationId,
        idempotencyKey: `credit:modification:${ctx.modificationId}`,
        adminId: ctx.adminId,
      });
    } else if (position.refundDue.amount > 0) {
      await requestRefund(tx, order.id, { amount: toMajor(position.refundDue), reason: `Order changed (#${ctx.sequence}) — total lowered` }, ctx.adminId ?? null);
    }
  }
  await refreshPaymentStatus(tx, order.id, currency);
  return replenished;
}

function describe(preview: OrderModificationPreview): string {
  const parts: string[] = [];
  const line = (c: OrderModificationLineChange) => `${c.productName}${c.size || c.color ? ` (${[c.size, c.color].filter(Boolean).join(" / ")})` : ""}`;
  for (const c of preview.added) parts.push(`+${c.newQuantity} ${line(c)}`);
  for (const c of preview.removed) parts.push(`removed ${line(c)}`);
  for (const c of preview.changed) parts.push(`${line(c)} ${c.previousQuantity}→${c.newQuantity}`);
  if (preview.addressChanged) parts.push("delivery details changed");
  const money = (n: number) => formatMoney(n, preview.currency);
  return `${parts.join("; ")} · total ${money(preview.previous.total)} → ${money(preview.next.total)}`;
}

export interface ModificationResult {
  modification: { id: string; sequence: number; status: string; amountDue: number; amountCredited: number };
  preview: OrderModificationPreview;
}

/**
 * Applies a modification atomically — or, for an order holding online money whose total goes up, records it as
 * AWAITING_PAYMENT (the order is untouched until the difference is paid). `previewToken`, when sent, must still match:
 * otherwise 409 MODIFICATION_CHANGED with the fresh preview. Idempotent per Idempotency-Key.
 */
export async function applyOrderModification(orderId: string, input: OrderModificationInput, actor: ModificationActor, idempotencyKey?: string | null): Promise<ModificationResult> {
  if (idempotencyKey) {
    const existing = await prisma.orderModification.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.orderId !== orderId) throw AppError.conflict("This Idempotency-Key was already used for a different order");
      return replay(existing);
    }
  }
  const currency = await getCurrency();
  let replenished: string[] = [];
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const { position } = await lockedPosition(tx, orderId);
        const order = await loadOrder(tx, orderId);
        assertCanModify(order, actor);
        const held = { paid: toMajor(position.paid), netHeld: toMajor(position.netPaid) };
        const built = await buildModification(tx, order, input, actor, held);
        if (!built.changed) throw AppError.badRequest("Nothing to change — the order already looks like this");
        if (input.previewToken && input.previewToken !== built.preview.previewToken) {
          throw new AppError(409, "The order or its prices changed since you reviewed this change — please review it again", { code: "MODIFICATION_CHANGED", preview: built.preview });
        }
        const sequence = (await tx.orderModification.count({ where: { orderId } })) + 1;
        const awaiting = built.preview.outcome === "AWAITING_PAYMENT";
        const base = {
          orderId,
          sequence,
          initiatedBy: actor.type,
          customerId: actor.type === "CUSTOMER" ? actor.customerId : order.customerId,
          adminId: actor.type === "ADMIN" ? actor.adminId : null,
          reason: input.reason ?? null,
          baseRevision: order.revision,
          before: built.before,
          // The confirmed preview travels with the plan, so an idempotent replay answers with the same summary.
          plan: { ...built.plan, preview: built.preview } as unknown as Prisma.InputJsonValue,
          previousTotal: Number(order.total),
          newTotal: built.plan.totals.total,
          idempotencyKey: idempotencyKey ?? null,
        };
        const adminId = actor.type === "ADMIN" ? actor.adminId : null;
        if (awaiting) {
          // One change waits at a time: a newer request replaces an older one (its links are closed).
          const older = await tx.orderModification.findMany({ where: { orderId, status: "AWAITING_PAYMENT" }, select: { id: true } });
          if (older.length) {
            await tx.orderModification.updateMany({ where: { id: { in: older.map((o) => o.id) } }, data: { status: "SUPERSEDED", statusReason: "Replaced by a newer change" } });
            await tx.paymentLink.updateMany({
              where: { orderModificationId: { in: older.map((o) => o.id) }, status: "ACTIVE" },
              data: { status: "CANCELLED", statusReason: "Replaced by a newer change", cancelledAt: new Date() },
            });
          }
          const mod = await tx.orderModification.create({
            data: { ...base, status: "AWAITING_PAYMENT", amountDue: built.preview.amountToPay, expiresAt: new Date(Date.now() + AWAITING_PAYMENT_TTL_MS) },
          });
          await tx.orderStatusHistory.create({
            data: {
              orderId,
              status: order.status,
              changedByAdminId: adminId,
              note: `Change #${sequence} requested — waits for payment of ${formatMoney(built.preview.amountToPay, currency)}: ${describe(built.preview)}`,
            },
          });
          return { mod, preview: built.preview };
        }
        const mod = await tx.orderModification.create({
          data: { ...base, status: "APPLIED", appliedAt: new Date(), amountCredited: built.preview.amountCredited, amountDue: built.preview.amountToPay },
        });
        replenished = await applyPlan(tx, order, built.plan, {
          modificationId: mod.id,
          sequence,
          adminId,
          note: `Order modified (#${sequence}${actor.type === "CUSTOMER" ? ", by the customer" : ""}): ${describe(built.preview)}`,
        });
        return { mod, preview: built.preview };
      },
      { timeout: 20_000 },
    );
    notifyReplenished(replenished);
    return {
      modification: { id: result.mod.id, sequence: result.mod.sequence, status: result.mod.status, amountDue: Number(result.mod.amountDue), amountCredited: Number(result.mod.amountCredited) },
      preview: result.preview,
    };
  } catch (err) {
    if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.orderModification.findUnique({ where: { idempotencyKey } });
      if (winner) return replay(winner);
    }
    throw err;
  }
}

function replay(mod: { id: string; sequence: number; status: string; amountDue: Prisma.Decimal; amountCredited: Prisma.Decimal; plan: Prisma.JsonValue }): ModificationResult {
  return {
    modification: { id: mod.id, sequence: mod.sequence, status: mod.status, amountDue: Number(mod.amountDue), amountCredited: Number(mod.amountCredited) },
    preview: (mod.plan as unknown as { preview: OrderModificationPreview }).preview,
  };
}

/**
 * The settlement side of Case A: a verified gateway payment for a modification's difference, inside the payment's own
 * transaction (payment.service settleExistingOrder). Applies the plan when it is still valid — the order hasn't moved on,
 * it can still be edited, and every new unit is in stock right now (checked under row locks BEFORE anything is written, so
 * nothing is oversold). Otherwise the modification is marked CANCELLED and the payment — already taken — is left to surface
 * as money owed back, which the caller moves to the customer's store balance.
 */
export async function applyPaidModification(tx: Tx, modificationId: string, paymentSessionId: string): Promise<{ applied: boolean; reason?: string; replenished: string[] }> {
  const mod = await tx.orderModification.findUnique({ where: { id: modificationId } });
  if (!mod) return { applied: false, reason: "Modification not found", replenished: [] };
  const { order: locked } = await lockedPosition(tx, mod.orderId);
  const order = await loadOrder(tx, mod.orderId);
  const plan = mod.plan as unknown as ModificationPlan;
  const fail = async (reason: string) => {
    await tx.orderModification.updateMany({ where: { id: mod.id, status: { in: ["AWAITING_PAYMENT", "EXPIRED"] } }, data: { status: "CANCELLED", statusReason: reason } });
    return { applied: false, reason, replenished: [] as string[] };
  };
  if (mod.status !== "AWAITING_PAYMENT" && mod.status !== "EXPIRED") return fail(`The change was already ${mod.status.toLowerCase()}`);
  if (order.revision !== mod.baseRevision) return fail("The order changed after this change was priced");
  const blocker = orderModificationBlocker({ ...order, status: locked.status as OrderStatus }, "ADMIN");
  if (blocker) return fail(blocker);
  const short = await stockShortfalls(tx, plan.reserve, new Set(plan.untrackedVariantIds));
  if (short.length) return fail("An added item sold out before the payment completed");
  await tx.orderModification.update({ where: { id: mod.id }, data: { status: "APPLIED", appliedAt: new Date(), statusReason: null } });
  const replenished = await applyPlan(tx, order, plan, {
    modificationId: mod.id,
    sequence: mod.sequence,
    adminId: mod.adminId,
    note: `Order modified (#${mod.sequence}) — difference paid online`,
    keepSessionId: paymentSessionId,
  });
  return { applied: true, replenished };
}

/** Cancels a change that is still waiting for payment (customer cancel, admin, or a superseding change). */
export async function cancelAwaitingModifications(tx: Tx, orderId: string, reason: string) {
  const mods = await tx.orderModification.findMany({ where: { orderId, status: "AWAITING_PAYMENT" }, select: { id: true } });
  if (!mods.length) return;
  await tx.orderModification.updateMany({ where: { id: { in: mods.map((m) => m.id) } }, data: { status: "CANCELLED", statusReason: reason } });
}

/** Cron: a change nobody paid for within its window stops being payable (a late payment still settles — and is credited). */
export async function expireStaleModifications(now = new Date()): Promise<number> {
  const stale = await prisma.orderModification.findMany({ where: { status: "AWAITING_PAYMENT", expiresAt: { lt: now } }, select: { id: true } });
  if (!stale.length) return 0;
  const ids = stale.map((s) => s.id);
  const res = await prisma.orderModification.updateMany({ where: { id: { in: ids }, status: "AWAITING_PAYMENT" }, data: { status: "EXPIRED", statusReason: "Not paid in time" } });
  await prisma.paymentLink.updateMany({ where: { orderModificationId: { in: ids }, status: "ACTIVE" }, data: { status: "EXPIRED", statusReason: "The change expired" } });
  return res.count;
}

/** An order's modification history (admin / customer order pages). */
export async function listOrderModifications(orderId: string) {
  const rows = await prisma.orderModification.findMany({
    where: { orderId },
    orderBy: { sequence: "desc" },
    include: { admin: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    status: r.status,
    initiatedBy: r.initiatedBy,
    by: r.admin?.name ?? (r.initiatedBy === "CUSTOMER" ? "Customer" : null),
    reason: r.reason,
    statusReason: r.statusReason,
    previousTotal: Number(r.previousTotal),
    newTotal: Number(r.newTotal),
    amountDue: Number(r.amountDue),
    amountCredited: Number(r.amountCredited),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    appliedAt: r.appliedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

