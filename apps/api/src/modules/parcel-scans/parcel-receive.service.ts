import { createHash } from "node:crypto";
import { Prisma, type OrderStatus } from "@prisma/client";
import {
  formatDateTime,
  PARCEL_MONEY_REASON_LABELS,
  type CorrectParcelReceiptInput,
  type ParcelLineView,
  type ParcelReceiptView,
  type ParcelReceiveMode,
  type ParcelScanKind,
  type ParcelScanResult,
  type ParcelState,
  type ParcelView,
  type ReceiveParcelInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { captureError } from "../../lib/observability/error-capture";
import type { AdminIdentity } from "../../domain/auth/authorization";
import { getCurrency, getTimezone } from "../../domain/config/commerce-settings";
import { orderMoneyInTx, recordManualPaymentInTx, settleCourierCollected } from "../../domain/payments/payment-ledger.service";
import { syncOrderShipments, syncOrderShipmentsSafely } from "../../domain/shipments/shipment-sync";
import { updateShipmentCostsInTx } from "../../domain/shipments/shipment.service";
import {
  afterAdjustment,
  notifyReplenished,
  notifyStockMoved,
  reverseStockMovementInTx,
  unreceiveOrderLines,
  writeOffParcelUnits,
} from "../inventory/inventory.service";
import {
  applyOrderTransition,
  getCourierReturnFee,
  inspectReturnedParcelInTx,
  reconcilePartialDeliveryInTx,
  runTransitionSideEffects,
  type OrderTransitionOutcome,
} from "../orders/order.service";

/**
 * Receive and inspect (docs/ORDER_OPERATIONS.md "Receive and inspect"; owner decisions D1–D6, 2026-10-31). A parcel in
 * hand is received in ONE confirmation — no return request first. On the server, in one transaction under the order lock:
 *
 * 1. the outcome, when the courier hasn't reported one: kept nothing → Cancelled (T6, no customer SMS — D3); kept some →
 *    Partly delivered (T5) and reconciled, so what the customer kept stays sold;
 * 2. a partial delivery nobody reconciled yet is reconciled (what they kept), and moves to Returned if they kept nothing;
 * 3. the inspection: good units back into stock, damaged units in and written off, missing / wrong / other units left
 *    waiting (D1, D2) — the order stays under "To inspect" until they are settled;
 * 4. the courier's money (payments.record, D4): order money for what the customer kept, the rest a return charge — never
 *    sales by default; the courier charge on the parcel's shipment record (courier_costs.record);
 * 5. a ParcelReceipt row (the audit record) and a timeline note.
 *
 * Every step is the existing service (state machine, reconciliation, inspection, payment ledger, shipment record) run in
 * this transaction — no second stock or money path. Duplicates: the Idempotency-Key replays the first receipt; `version`
 * refuses a receipt made from a stale view (another operator got there first, the courier changed the status).
 */

type Tx = Prisma.TransactionClient;
type Viewer = Pick<AdminIdentity, "adminId" | "permissions">;

const ORDER_VIEW = {
  id: true,
  orderNumber: true,
  status: true,
  deletedAt: true,
  customerName: true,
  customerPhone: true,
  shippingAddressLine: true,
  shippingArea: true,
  shippingDistrict: true,
  shippingDivision: true,
  paymentMethod: true,
  total: true,
  createdAt: true,
  trackingNumber: true,
  courierConsignmentId: true,
  courierTrackingLink: true,
  courierStatus: true,
  courierBookedAt: true,
  courierCollectedAmount: true,
  partialDeliveryReconciledAt: true,
  handedOverAt: true,
  handedOverBy: { select: { name: true } },
  receivedBackAt: true,
  receivedBackBy: { select: { name: true } },
  returnInspectedAt: true,
  items: {
    select: { id: true, productNameSnapshot: true, skuSnapshot: true, sizeSnapshot: true, colorSnapshot: true, quantity: true, returnedQuantity: true, restockedQuantity: true },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.OrderSelect;
type ViewOrder = Prisma.OrderGetPayload<{ select: typeof ORDER_VIEW }>;

const CUSTOMER_RETURN_STATUSES: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "REFUNDED"];
const PRE_SHIP: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

/** What receiving does for this order now, and how many units of each line may still come back. */
function receivePlan(o: Pick<ViewOrder, "status" | "deletedAt" | "courierConsignmentId" | "partialDeliveryReconciledAt" | "receivedBackAt" | "items">): {
  mode: ParcelReceiveMode;
  awaiting: Map<string, number>;
  message: string;
} {
  const all = (f: (i: ViewOrder["items"][number]) => number) => new Map(o.items.map((i) => [i.id, Math.max(0, f(i))]));
  const none = new Map(o.items.map((i) => [i.id, 0]));
  if (o.deletedAt) return { mode: "NOTHING", awaiting: none, message: "This order is in Trash — restore it before receiving its parcel" };
  if (PRE_SHIP.includes(o.status)) return { mode: "NOTHING", awaiting: none, message: "This parcel hasn't left the shop yet" };
  if (o.status === "SHIPPED") {
    return { mode: "DECIDE_OUTCOME", awaiting: all((i) => i.quantity - i.restockedQuantity), message: "The courier hasn't reported this parcel back — say whether the customer kept anything" };
  }
  if (o.status === "PARTIALLY_DELIVERED" && !o.partialDeliveryReconciledAt) {
    return { mode: "RECONCILE", awaiting: all((i) => i.quantity - i.restockedQuantity), message: "Partly delivered — say what the customer kept, then what came back" };
  }
  const awaiting = o.status === "CANCELLED" ? all((i) => i.quantity - i.restockedQuantity) : all((i) => i.returnedQuantity - i.restockedQuantity);
  const total = [...awaiting.values()].reduce((s, n) => s + n, 0);
  if (total > 0) return { mode: "INSPECT", awaiting, message: `${total} unit${total === 1 ? "" : "s"} waiting to come back` };
  if (o.status === "CANCELLED" && !o.courierConsignmentId) return { mode: "NOTHING", awaiting, message: "Cancelled before it left — its stock is already back" };
  // Booked, but cancelled while still marked as not shipped (a booking from before booking marked orders Shipped): its stock
  // went back at the cancellation, so a parcel that turns up anyway adds nothing — it is not "already received".
  if (o.status === "CANCELLED" && !o.receivedBackAt) {
    return { mode: "NOTHING", awaiting, message: "Cancelled before it was marked shipped — its stock went back then, so this parcel adds nothing. Shelve it; nothing to record" };
  }
  if (o.status === "DELIVERED" || (o.status === "REFUNDED" && o.items.every((i) => i.returnedQuantity === 0))) {
    return { mode: "NOTHING", awaiting, message: "Delivered and no return is recorded — record the customer's return on the order first" };
  }
  return { mode: "NOTHING", awaiting, message: "Everything that was coming back has already been received" };
}

function parcelState(o: ViewOrder): ParcelState {
  if (o.deletedAt) return "IN_TRASH";
  if (o.status === "PENDING") return "NOT_CONFIRMED";
  if (o.status === "CANCELLED") return "CANCELLED";
  if (o.status === "RETURNED") return "RETURNED";
  if (o.status === "PARTIALLY_DELIVERED") return "PARTIALLY_DELIVERED";
  if (o.status === "DELIVERED") return "DELIVERED";
  if (o.status === "REFUNDED") return o.items.some((i) => i.returnedQuantity > 0) ? "RETURNED" : "DELIVERED";
  if (!o.courierConsignmentId) return "NOT_BOOKED";
  return o.handedOverAt ? "ALREADY_DISPATCHED" : "READY_FOR_DISPATCH";
}

/** Changes whenever anything a receipt depends on changes — status, the lines' counters, receipts, courier money. */
function versionOf(o: Pick<ViewOrder, "status" | "deletedAt" | "partialDeliveryReconciledAt" | "items">, receipts: number, money: number) {
  const raw = [o.status, o.deletedAt ? 1 : 0, o.partialDeliveryReconciledAt?.getTime() ?? 0, ...o.items.map((i) => `${i.id}:${i.quantity}:${i.returnedQuantity}:${i.restockedQuantity}`), receipts, money].join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 20);
}

/** Courier money already on the order: the COD the rider collected (order money) and any return charge. */
const COURIER_MONEY_WHERE = (orderId: string): Prisma.PaymentWhereInput => ({
  orderId,
  status: "SUCCEEDED",
  amount: { gt: 0 },
  OR: [{ provider: "COD" }, { purpose: "RETURN_CHARGE" }],
});

const toNum = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

function receiptView(r: Prisma.ParcelReceiptGetPayload<{ include: { admin: { select: { name: true } } } }>): ParcelReceiptView {
  return {
    id: r.id,
    kind: r.kind as ParcelReceiptView["kind"],
    outcome: r.outcome,
    statusBefore: r.statusBefore,
    statusAfter: r.statusAfter,
    createdAt: r.createdAt.toISOString(),
    by: r.admin?.name ?? null,
    code: r.code,
    lines: (Array.isArray(r.lines) ? r.lines : []) as ParcelReceiptView["lines"],
    actualCollected: toNum(r.actualCollected),
    courierCharge: toNum(r.courierCharge),
    reason: r.reason,
    note: r.note,
    correctsReceiptId: r.correctsReceiptId,
  };
}

/** Booked COD: the order total less what was prepaid other than through the courier. */
async function expectedCodOf(db: Tx | typeof prisma, order: Pick<ViewOrder, "id" | "paymentMethod" | "total">) {
  if (order.paymentMethod !== "COD") return 0;
  const prepaid = await db.payment.aggregate({ where: { orderId: order.id, status: "SUCCEEDED", purpose: "ORDER", provider: { not: "COD" } }, _sum: { amount: true } });
  return Math.max(0, Number(order.total) - Number(prepaid._sum.amount ?? 0));
}

/** The scanner's parcel card (GET /api/parcel-scans/parcels/:orderId). Money only for payments.read. */
export async function getParcelView(orderId: string, viewer: Viewer): Promise<ParcelView> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_VIEW });
  if (!o) throw AppError.notFound("Order not found");
  const [receipts, money, scans] = await Promise.all([
    prisma.parcelReceipt.findMany({ where: { orderId }, include: { admin: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.payment.findMany({ where: COURIER_MONEY_WHERE(orderId), orderBy: { settledAt: "asc" }, select: { id: true, amount: true, purpose: true, provider: true, settledAt: true } }),
    prisma.parcelScanEvent.findMany({ where: { orderId, voidedAt: null }, orderBy: { createdAt: "desc" }, take: 20, include: { admin: { select: { name: true } } } }),
  ]);
  const plan = receivePlan(o);
  const outcomeKnown = !["SHIPPED"].includes(o.status) && !(o.status === "PARTIALLY_DELIVERED" && !o.partialDeliveryReconciledAt) && !PRE_SHIP.includes(o.status) && o.status !== "CANCELLED";
  const lines: ParcelLineView[] = o.items.map((i) => ({
    orderItemId: i.id,
    name: i.productNameSnapshot,
    sku: i.skuSnapshot,
    size: i.sizeSnapshot,
    color: i.colorSnapshot,
    ordered: i.quantity,
    delivered: outcomeKnown ? Math.max(0, i.quantity - i.returnedQuantity) : 0,
    returned: o.status === "CANCELLED" ? i.quantity : i.returnedQuantity,
    received: i.restockedQuantity,
    awaiting: plan.awaiting.get(i.id) ?? 0,
  }));
  const canSeeMoney = viewer.permissions.includes("payments.read");
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    state: parcelState(o),
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    address: [o.shippingAddressLine, o.shippingArea, o.shippingDistrict, o.shippingDivision].filter(Boolean).join(", "),
    paymentMethod: o.paymentMethod,
    createdAt: o.createdAt.toISOString(),
    courier: {
      consignmentId: o.courierConsignmentId,
      trackingNumber: o.trackingNumber,
      trackingLink: o.courierTrackingLink,
      courierStatus: o.courierStatus,
      bookedAt: o.courierBookedAt?.toISOString() ?? null,
    },
    handedOver: o.handedOverAt ? { at: o.handedOverAt.toISOString(), by: o.handedOverBy?.name ?? null } : null,
    receivedBack: o.receivedBackAt ? { at: o.receivedBackAt.toISOString(), by: o.receivedBackBy?.name ?? null } : null,
    inspectedAt: o.returnInspectedAt?.toISOString() ?? null,
    lines,
    receive: { mode: plan.mode, awaitingUnits: [...plan.awaiting.values()].reduce((s, n) => s + n, 0), message: plan.message },
    money: canSeeMoney
      ? {
          expectedCod: await expectedCodOf(prisma, o),
          courierReported: toNum(o.courierCollectedAmount),
          recorded: money.map((p) => ({ id: p.id, amount: Number(p.amount), purpose: p.purpose as "ORDER" | "RETURN_CHARGE", provider: p.provider, at: p.settledAt.toISOString() })),
          canRecord: viewer.permissions.includes("payments.record"),
          canRecordCharge: viewer.permissions.includes("courier_costs.record"),
        }
      : null,
    receipts: receipts.map(receiptView),
    scans: scans.map((e) => ({ id: e.id, kind: e.kind as ParcelScanKind, result: e.result as ParcelScanResult, code: e.code, at: e.createdAt.toISOString(), by: e.admin?.name ?? null })),
    version: versionOf(o, receipts.length, money.length),
  };
}

type ReceiptRow = Prisma.ParcelReceiptGetPayload<{ include: { admin: { select: { name: true } } } }>;

/** POST /api/parcel-scans/receive — one confirmed physical receipt (see the header). Returns the receipt and the parcel
 * card after it. A repeat with the same Idempotency-Key returns the first receipt and changes nothing. */
export async function receiveParcel(input: ReceiveParcelInput, viewer: Viewer, idempotencyKey: string) {
  const replay = await prisma.parcelReceipt.findUnique({ where: { idempotencyKey } });
  if (replay) return replayed(replay, input.orderId, viewer);

  const money = input.money;
  if (money && !viewer.permissions.includes("payments.record")) {
    throw new AppError(403, "Recording the courier's money needs the Payments permission — receive the parcel without it", { code: "MONEY_PERMISSION" });
  }
  if (money?.courierCharge !== undefined && money?.courierCharge !== null && !viewer.permissions.includes("courier_costs.record")) {
    throw new AppError(403, "Entering the courier charge needs the Courier costs permission", { code: "CHARGE_PERMISSION" });
  }

  const head = await prisma.order.findUnique({ where: { id: input.orderId }, select: { shippingDistrict: true, shippingDivision: true } });
  if (!head) throw AppError.notFound("Order not found");
  const [currency, timeZone, courierReturnFee] = await Promise.all([getCurrency(), getTimezone(), getCourierReturnFee(head.shippingDistrict, head.shippingDivision)]);

  let outcome: { receiptId: string; transitions: OrderTransitionOutcome[]; replenished: string[]; moved: string[]; recordedMoney: boolean };
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
        const o = await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, select: ORDER_VIEW });
        const [receiptCount, moneyRows] = await Promise.all([
          tx.parcelReceipt.count({ where: { orderId: o.id } }),
          tx.payment.findMany({ where: COURIER_MONEY_WHERE(o.id), select: { id: true, amount: true } }),
        ]);
        if (versionOf(o, receiptCount, moneyRows.length) !== input.version) {
          const last = await tx.parcelReceipt.findFirst({ where: { orderId: o.id }, orderBy: { createdAt: "desc" }, include: { admin: { select: { name: true } } } });
          throw new AppError(
            409,
            last
              ? `${o.orderNumber} was just received${last.admin?.name ? ` by ${last.admin.name}` : ""} (${formatDateTime(last.createdAt, timeZone)}) — check the parcel again`
              : `${o.orderNumber} changed since you opened it — check the parcel again`,
            { code: "PARCEL_CHANGED" },
          );
        }
        const plan = receivePlan(o);
        if (plan.mode === "NOTHING") throw new AppError(409, plan.message, { code: "NOTHING_TO_RECEIVE" });

        // ─── Validate the lines against what may still come back ───
        const byId = new Map(o.items.map((i) => [i.id, i]));
        const lines = input.lines.map((l) => {
          const item = byId.get(l.orderItemId);
          if (!item) throw AppError.badRequest("That item isn't on this order");
          return { ...l, item };
        });
        const decides = plan.mode === "DECIDE_OUTCOME" || plan.mode === "RECONCILE";
        if (plan.mode === "DECIDE_OUTCOME" && !input.outcome) throw AppError.badRequest("Say whether the customer kept anything", { code: "OUTCOME_REQUIRED" });
        const fullReturn = plan.mode === "DECIDE_OUTCOME" && input.outcome === "FULL_RETURN";
        const kept = new Map(o.items.map((i) => [i.id, 0]));
        for (const l of lines) {
          if (l.kept > 0 && (!decides || fullReturn)) throw AppError.badRequest(fullReturn ? "The customer kept nothing — set kept to 0, or choose 'kept some'" : "What the customer kept was already decided for this order", { code: "KEPT_NOT_ALLOWED" });
          if (l.kept > l.item.quantity - l.item.restockedQuantity) throw AppError.badRequest(`${l.item.productNameSnapshot}: the customer can't keep more than was sent`, { code: "MORE_THAN_SENT" });
          kept.set(l.item.id, l.kept);
        }
        const keptTotal = [...kept.values()].reduce((s, n) => s + n, 0);
        if (plan.mode === "DECIDE_OUTCOME" && input.outcome === "PARTIAL" && keptTotal === 0) throw AppError.badRequest("Say which items the customer kept, or choose 'kept nothing'", { code: "KEPT_REQUIRED" });
        const sent = o.items.reduce((s, i) => s + i.quantity - i.restockedQuantity, 0);
        if (decides && keptTotal >= sent) throw AppError.badRequest("Every unit is marked kept — nothing came back in this parcel", { code: "NOTHING_CAME_BACK" });
        let accounted = 0;
        for (const l of lines) {
          const comingBack = decides ? l.item.quantity - l.item.restockedQuantity - (kept.get(l.item.id) ?? 0) : (plan.awaiting.get(l.item.id) ?? 0);
          const found = l.good + l.damaged + l.missing + l.wrong + l.other;
          if (found > comingBack) {
            throw new AppError(400, `${l.item.productNameSnapshot}: only ${comingBack} unit${comingBack === 1 ? "" : "s"} can come back — you entered ${found}`, { code: "MORE_THAN_OUTSTANDING" });
          }
          accounted += found;
        }
        if (accounted === 0) throw AppError.badRequest("Say what came back — good, damaged, missing, wrong or other", { code: "NOTHING_ENTERED" });

        // ─── 1–2. The outcome ───
        const transitions: OrderTransitionOutcome[] = [];
        const statusBefore = o.status;
        if (plan.mode === "DECIDE_OUTCOME") {
          if (fullReturn) {
            transitions.push(
              await applyOrderTransition(tx, o.id, { status: "CANCELLED", note: "Parcel came back — received on the scanner, the customer kept nothing" }, { adminId: viewer.adminId, noCustomerSms: true }),
            );
          } else {
            transitions.push(await applyOrderTransition(tx, o.id, { status: "PARTIALLY_DELIVERED", note: "Partly delivered — received on the scanner" }, { adminId: viewer.adminId }));
          }
        }
        if ((plan.mode === "DECIDE_OUTCOME" && !fullReturn) || plan.mode === "RECONCILE") {
          const rec = await reconcilePartialDeliveryInTx(
            tx,
            o.id,
            { items: o.items.map((i) => ({ orderItemId: i.id, returnedQuantity: Math.max(0, i.quantity - i.restockedQuantity - (kept.get(i.id) ?? 0)) })) },
            viewer.adminId,
            { currency, courierReturnFee },
          );
          if (rec.keptNothing) {
            transitions.push(await applyOrderTransition(tx, o.id, { status: "RETURNED", note: "Partial delivery reconciled on the scanner — the customer kept nothing, order returned" }, { adminId: viewer.adminId }));
          }
        }

        // ─── 3. The inspection ───
        const findings: string[] = [];
        for (const l of lines) {
          const name = `${l.item.productNameSnapshot}${l.item.sizeSnapshot ? ` ${l.item.sizeSnapshot}` : ""}`;
          if (l.missing) findings.push(`${l.missing} × ${name} missing`);
          if (l.wrong) findings.push(`${l.wrong} × ${name}: a different item came back${l.note ? ` (${l.note})` : ""}`);
          if (l.other) findings.push(`${l.other} × ${name}: ${l.note || "other"}`);
          else if (l.note && !l.wrong) findings.push(`${name}: ${l.note}`);
        }
        const inspected = await inspectReturnedParcelInTx(
          tx,
          o.id,
          viewer.adminId,
          {
            lines: lines.map((l) => ({ orderItemId: l.item.id, quantity: l.good + l.damaged, damaged: l.damaged })),
            note: [findings.length ? `waiting: ${findings.join("; ")}` : null, input.note?.trim() || null].filter(Boolean).join(" — ") || "Received on the scanner",
          },
          { allowNothing: true },
        );
        const damagedMovements = new Map<string, string[]>();
        for (const w of inspected.writeOffMovements) if (w.ref) damagedMovements.set(w.ref, [...(damagedMovements.get(w.ref) ?? []), w.id]);

        // ─── 4. Money ───
        const paymentIds: string[] = [];
        const expectedCod = await expectedCodOf(tx, o);
        let recordedMoney = false;
        if (money) {
          if (money.actualCollected !== expectedCod && !money.reason) {
            throw AppError.badRequest(`The amount differs from the expected COD (${expectedCod}) — choose a reason`, { code: "REASON_REQUIRED" });
          }
          if (money.actualCollected > 0) {
            if (moneyRows.length) {
              throw new AppError(409, "Courier money is already recorded on this order — change it on the order's Payments, not here", { code: "MONEY_ALREADY_RECORDED" });
            }
            const after = await tx.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true, items: { select: { quantity: true, returnedQuantity: true } } } });
            const keptSomething = after.status !== "CANCELLED" && after.status !== "RETURNED" && after.items.some((i) => i.returnedQuantity < i.quantity);
            const why = `${PARCEL_MONEY_REASON_LABELS[money.reason ?? "OTHER"]}${money.note ? ` — ${money.note}` : ""} (scanner receipt)`;
            let returnPart = money.actualCollected;
            if (keptSomething) {
              // What the customer kept is paid for first; only the rest is the courier charge they covered.
              const { amountDue } = await orderMoneyInTx(tx, o.id);
              const orderPart = Math.min(money.actualCollected, amountDue);
              returnPart = Math.round((money.actualCollected - orderPart) * 100) / 100;
              if (orderPart > 0) {
                const p = await recordManualPaymentInTx(tx, o.id, { amount: orderPart, kind: "COD_COLLECTED", note: why }, viewer.adminId, `${idempotencyKey}:cod`, currency);
                paymentIds.push(p.id);
              }
            }
            if (returnPart > 0) {
              const p = await recordManualPaymentInTx(tx, o.id, { amount: returnPart, kind: "RETURN_CHARGE", via: "COURIER", note: why }, viewer.adminId, `${idempotencyKey}:rc`, currency);
              paymentIds.push(p.id);
            }
            recordedMoney = true;
          }
          if (money.courierCharge !== undefined && money.courierCharge !== null) {
            await syncOrderShipments(o.id, { db: tx });
            const leg = await tx.shipment.findFirst({ where: { orderId: o.id, trackedByCourier: true }, orderBy: { createdAt: "asc" } });
            if (leg && leg.chargeStatus !== "VERIFIED" && leg.chargeStatus !== "COURIER_CONFIRMED") {
              await updateShipmentCostsInTx(
                tx,
                leg.id,
                { version: leg.version, actualCharge: money.courierCharge, chargeStatus: "ENTERED", chargeSource: "RIDER", note: "Entered when the parcel was received on the scanner" },
                { adminId: viewer.adminId, canVerify: viewer.permissions.includes("courier_costs.verify") },
              );
            }
          }
        }

        // ─── 5. The audit record ───
        const after = await tx.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } });
        const receipt = await tx.parcelReceipt.create({
          data: {
            orderId: o.id,
            adminId: viewer.adminId,
            kind: "RECEIPT",
            code: input.code?.trim() || null,
            idempotencyKey,
            outcome: plan.mode === "DECIDE_OUTCOME" ? (fullReturn ? "FULL_RETURN" : "PARTIAL") : plan.mode === "RECONCILE" ? "PARTIAL" : "RETURN",
            statusBefore,
            statusAfter: after.status,
            lines: lines.map((l) => ({
              orderItemId: l.item.id,
              kept: l.kept,
              good: l.good,
              damaged: l.damaged,
              missing: l.missing,
              wrong: l.wrong,
              other: l.other,
              note: l.note ?? null,
              damagedMovementIds: damagedMovements.get(l.item.id) ?? [],
            })) as unknown as Prisma.InputJsonValue,
            expectedCod: money || expectedCod ? expectedCod : null,
            actualCollected: money ? money.actualCollected : null,
            courierCharge: money?.courierCharge ?? null,
            reason: money?.reason ?? null,
            note: input.note?.trim() || null,
            paymentIds,
          },
        });
        return { receiptId: receipt.id, transitions, replenished: inspected.replenished, moved: inspected.moved, recordedMoney };
      },
      { timeout: 30_000 },
    );
  } catch (err) {
    // The same confirm sent twice at once: the loser answers with the winner's receipt.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.parcelReceipt.findUnique({ where: { idempotencyKey } });
      if (winner) return replayed(winner, input.orderId, viewer);
    }
    throw err;
  }

  for (const t of outcome.transitions) await runTransitionSideEffects(t).catch((err) => captureError(err, { msg: `[scanner] side effects for ${input.orderId}:` }));
  notifyReplenished(outcome.replenished);
  notifyStockMoved(outcome.moved);
  // What Steadfast reported the rider collected becomes the return charge once the customer kept nothing — skipped when
  // money was recorded here or by hand (never counted twice).
  if (!outcome.recordedMoney) await settleCourierCollected(input.orderId).catch((err) => captureError(err, { msg: `[scanner] courier collection for ${input.orderId}:` }));
  await syncOrderShipmentsSafely(input.orderId);
  const receipt = await prisma.parcelReceipt.findUniqueOrThrow({ where: { id: outcome.receiptId }, include: { admin: { select: { name: true } } } });
  return { receipt: receiptView(receipt), parcel: await getParcelView(input.orderId, viewer), replayed: false };
}

async function replayed(r: { id: string; orderId: string }, orderId: string, viewer: Viewer) {
  if (r.orderId !== orderId) throw new AppError(409, "That confirmation was already used for another parcel", { code: "IDEMPOTENCY_MISMATCH" });
  const receipt = (await prisma.parcelReceipt.findUniqueOrThrow({ where: { id: r.id }, include: { admin: { select: { name: true } } } })) as ReceiptRow;
  return { receipt: receiptView(receipt), parcel: await getParcelView(orderId, viewer), replayed: true };
}

/**
 * POST /api/parcel-scans/receipts/:id/correct — a mistaken inspection fixed by compensating entries (owner decision D6),
 * never by editing the receipt or a stock entry:
 * - GOOD → DAMAGED: the units are written off as damaged now;
 * - DAMAGED → GOOD: the "came back damaged" write-offs are reversed (exactly what they booked) and the rest re-written off;
 * - GOOD / DAMAGED → UNRESOLVED: they were never in the parcel — they leave stock again on the order (unreceiveOrderLines)
 *   and are waiting to come back, so the order returns to "To inspect".
 * returns.manage; once the receipt's month is closed in the books, only the owner. A new ParcelReceipt (CORRECTION) row
 * records it; the order timeline says who and why.
 */
export async function correctParcelReceipt(receiptId: string, input: CorrectParcelReceiptInput, viewer: Viewer, idempotencyKey?: string | null) {
  const key = idempotencyKey ? `correction:${idempotencyKey}` : null;
  if (key) {
    const replay = await prisma.parcelReceipt.findUnique({ where: { idempotencyKey: key }, include: { admin: { select: { name: true } } } });
    if (replay) {
      if (replay.correctsReceiptId !== receiptId) throw new AppError(409, "That confirmation was already used for another receipt", { code: "IDEMPOTENCY_MISMATCH" });
      return { receipt: receiptView(replay), parcel: await getParcelView(replay.orderId, viewer) };
    }
  }
  const timeZone = await getTimezone();
  const result = await prisma.$transaction(
    async (tx) => {
      const original = await tx.parcelReceipt.findUnique({ where: { id: receiptId } });
      if (!original || original.kind !== "RECEIPT") throw AppError.notFound("Receipt not found");
      const [locked] = await tx.$queryRaw<Array<{ status: OrderStatus; orderNumber: string }>>`SELECT status, "orderNumber" FROM "Order" WHERE id = ${original.orderId} FOR UPDATE`;
      if (!locked) throw AppError.notFound("Order not found");

      const period = await tx.financialPeriod.findFirst({ where: { startDate: { lte: original.createdAt }, endDate: { gte: original.createdAt } }, select: { status: true } });
      // Closing the books is the owner's (finance.period_close): once the month is closed, so is correcting it.
      if (period && period.status !== "OPEN" && !viewer.permissions.includes("finance.period_close")) {
        throw new AppError(403, "The books for this receipt's month are closed — only the owner can correct it", { code: "PERIOD_CLOSED" });
      }

      // What this receipt (with its earlier corrections) counts as good / damaged per line, and its live damage write-offs.
      const corrections = await tx.parcelReceipt.findMany({ where: { correctsReceiptId: receiptId }, orderBy: { createdAt: "asc" } });
      type Line = { orderItemId: string; good?: number; damaged?: number; damagedMovementIds?: string[]; from?: string; to?: string; quantity?: number; movementIds?: string[] };
      const state = new Map<string, { good: number; damaged: number; damagedMovements: string[] }>();
      for (const l of (original.lines as unknown as Line[]) ?? []) {
        state.set(l.orderItemId, { good: l.good ?? 0, damaged: l.damaged ?? 0, damagedMovements: [...(l.damagedMovementIds ?? [])] });
      }
      for (const c of corrections) {
        for (const l of (c.lines as unknown as Line[]) ?? []) {
          const s = state.get(l.orderItemId);
          if (!s || !l.quantity) continue;
          if (l.from === "GOOD") s.good -= l.quantity;
          if (l.from === "DAMAGED") s.damaged -= l.quantity;
          if (l.to === "GOOD") s.good += l.quantity;
          if (l.to === "DAMAGED") s.damaged += l.quantity;
          s.damagedMovements = [...(l.damagedMovementIds ?? s.damagedMovements)];
        }
      }

      const items = await tx.orderItem.findMany({ where: { orderId: original.orderId }, select: { id: true, variantId: true, unitCostSnapshot: true, productNameSnapshot: true } });
      const itemById = new Map(items.map((i) => [i.id, i]));
      const reverseActor = { type: "ADMIN" as const, adminId: viewer.adminId, label: "scanner correction", permissions: viewer.permissions };
      const reason = input.reason.trim();
      const out: Line[] = [];
      const adjusted: Array<Parameters<typeof afterAdjustment>[0]> = [];
      const movedVariants = new Set<string>();
      let unresolved = 0;

      for (const l of input.lines) {
        const s = state.get(l.orderItemId);
        const item = itemById.get(l.orderItemId);
        if (!s || !item) throw AppError.badRequest("That item wasn't in this receipt");
        const have = l.from === "GOOD" ? s.good : s.damaged;
        if (l.quantity > have) throw new AppError(400, `${item.productNameSnapshot}: this receipt counts only ${have} as ${l.from.toLowerCase()}`, { code: "MORE_THAN_RECEIVED" });

        const movementIds: string[] = [];
        if (l.from === "DAMAGED") {
          // Undo the line's damage write-offs exactly, then write off again what stays damaged.
          for (const id of s.damagedMovements) {
            const r = await reverseStockMovementInTx(tx, id, { reason: `Scanner receipt correction: ${reason}` }, reverseActor);
            adjusted.push(r);
            movementIds.push(r.movement.id);
          }
          s.damaged -= l.quantity;
          const again = await writeOffParcelUnits(
            tx,
            { id: original.orderId, orderNumber: locked.orderNumber },
            [{ variantId: item.variantId, quantity: s.damaged, unitCostMinor: item.unitCostSnapshot, reason: "DAMAGED", ref: item.id }],
            { adminId: viewer.adminId, note: `correction: ${reason}` },
          );
          s.damagedMovements = again.map((w) => w.id);
          movementIds.push(...s.damagedMovements);
          if (l.to === "GOOD") s.good += l.quantity;
        } else {
          s.good -= l.quantity;
          if (l.to === "DAMAGED") {
            const w = await writeOffParcelUnits(
              tx,
              { id: original.orderId, orderNumber: locked.orderNumber },
              [{ variantId: item.variantId, quantity: l.quantity, unitCostMinor: item.unitCostSnapshot, reason: "DAMAGED", ref: item.id }],
              { adminId: viewer.adminId, note: `correction: ${reason}` },
            );
            s.damaged += l.quantity;
            s.damagedMovements = [...s.damagedMovements, ...w.map((x) => x.id)];
            movementIds.push(...w.map((x) => x.id));
          }
        }
        if (l.to === "UNRESOLVED") {
          for (const v of await unreceiveOrderLines(tx, original.orderId, [{ orderItemId: item.id, quantity: l.quantity }], { adminId: viewer.adminId, note: `Never in the parcel — scanner receipt correction: ${reason}` })) movedVariants.add(v);
          unresolved += l.quantity;
        }
        movedVariants.add(item.variantId);
        out.push({ orderItemId: l.orderItemId, from: l.from, to: l.to, quantity: l.quantity, movementIds, damagedMovementIds: s.damagedMovements });
      }

      const summary = input.lines.map((l) => `${l.quantity} ${l.from.toLowerCase()} → ${l.to.toLowerCase()}`).join(", ");
      await tx.order.update({
        where: { id: original.orderId },
        data: {
          ...(unresolved > 0 ? { returnInspectedAt: null } : {}),
          statusHistory: { create: { status: locked.status, note: `Parcel receipt of ${formatDateTime(original.createdAt, timeZone)} corrected — ${summary} (${reason})`, changedByAdminId: viewer.adminId } },
        },
      });
      const correction = await tx.parcelReceipt.create({
        data: {
          orderId: original.orderId,
          adminId: viewer.adminId,
          kind: "CORRECTION",
          idempotencyKey: key ?? `correction:${receiptId}:${Date.now()}:${viewer.adminId}`,
          statusBefore: locked.status,
          statusAfter: locked.status,
          lines: out as unknown as Prisma.InputJsonValue,
          note: reason,
          correctsReceiptId: receiptId,
        },
        include: { admin: { select: { name: true } } },
      });
      return { correction, orderId: original.orderId, adjusted, moved: [...movedVariants] };
    },
    { timeout: 30_000 },
  );
  for (const a of result.adjusted) afterAdjustment(a);
  notifyStockMoved(result.moved);
  return { receipt: receiptView(result.correction), parcel: await getParcelView(result.orderId, viewer) };
}
