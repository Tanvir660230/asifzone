/**
 * Courier cost reconciliation (docs/COURIER_COSTS.md) — the shipment legs of an order, their money record, the exchange
 * view and the report. The ONLY writer of Shipment / ShipmentCostEvent besides shipment-sync.ts and courier-evidence.ts.
 *
 * Integrity:
 *   • every save runs in a transaction on the row lock and states the version it was based on — an older version is
 *     refused (409) unless the save changes nothing (a double click replays harmlessly);
 *   • every changed figure is recorded with its previous and new value, who and why; a verified or courier-confirmed
 *     figure, or a reconciled record, changes only with a reason and the verify permission;
 *   • the derived status and amounts are recomputed by the shared rules on every write — never sent by the client;
 *   • nothing here posts to the ledger or touches the order's payments: a contribution is not revenue or cash received.
 */
import { Prisma, type Shipment } from "@prisma/client";
import {
  businessDate,
  businessDayStartUtc,
  addDays,
  contributionApplies,
  courierCostFigures,
  exchangeCostSummary,
  isChargeConfirmed,
  reconcileBlocker,
  type ShipmentCostUpdateInput,
  type ShipmentCreateInput,
  type ShipmentReportQuery,
  type ShipmentOperationalStatus,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getTimezone } from "../config/commerce-settings";
import { costInputOf, derivedColumns, diff, num, recordShipmentEvent, toMajor, FINISHED_STATUSES } from "./shipment-core";
import { chargeReferences, STEADFAST, syncOrderShipments } from "./shipment-sync";

export interface ShipmentActor {
  adminId: string;
  /** Holds courier_costs.verify. */
  canVerify: boolean;
}

const isFinished = (s: ShipmentOperationalStatus) => (FINISHED_STATUSES as readonly string[]).includes(s);
const coded = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => new AppError(status, message, { code, ...extra });
const sameMoney = (a: number | null | undefined, b: Prisma.Decimal | null) => (a ?? null) === num(b);

// ── read model ────────────────────────────────────────────────────────────────────────────────────────────────────────

const legInclude = {
  order: { select: { id: true, orderNumber: true } },
  parcelOrder: { select: { id: true, orderNumber: true, status: true } },
  returnRequest: { select: { id: true, type: true, status: true } },
} satisfies Prisma.ShipmentInclude;
type LegRow = Prisma.ShipmentGetPayload<{ include: typeof legInclude }>;

async function adminNames(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map<string, string>();
  const admins = await prisma.adminUser.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(admins.map((a) => [a.id, a.name]));
}

function shipmentDto(row: LegRow, names: Map<string, string>) {
  const input = costInputOf(row);
  const f = courierCostFigures(input);
  const who = (id: string | null) => (id ? { id, name: names.get(id) ?? "Former admin" } : null);
  return {
    id: row.id,
    order: row.order,
    parcelOrder: row.parcelOrder,
    returnRequest: row.returnRequest,
    type: row.type,
    courier: row.courier,
    consignmentId: row.consignmentId,
    trackingCode: row.trackingCode,
    courierStatus: row.courierStatus,
    courierSyncedAt: row.courierSyncedAt,
    operationalStatus: row.operationalStatus,
    trackedByCourier: row.trackedByCourier,
    deliveryZone: row.deliveryZone,
    weightKg: num(row.weightKg),
    bookedAt: row.bookedAt,
    completedAt: row.completedAt,
    bookedCodAmount: num(row.bookedCodAmount),
    courierPayoutRef: row.courierPayoutRef,
    courierCollected: num(row.courierCollected),
    standardCharge: num(row.standardCharge),
    standardChargeSource: row.standardChargeSource,
    estimatedCharge: num(row.estimatedCharge),
    quotedCharge: num(row.quotedCharge),
    actualCharge: num(row.actualCharge),
    chargeStatus: row.chargeStatus,
    chargeSource: row.chargeSource,
    chargeReference: row.chargeReference,
    chargeVerifiedBy: who(row.chargeVerifiedByAdminId),
    chargeVerifiedAt: row.chargeVerifiedAt,
    contributionReported: num(row.contributionReported),
    contributionVerified: num(row.contributionVerified),
    contributionStatus: row.contributionStatus,
    contributionSource: row.contributionSource,
    contributionReference: row.contributionReference,
    contributionVerifiedBy: who(row.contributionVerifiedByAdminId),
    contributionVerifiedAt: row.contributionVerifiedAt,
    uncoveredTreatment: row.uncoveredTreatment,
    excessTreatment: row.excessTreatment,
    financialStatus: f.financialStatus,
    figures: {
      contributionApplies: f.contributionApplies,
      confirmedCharge: toMajor(f.confirmedCharge),
      reportedContribution: toMajor(f.reportedContribution),
      verifiedContribution: toMajor(f.verifiedContribution),
      allocatedContribution: toMajor(f.allocatedContribution),
      uncovered: toMajor(f.uncovered),
      excess: toMajor(f.excess),
      provisional: f.provisional,
    },
    reconcileBlocker: reconcileBlocker(input),
    reviewReason: row.reviewReason,
    reconciledAt: row.reconciledAt,
    reconciledBy: who(row.reconciledByAdminId),
    note: row.note,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export type ShipmentDto = ReturnType<typeof shipmentDto>;

async function loadLeg(id: string) {
  const row = await prisma.shipment.findUnique({ where: { id }, include: legInclude });
  if (!row) throw AppError.notFound("Shipment not found");
  const names = await adminNames([row.chargeVerifiedByAdminId, row.contributionVerifiedByAdminId, row.reconciledByAdminId]);
  return shipmentDto(row, names);
}

export async function orderIdOfShipment(id: string) {
  const row = await prisma.shipment.findUnique({ where: { id }, select: { orderId: true } });
  if (!row) throw AppError.notFound("Shipment not found");
  return row.orderId;
}

/** The order an order's legs hang off: the original order for an exchange order, the order itself otherwise. */
async function rootOrderOf(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, exchangeReturnRequests: { select: { orderId: true }, take: 1 } },
  });
  if (!order) throw AppError.notFound("Order not found");
  return order.exchangeReturnRequests[0]?.orderId ?? order.id;
}

/** Every leg of an order (its delivery, returns, exchanges — opened from either the original or an exchange order), each
 * exchange's money summary, and the history. Brings the legs up to date with the orders first. */
export async function listOrderShipments(orderId: string) {
  const rootId = await rootOrderOf(orderId);
  const requests = await prisma.returnRequest.findMany({
    where: { orderId: rootId },
    select: { id: true, type: true, status: true, reason: true, createdAt: true, exchangeOrder: { select: { id: true, orderNumber: true, status: true, courierConsignmentId: true, carrier: true } } },
    orderBy: { createdAt: "asc" },
  });
  const refs = await chargeReferences();
  for (const id of [rootId, ...requests.map((r) => r.exchangeOrder?.id).filter((x): x is string => Boolean(x))]) {
    await syncOrderShipments(id, { refs });
  }

  const rows = await prisma.shipment.findMany({ where: { orderId: rootId }, include: legInclude, orderBy: [{ createdAt: "asc" }] });
  const events = await prisma.shipmentCostEvent.findMany({ where: { shipmentId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } });
  const names = await adminNames([...rows.flatMap((r) => [r.chargeVerifiedByAdminId, r.contributionVerifiedByAdminId, r.reconciledByAdminId]), ...events.map((e) => e.adminId)]);
  const shipments = rows.map((r) => shipmentDto(r, names));

  const exchanges = requests
    .filter((r) => r.type === "EXCHANGE" && r.status === "APPROVED")
    .map((r) => {
      const legs = rows.filter((row) => row.returnRequestId === r.id);
      const s = exchangeCostSummary(legs.map(costInputOf));
      const replacement = legs.find((l) => l.type === "REPLACEMENT");
      const back = legs.find((l) => l.type === "RETURN");
      const completed = replacement?.operationalStatus === "DELIVERED" && (!back || back.operationalStatus === "RETURNED");
      return {
        returnRequestId: r.id,
        reason: r.reason,
        exchangeOrder: r.exchangeOrder ? { id: r.exchangeOrder.id, orderNumber: r.exchangeOrder.orderNumber, status: r.exchangeOrder.status, booked: Boolean(r.exchangeOrder.courierConsignmentId || r.exchangeOrder.carrier) } : null,
        operationalStatus: completed ? ("EXCHANGE_COMPLETED" as const) : ("EXCHANGE_IN_PROGRESS" as const),
        shipmentIds: legs.map((l) => l.id),
        summary: {
          legs: s.legs,
          actualExpense: toMajor(s.actualExpense),
          reportedContribution: toMajor(s.reportedContribution),
          verifiedContribution: toMajor(s.verifiedContribution),
          allocatedContribution: toMajor(s.allocatedContribution),
          uncovered: toMajor(s.uncovered),
          excess: toMajor(s.excess),
          excessAwaitingReview: toMajor(s.excessAwaitingReview),
          excessAppliedWithinExchange: toMajor(s.excessAppliedWithinExchange),
          provisional: s.provisional,
          financialStatus: s.financialStatus,
        },
      };
    });

  return {
    rootOrderId: rootId,
    shipments,
    exchanges,
    returnRequests: requests.map((r) => ({ id: r.id, type: r.type, status: r.status, reason: r.reason, exchangeOrderId: r.exchangeOrder?.id ?? null })),
    events: events.map((e) => ({ id: e.id, shipmentId: e.shipmentId, action: e.action, changes: e.changes, reason: e.reason, note: e.note, source: e.source, reference: e.reference, admin: e.adminId ? { id: e.adminId, name: names.get(e.adminId) ?? "Former admin" } : null, createdAt: e.createdAt })),
  };
}

// ── staff-added legs ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A leg the integration can't see: the parcel coming back for a return / exchange, or a replacement sent without the
 * website's courier booking. Idempotent by key; one RETURN leg per request. */
export async function createShipmentLeg(orderId: string, input: ShipmentCreateInput, actor: ShipmentActor, idempotencyKey?: string | null) {
  if (idempotencyKey) {
    const replay = await prisma.shipment.findUnique({ where: { idempotencyKey } });
    if (replay) return loadLeg(replay.id);
  }
  const rootId = await rootOrderOf(orderId);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: rootId }, select: { id: true, deletedAt: true, shippingDistrict: true, shippingArea: true, shippingDivision: true } });
  if (order.deletedAt) throw AppError.badRequest("Restore this order before recording shipments");

  const request = input.returnRequestId
    ? await prisma.returnRequest.findFirst({ where: { id: input.returnRequestId, orderId: rootId }, select: { id: true, type: true, status: true, exchangeOrderId: true } })
    : null;
  if (input.returnRequestId && !request) throw AppError.badRequest("That return / exchange doesn't belong to this order");
  if (request && request.status !== "APPROVED" && request.status !== "COMPLETED") throw AppError.badRequest("Approve the return / exchange before recording its parcels");

  let parcelOrderId = rootId;
  if (input.type === "REPLACEMENT") {
    if (!request || request.type !== "EXCHANGE" || !request.exchangeOrderId) throw AppError.badRequest("A replacement leg belongs to an approved exchange — pick it");
    parcelOrderId = request.exchangeOrderId;
    const exchangeOrder = await prisma.order.findUnique({ where: { id: parcelOrderId }, select: { courierConsignmentId: true } });
    if (exchangeOrder?.courierConsignmentId) throw coded(409, "SHIPMENT_TRACKED", "The replacement is booked with the courier — its leg is tracked automatically");
  }
  if (input.type === "RETURN" && request) {
    const existing = await prisma.shipment.findFirst({ where: { returnRequestId: request.id, type: "RETURN" }, select: { id: true } });
    if (existing) throw coded(409, "SHIPMENT_EXISTS", "This return already has its return leg — update that one", { shipmentId: existing.id });
  }

  const op: ShipmentOperationalStatus = input.operationalStatus ?? (input.type === "RETURN" ? "RETURN_REQUESTED" : "IN_TRANSIT");
  const ref = (await chargeReferences())({ district: order.shippingDistrict, area: order.shippingArea, division: order.shippingDivision, type: input.type, operationalStatus: op, at: new Date() });
  const base = {
    type: input.type, operationalStatus: op, actualCharge: null, chargeStatus: "MISSING" as const, contributionReported: null, contributionVerified: null,
    contributionStatus: "NOT_RECORDED" as const, uncoveredTreatment: "UNDECIDED" as const, excessTreatment: "UNDECIDED" as const, reconciledAt: null, reviewReason: null,
  };
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.shipment.create({
        data: {
          orderId: rootId, parcelOrderId, returnRequestId: request?.id ?? null, type: input.type, courier: input.courier, consignmentId: input.consignmentId ?? null,
          trackingCode: input.trackingCode ?? null, operationalStatus: op, trackedByCourier: false, completedAt: isFinished(op) ? new Date() : null,
          note: input.note ?? null, idempotencyKey: idempotencyKey ?? null, createdByAdminId: actor.adminId, ...ref, ...derivedColumns(base),
        },
      });
      await recordShipmentEvent(tx, { shipmentId: row.id, action: "CREATED", source: "ADMIN", reference: input.consignmentId ?? input.trackingCode ?? null, note: input.note ?? null, adminId: actor.adminId });
      return row;
    });
    return loadLeg(created.id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      if (idempotencyKey) {
        const replay = await prisma.shipment.findUnique({ where: { idempotencyKey } });
        if (replay) return loadLeg(replay.id);
      }
      throw coded(409, "SHIPMENT_EXISTS", "A leg with this consignment already exists for this order");
    }
    throw err;
  }
}

// ── the money record ──────────────────────────────────────────────────────────────────────────────────────────────────

type Fields = Partial<Pick<Shipment,
  | "actualCharge" | "chargeStatus" | "chargeSource" | "chargeReference" | "chargeVerifiedByAdminId" | "chargeVerifiedAt" | "quotedCharge" | "weightKg"
  | "contributionReported" | "contributionVerified" | "contributionStatus" | "contributionSource" | "contributionReference" | "contributionVerifiedByAdminId"
  | "contributionVerifiedAt" | "uncoveredTreatment" | "excessTreatment" | "operationalStatus" | "completedAt" | "note" | "reconciledAt" | "reconciledByAdminId">>;

const dec = (v: number | null) => (v === null ? null : new Prisma.Decimal(v));
const VERIFY_ONLY = "Only the owner or finance can verify charges and contributions, or decide who bears a difference";

/** Applies one save to the current row — validation, permission and the reason rule. Returns the new field values. */
async function nextFields(tx: Prisma.TransactionClient, cur: Shipment, input: ShipmentCostUpdateInput, actor: ShipmentActor): Promise<{ fields: Fields; needsReason: boolean; needsVerify: boolean }> {
  const fields: Fields = {};
  let needsReason = false;
  let needsVerify = false;
  const now = new Date();

  // Operational status — only for legs the courier doesn't report.
  let op = cur.operationalStatus;
  if (input.operationalStatus !== undefined && input.operationalStatus !== cur.operationalStatus) {
    if (cur.trackedByCourier) throw coded(400, "SHIPMENT_TRACKED", "The courier reports this parcel's status — change the order's status instead");
    op = input.operationalStatus;
    fields.operationalStatus = op;
    fields.completedAt = isFinished(op) ? (cur.completedAt ?? now) : null;
  }

  // Actual charge.
  const curConfirmed = isChargeConfirmed(cur.chargeStatus);
  let actual = input.actualCharge !== undefined ? input.actualCharge : num(cur.actualCharge);
  const amountChanged = input.actualCharge !== undefined && !sameMoney(input.actualCharge, cur.actualCharge);
  let chargeStatus = input.chargeStatus ?? (amountChanged ? (actual === null ? "MISSING" : "ENTERED") : cur.chargeStatus);
  if (chargeStatus === "MISSING") actual = null;
  if (actual === null) chargeStatus = "MISSING";
  if (chargeStatus !== cur.chargeStatus || amountChanged || actual !== num(cur.actualCharge)) {
    if (chargeStatus === "VERIFIED" || curConfirmed) needsVerify = true;
    if (curConfirmed) needsReason = true;
    fields.actualCharge = dec(actual);
    fields.chargeStatus = chargeStatus;
    const verifiedNow = chargeStatus === "VERIFIED" && (cur.chargeStatus !== "VERIFIED" || actual !== num(cur.actualCharge));
    fields.chargeVerifiedByAdminId = verifiedNow ? actor.adminId : chargeStatus === "VERIFIED" ? cur.chargeVerifiedByAdminId : null;
    fields.chargeVerifiedAt = verifiedNow ? now : chargeStatus === "VERIFIED" ? cur.chargeVerifiedAt : null;
  }
  if (input.chargeSource !== undefined) fields.chargeSource = input.chargeSource;
  if (input.chargeReference !== undefined) fields.chargeReference = input.chargeReference;
  if (input.quotedCharge !== undefined) fields.quotedCharge = dec(input.quotedCharge);
  if (input.weightKg !== undefined) fields.weightKg = input.weightKg === null ? null : new Prisma.Decimal(input.weightKg);

  // The customer's contribution to the rider.
  const touchesContribution = [input.contributionReported, input.contributionVerified, input.contributionStatus, input.contributionSource, input.contributionReference].some((v) => v !== undefined);
  if (touchesContribution && !contributionApplies(cur.type, op)) {
    throw coded(400, "CONTRIBUTION_NOT_APPLICABLE", "A normal delivery takes no contribution — the customer paid for shipping in the order. Contributions apply to refused, returned and exchanged parcels.");
  }
  let reported = input.contributionReported !== undefined ? input.contributionReported : num(cur.contributionReported);
  let cStatus = input.contributionStatus ?? (input.contributionReported != null && cur.contributionStatus === "NOT_RECORDED" ? "REPORTED" : cur.contributionStatus);
  let verified = input.contributionVerified !== undefined ? input.contributionVerified : num(cur.contributionVerified);
  if (cStatus === "NOT_RECORDED") {
    reported = input.contributionReported ?? null;
    verified = null;
    if (reported !== null) cStatus = "REPORTED";
  }
  if (cStatus === "REPORTED" || cStatus === "UNVERIFIED") {
    verified = null;
    if (reported === null) throw coded(400, "CONTRIBUTION_AMOUNT", "Enter the amount the customer says they paid the rider (0 if nothing)");
  }
  if (cStatus === "VERIFIED") {
    verified = verified ?? reported;
    if (verified === null) throw coded(400, "CONTRIBUTION_AMOUNT", "Enter the verified amount (0 if the customer paid nothing)");
  }
  const curSettled = cur.contributionStatus === "VERIFIED" || cur.contributionStatus === "UNVERIFIED";
  const contributionChanged = cStatus !== cur.contributionStatus || !sameMoney(reported, cur.contributionReported) || !sameMoney(verified, cur.contributionVerified);
  if (contributionChanged) {
    const settlingNow = cStatus === "VERIFIED" || cStatus === "UNVERIFIED";
    if (settlingNow && (cStatus !== cur.contributionStatus || !sameMoney(verified, cur.contributionVerified))) needsVerify = true;
    if (curSettled && (cStatus !== cur.contributionStatus || !sameMoney(verified, cur.contributionVerified))) {
      needsVerify = true;
      needsReason = true;
    }
    fields.contributionReported = dec(reported);
    fields.contributionVerified = dec(verified);
    fields.contributionStatus = cStatus;
    const verifiedNow = cStatus === "VERIFIED" && (cur.contributionStatus !== "VERIFIED" || !sameMoney(verified, cur.contributionVerified));
    fields.contributionVerifiedByAdminId = verifiedNow ? actor.adminId : cStatus === "VERIFIED" ? cur.contributionVerifiedByAdminId : null;
    fields.contributionVerifiedAt = verifiedNow ? now : cStatus === "VERIFIED" ? cur.contributionVerifiedAt : null;
  }
  if (input.contributionSource !== undefined) fields.contributionSource = input.contributionSource;
  if (input.contributionReference !== undefined) fields.contributionReference = input.contributionReference;

  // Who bears a difference.
  if (input.uncoveredTreatment !== undefined && input.uncoveredTreatment !== cur.uncoveredTreatment) {
    needsVerify = true;
    if (cur.uncoveredTreatment !== "UNDECIDED") needsReason = true;
    fields.uncoveredTreatment = input.uncoveredTreatment;
  }
  if (input.excessTreatment !== undefined && input.excessTreatment !== cur.excessTreatment) {
    needsVerify = true;
    if (cur.excessTreatment !== "UNDECIDED") needsReason = true;
    if (input.excessTreatment === "ALLOCATED_WITHIN_EXCHANGE") {
      const request = cur.returnRequestId ? await tx.returnRequest.findUnique({ where: { id: cur.returnRequestId }, select: { type: true } }) : null;
      if (request?.type !== "EXCHANGE") throw coded(400, "NOT_AN_EXCHANGE", "Only a leg of an exchange can apply its excess to the exchange's other legs");
    }
    fields.excessTreatment = input.excessTreatment;
  }
  if (input.note !== undefined) fields.note = input.note;

  // A reconciled record reopens when a figure changes — with a reason, by someone allowed to verify.
  const material = Object.keys(fields).some((k) => !["note", "chargeSource", "chargeReference", "contributionSource", "contributionReference", "weightKg", "quotedCharge"].includes(k));
  if (cur.reconciledAt && material) {
    needsVerify = true;
    needsReason = true;
    fields.reconciledAt = null;
    fields.reconciledByAdminId = null;
  }
  return { fields, needsReason, needsVerify };
}

async function lockedLeg(tx: Prisma.TransactionClient, id: string) {
  const [row] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Shipment" WHERE id = ${id} FOR UPDATE`;
  if (!row) throw AppError.notFound("Shipment not found");
  return tx.shipment.findUniqueOrThrow({ where: { id } });
}

const stale = (version: number) => coded(409, "SHIPMENT_STALE", "Someone changed this record since you opened it — reload to see the latest before saving", { version });

/** One save of a leg's money record (PATCH /api/shipments/:id/costs). */
export async function updateShipmentCosts(id: string, input: ShipmentCostUpdateInput, actor: ShipmentActor) {
  await prisma.$transaction(async (tx) => {
    const cur = await lockedLeg(tx, id);
    const { fields, needsReason, needsVerify } = await nextFields(tx, cur, input, actor);
    const changes = diff(cur as unknown as Record<string, unknown>, fields as Record<string, unknown>);
    if (!Object.keys(changes).length) return; // nothing new — a replayed save is harmless
    if (input.version !== cur.version) throw stale(cur.version);
    if (needsVerify && !actor.canVerify) throw coded(403, "VERIFY_PERMISSION", VERIFY_ONLY);
    if (needsReason && !input.reason) throw coded(400, "REASON_REQUIRED", "Give a reason — this changes a verified figure or a reconciled record");
    const merged = { ...cur, ...fields };
    await tx.shipment.update({ where: { id }, data: { ...fields, version: { increment: 1 }, ...derivedColumns(merged) } });
    await recordShipmentEvent(tx, {
      shipmentId: id,
      action: fields.reconciledAt === null && cur.reconciledAt ? "REOPENED" : "UPDATED",
      changes,
      reason: input.reason ?? null,
      note: input.note ?? null,
      source: [fields.chargeStatus !== undefined || fields.actualCharge !== undefined ? (input.chargeSource ?? cur.chargeSource) : null, fields.contributionStatus !== undefined ? (input.contributionSource ?? cur.contributionSource) : null].filter(Boolean).join(" · ") || null,
      reference: [input.chargeReference, input.contributionReference].filter(Boolean).join(" · ") || null,
      adminId: actor.adminId,
    });
  });
  return loadLeg(id);
}

/** Closes the record (courier_costs.verify): only when nothing is left to decide (shared reconcileBlocker). */
export async function reconcileShipment(id: string, input: { version: number; note?: string | null }, actor: ShipmentActor) {
  await prisma.$transaction(async (tx) => {
    const cur = await lockedLeg(tx, id);
    if (cur.reconciledAt) return;
    if (input.version !== cur.version) throw stale(cur.version);
    const blocker = reconcileBlocker(costInputOf(cur));
    if (blocker) throw coded(400, "RECONCILE_BLOCKED", blocker);
    const fields = { reconciledAt: new Date(), reconciledByAdminId: actor.adminId };
    await tx.shipment.update({ where: { id }, data: { ...fields, version: { increment: 1 }, ...derivedColumns({ ...cur, ...fields }) } });
    await recordShipmentEvent(tx, { shipmentId: id, action: "RECONCILED", changes: { reconciled: { from: false, to: true } }, note: input.note ?? null, adminId: actor.adminId });
  });
  return loadLeg(id);
}

export async function reopenShipment(id: string, input: { version: number; reason: string }, actor: ShipmentActor) {
  await prisma.$transaction(async (tx) => {
    const cur = await lockedLeg(tx, id);
    if (!cur.reconciledAt) return;
    if (input.version !== cur.version) throw stale(cur.version);
    const fields = { reconciledAt: null, reconciledByAdminId: null };
    await tx.shipment.update({ where: { id }, data: { ...fields, version: { increment: 1 }, ...derivedColumns({ ...cur, ...fields }) } });
    await recordShipmentEvent(tx, { shipmentId: id, action: "REOPENED", changes: { reconciled: { from: true, to: false } }, reason: input.reason, adminId: actor.adminId });
  });
  return loadLeg(id);
}

/** Clears a review flag the system raised, once an admin has looked into it (with what they found). */
export async function clearShipmentReview(id: string, input: { version: number; note: string }, actor: ShipmentActor) {
  await prisma.$transaction(async (tx) => {
    const cur = await lockedLeg(tx, id);
    if (!cur.reviewReason) return;
    if (input.version !== cur.version) throw stale(cur.version);
    await tx.shipment.update({ where: { id }, data: { reviewReason: null, version: { increment: 1 }, ...derivedColumns({ ...cur, reviewReason: null }) } });
    await recordShipmentEvent(tx, { shipmentId: id, action: "REVIEW_CLEARED", changes: { reviewReason: { from: cur.reviewReason, to: null } }, note: input.note, adminId: actor.adminId });
  });
  return loadLeg(id);
}

// ── report ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const RETURN_SIDE: ShipmentOperationalStatus[] = ["RETURNED", "PARTIALLY_DELIVERED"];

async function reportWhere(q: ShipmentReportQuery, withAttention: boolean): Promise<Prisma.ShipmentWhereInput> {
  const and: Prisma.ShipmentWhereInput[] = [];
  if (q.from || q.to) {
    const tz = await getTimezone();
    const range: Prisma.DateTimeFilter = {};
    if (q.from) range.gte = businessDayStartUtc(q.from, tz);
    if (q.to) range.lt = businessDayStartUtc(addDays(q.to, 1), tz);
    and.push({ OR: [{ completedAt: range }, { completedAt: null, createdAt: range }] });
  }
  if (q.courier) and.push({ courier: { equals: q.courier, mode: "insensitive" } });
  if (q.type) and.push({ type: q.type });
  if (q.zone) and.push({ deliveryZone: q.zone });
  if (q.operationalStatus) and.push({ operationalStatus: q.operationalStatus });
  if (q.financialStatus) and.push({ financialStatus: q.financialStatus });
  if (q.search) {
    const s = q.search.trim();
    and.push({ OR: [{ order: { orderNumber: { contains: s, mode: "insensitive" } } }, { parcelOrder: { orderNumber: { contains: s, mode: "insensitive" } } }, { consignmentId: s }, { trackingCode: { contains: s, mode: "insensitive" } }] });
  }
  const contributionLeg: Prisma.ShipmentWhereInput = { OR: [{ type: { not: "OUTBOUND" } }, { operationalStatus: { in: RETURN_SIDE } }] };
  if (withAttention && q.attention) {
    const map: Record<NonNullable<ShipmentReportQuery["attention"]>, Prisma.ShipmentWhereInput> = {
      missing_charge: { chargeStatus: "MISSING", financialStatus: { not: "NOT_DUE" } },
      unverified_charge: { chargeStatus: "ENTERED" },
      awaiting_contribution: { financialStatus: "AWAITING_CONTRIBUTION" },
      excess: { excessAmount: { gt: 0 }, excessTreatment: "UNDECIDED" },
      uncovered_undecided: { uncoveredAmount: { gt: 0 }, uncoveredTreatment: "UNDECIDED", chargeStatus: { in: ["VERIFIED", "COURIER_CONFIRMED"] }, contributionStatus: { in: ["VERIFIED", "UNVERIFIED"] } },
      receivable: { uncoveredTreatment: "RECEIVABLE", uncoveredAmount: { gt: 0 } },
      unreconciled: { AND: [contributionLeg, { financialStatus: { notIn: ["RECONCILED", "NOT_DUE"] } }] },
      needs_review: { financialStatus: "NEEDS_REVIEW" },
    };
    and.push(map[q.attention]);
  }
  return and.length ? { AND: and } : {};
}

/** Courier cost report (GET /api/shipments/report): totals over the filtered legs and a page of them. Confirmed expenses
 * and unconfirmed charges are separate figures; contributions are shown apart from any revenue. */
export async function shipmentReport(q: ShipmentReportQuery) {
  const [base, filtered] = await Promise.all([reportWhere(q, false), reportWhere(q, true)]);
  const all = await prisma.shipment.findMany({
    where: base,
    select: {
      type: true, operationalStatus: true, actualCharge: true, chargeStatus: true, contributionReported: true, contributionVerified: true, contributionStatus: true,
      uncoveredTreatment: true, excessTreatment: true, reconciledAt: true, reviewReason: true, returnRequest: { select: { type: true } },
    },
  });
  const t = {
    confirmedExpense: 0, deliveries: 0, returns: 0, exchanges: 0, unconfirmedCharges: 0, reportedContribution: 0, verifiedContribution: 0,
    uncovered: 0, absorbed: 0, receivable: 0, recovered: 0, undecidedUncovered: 0, excessAwaitingReview: 0, provisionalUncovered: 0,
  };
  const counts = { total: all.length, missingCharge: 0, unverifiedCharge: 0, awaitingContribution: 0, excess: 0, uncoveredUndecided: 0, receivable: 0, unreconciled: 0, needsReview: 0 };
  for (const row of all) {
    const f = courierCostFigures(costInputOf(row));
    const charge = f.confirmedCharge ?? 0;
    t.confirmedExpense += charge;
    const exchange = row.type === "REPLACEMENT" || (row.type === "RETURN" && row.returnRequest?.type === "EXCHANGE");
    if (exchange) t.exchanges += charge;
    else if (row.type === "RETURN" || RETURN_SIDE.includes(row.operationalStatus)) t.returns += charge;
    else t.deliveries += charge;
    if (row.chargeStatus === "ENTERED") {
      t.unconfirmedCharges += Math.round(Number(row.actualCharge ?? 0) * 100);
      counts.unverifiedCharge += 1;
    }
    t.reportedContribution += f.reportedContribution;
    t.verifiedContribution += f.verifiedContribution;
    if (f.provisional) t.provisionalUncovered += f.uncovered ?? 0;
    else {
      t.uncovered += f.uncovered ?? 0;
      t.absorbed += f.absorbed;
      t.receivable += f.receivable;
      t.recovered += f.recovered;
      t.undecidedUncovered += f.undecidedUncovered;
      if (f.undecidedUncovered > 0) counts.uncoveredUndecided += 1;
      if (f.receivable > 0) counts.receivable += 1;
    }
    t.excessAwaitingReview += f.excessAwaitingReview;
    if (f.excessAwaitingReview > 0) counts.excess += 1;
    if (f.financialStatus !== "NOT_DUE" && row.chargeStatus === "MISSING") counts.missingCharge += 1;
    if (f.financialStatus === "AWAITING_CONTRIBUTION") counts.awaitingContribution += 1;
    if (f.financialStatus === "NEEDS_REVIEW") counts.needsReview += 1;
    if (f.contributionApplies && f.financialStatus !== "RECONCILED" && f.financialStatus !== "NOT_DUE") counts.unreconciled += 1;
  }

  const [page, couriers, zones] = await Promise.all([
    Promise.all([
      prisma.shipment.findMany({ where: filtered, include: legInclude, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.shipment.count({ where: filtered }),
    ]),
    prisma.shipment.findMany({ distinct: ["courier"], select: { courier: true }, orderBy: { courier: "asc" } }),
    prisma.shipment.findMany({ where: { deliveryZone: { not: null } }, distinct: ["deliveryZone"], select: { deliveryZone: true }, orderBy: { deliveryZone: "asc" } }),
  ]);
  const [rows, total] = page;
  const names = await adminNames(rows.flatMap((r) => [r.chargeVerifiedByAdminId, r.contributionVerifiedByAdminId, r.reconciledByAdminId]));
  const major = (minor: number) => minor / 100;
  return {
    asOf: businessDate(new Date(), await getTimezone()),
    totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, major(v)])) as Record<keyof typeof t, number>,
    counts,
    items: rows.map((r) => shipmentDto(r, names)),
    total,
    page: q.page,
    pageSize: q.pageSize,
    options: { couriers: couriers.map((c) => c.courier), zones: zones.map((z) => z.deliveryZone!).filter(Boolean) },
    courier: STEADFAST,
  };
}
