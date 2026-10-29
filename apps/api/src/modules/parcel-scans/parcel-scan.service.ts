import { Prisma } from "@prisma/client";
import {
  formatDateTime,
  scanCodeCandidates,
  normalizeScanCode,
  type OrderStatus,
  type ParcelScanBatchView,
  type ParcelScanKind,
  type ParcelScanResult,
  type RecordScanInput,
} from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { getTimezone } from "../../domain/config/commerce-settings";
import { recordOutboxEvents } from "../../domain/outbox/outbox";
import { RETURN_EXPECTED_STATUSES } from "../orders/parcel-queues";

/**
 * Dispatch and return scanning (Order Operations plan, phase 4). A scan resolves a code to an order and says at once
 * whether it can be added; nothing about the order changes until the batch is confirmed, which then writes the handover
 * (DISPATCH) or the physical receipt (RETURN) on every accepted order in one transaction. Never stock, money or the
 * order's status: a return scan only says the parcel is physically back — inspection (receiveReturnedParcel, returns.manage)
 * is the step that restocks. The one exception allowed by the plan: with shippedSmsTrigger = HANDOVER, the "shipped" SMS
 * held at booking goes out at the handover confirmation.
 *
 * Exactly-once: a scan's clientScanId (made on the device) is unique, so a retried / offline-queued scan returns the
 * first result; accepting a scan locks the order row, so the same parcel scanned on two devices at once is accepted once.
 */

type Tx = Prisma.TransactionClient;

const DISPATCH_CLOSED: OrderStatus[] = ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED", "PARTIALLY_DELIVERED"];

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  customerName: true,
  status: true,
  deletedAt: true,
  courierConsignmentId: true,
  handedOverAt: true,
  handedOverBy: { select: { name: true } },
  receivedBackAt: true,
  receivedBackBy: { select: { name: true } },
  items: { select: { returnedQuantity: true, restockedQuantity: true, quantity: true } },
} satisfies Prisma.OrderSelect;
type ScanOrder = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

/** The order a code names: our label barcode (trackingNumber), the consignment id, or our order number — exact. */
export async function resolveScanCode(raw: string, db: Tx | typeof prisma = prisma): Promise<ScanOrder | null> {
  for (const c of scanCodeCandidates(raw)) {
    const order = await db.order.findFirst({
      where: { OR: [{ trackingNumber: c }, { courierConsignmentId: c }, { orderNumber: c.toUpperCase() }, { orderNumber: c }] },
      select: ORDER_SELECT,
      orderBy: { createdAt: "desc" },
    });
    if (order) return order;
  }
  return null;
}

/** Whether a resolved order may join a batch of this kind, and the message for the operator. */
function judge(kind: ParcelScanKind, order: ScanOrder, timeZone: string): { result: ParcelScanResult; message: string; discrepancy?: boolean } {
  if (order.deletedAt) return { result: "INELIGIBLE", message: `${order.orderNumber} is in Trash` };
  if (!order.courierConsignmentId) return { result: "INELIGIBLE", message: `${order.orderNumber} isn't booked with a courier` };
  if (kind === "DISPATCH") {
    if (order.handedOverAt) {
      return { result: "ALREADY_PROCESSED", message: `${order.orderNumber} was handed over${order.handedOverBy ? ` by ${order.handedOverBy.name}` : ""} ${formatDateTime(order.handedOverAt, timeZone)}` };
    }
    if (DISPATCH_CLOSED.includes(order.status)) return { result: "INELIGIBLE", message: `${order.orderNumber} is ${order.status.toLowerCase()} — don't send it` };
    if (order.status === "PENDING") return { result: "INELIGIBLE", message: `${order.orderNumber} isn't confirmed yet` };
    return { result: "ACCEPTED", message: `${order.orderNumber} · ${order.customerName}` };
  }
  if (order.receivedBackAt) {
    return { result: "ALREADY_PROCESSED", message: `${order.orderNumber} was received back${order.receivedBackBy ? ` by ${order.receivedBackBy.name}` : ""} ${formatDateTime(order.receivedBackAt, timeZone)}` };
  }
  const expected = RETURN_EXPECTED_STATUSES.includes(order.status) || order.items.some((i) => i.returnedQuantity > i.restockedQuantity);
  if (!expected) {
    // Physically here although nothing says it should be (the courier hasn't reported the return yet): accepted, flagged.
    return { result: "ACCEPTED", discrepancy: true, message: `${order.orderNumber} · ${order.customerName} — not reported as returned yet; check it` };
  }
  return { result: "ACCEPTED", message: `${order.orderNumber} · ${order.customerName}` };
}

export async function createBatch(adminId: string, kind: ParcelScanKind, note?: string) {
  const batch = await prisma.parcelScanBatch.create({ data: { kind, createdByAdminId: adminId, note: note || null } });
  return getBatch(batch.id);
}

/** This operator's open batch of that kind (the scanning page resumes it after a refresh), or null. */
export async function currentBatch(adminId: string, kind: ParcelScanKind) {
  const open = await prisma.parcelScanBatch.findFirst({ where: { kind, status: "OPEN", createdByAdminId: adminId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return open ? getBatch(open.id) : null;
}

export async function recordScan(batchId: string, adminId: string, input: RecordScanInput) {
  const timeZone = await getTimezone();
  const code = normalizeScanCode(input.code);

  // A retried scan (same device id) is answered with its first result — never a second row.
  const replay = await prisma.parcelScanEvent.findUnique({ where: { clientScanId: input.clientScanId } });
  if (replay) {
    if (replay.batchId !== batchId) throw AppError.badRequest("That scan belongs to another batch");
    return toEventRow(replay.id);
  }

  try {
    const eventId = await prisma.$transaction(async (tx) => {
      const [batch] = await tx.$queryRaw<Array<{ kind: string; status: string }>>`SELECT kind, status FROM "ParcelScanBatch" WHERE id = ${batchId} FOR UPDATE`;
      if (!batch) throw AppError.notFound("Batch not found");
      if (batch.status !== "OPEN") throw new AppError(409, "This batch is closed — start a new one", { code: "BATCH_CLOSED" });
      const kind = batch.kind as ParcelScanKind;

      const found = await resolveScanCode(code, tx);
      const write = (data: { orderId?: string | null; result: ParcelScanResult; message: string; discrepancy?: boolean }) =>
        tx.parcelScanEvent.create({ data: { batchId, kind, clientScanId: input.clientScanId, code, adminId, orderId: data.orderId ?? null, result: data.result, message: data.message, discrepancy: data.discrepancy ?? false } });

      if (!found) return (await write({ result: "INVALID", message: `${code} isn't one of our parcel codes — nothing was changed` })).id;

      // Serialise per order: the same parcel scanned on two devices at once is accepted exactly once.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.id} FOR UPDATE`;
      const order = (await tx.order.findUnique({ where: { id: found.id }, select: ORDER_SELECT }))!;
      const verdict = judge(kind, order, timeZone);
      if (verdict.result === "ACCEPTED") {
        const taken = await tx.parcelScanEvent.findFirst({
          where: { orderId: order.id, kind, result: "ACCEPTED", voidedAt: null, batch: { status: { in: ["OPEN", "CONFIRMED"] } } },
          include: { batch: { select: { id: true, status: true, createdBy: { select: { name: true } } } } },
        });
        if (taken) {
          const sameBatch = taken.batchId === batchId;
          const message = sameBatch
            ? `${order.orderNumber} is already in this batch`
            : `${order.orderNumber} is already in ${taken.batch.createdBy?.name ? `${taken.batch.createdBy.name}'s` : "another"} ${taken.batch.status === "OPEN" ? "open batch" : "batch"}`;
          return (await write({ orderId: order.id, result: sameBatch ? "DUPLICATE" : "ALREADY_PROCESSED", message })).id;
        }
      }
      return (await write({ orderId: order.id, ...verdict })).id;
    });
    return toEventRow(eventId);
  } catch (err) {
    // Two requests with one clientScanId raced: the loser answers with the winner's row.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const first = await prisma.parcelScanEvent.findUnique({ where: { clientScanId: input.clientScanId } });
      if (first) return toEventRow(first.id);
    }
    throw err;
  }
}

/** Take a scan out of an open batch (scanned by mistake). It stays in the log as voided. */
export async function voidScan(batchId: string, eventId: string) {
  await prisma.$transaction(async (tx) => {
    const [batch] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "ParcelScanBatch" WHERE id = ${batchId} FOR UPDATE`;
    if (!batch) throw AppError.notFound("Batch not found");
    if (batch.status !== "OPEN") throw new AppError(409, "This batch is closed", { code: "BATCH_CLOSED" });
    const { count } = await tx.parcelScanEvent.updateMany({ where: { id: eventId, batchId, voidedAt: null }, data: { voidedAt: new Date() } });
    if (count === 0) throw AppError.notFound("Scan not found in this batch");
  });
  return getBatch(batchId);
}

/**
 * Confirm a batch: every accepted scan's order gets its handover / receipt in one transaction — all or nothing. An order
 * that changed since its scan (cancelled, already processed elsewhere) stops the confirmation with a list, so the operator
 * removes it and confirms again. Confirming a confirmed batch again returns it unchanged.
 */
export async function confirmBatch(batchId: string, adminId: string) {
  const timeZone = await getTimezone();
  await prisma.$transaction(async (tx) => {
    const [batch] = await tx.$queryRaw<Array<{ kind: string; status: string }>>`SELECT kind, status FROM "ParcelScanBatch" WHERE id = ${batchId} FOR UPDATE`;
    if (!batch) throw AppError.notFound("Batch not found");
    if (batch.status === "CONFIRMED") return;
    if (batch.status !== "OPEN") throw new AppError(409, "This batch was cancelled", { code: "BATCH_CLOSED" });
    const kind = batch.kind as ParcelScanKind;

    const accepted = await tx.parcelScanEvent.findMany({ where: { batchId, result: "ACCEPTED", voidedAt: null, orderId: { not: null } }, select: { id: true, orderId: true }, orderBy: { createdAt: "asc" } });
    if (accepted.length === 0) throw AppError.badRequest("Nothing to confirm — scan a parcel first");
    const ids = [...new Set(accepted.map((e) => e.orderId!))].sort();
    // Lock in a fixed order so two confirmations touching the same orders can't deadlock.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    const orders = await tx.order.findMany({ where: { id: { in: ids } }, select: { ...ORDER_SELECT, shippedSmsDeferred: true } });

    const problems: string[] = [];
    for (const o of orders) {
      const v = judge(kind, o, timeZone);
      if (v.result !== "ACCEPTED") problems.push(v.message);
    }
    if (problems.length) throw new AppError(409, `Some parcels changed since they were scanned — remove them and confirm again: ${problems.join("; ")}`, { code: "BATCH_STALE", problems });

    const now = new Date();
    const when = formatDateTime(now, timeZone);
    for (const o of orders) {
      if (kind === "DISPATCH") {
        await tx.order.update({
          where: { id: o.id },
          data: {
            handedOverAt: now,
            handedOverByAdminId: adminId,
            handedOverBatchId: batchId,
            shippedSmsDeferred: false,
            statusHistory: { create: { status: o.status, note: `Handed to the courier (dispatch scan, ${when})`, changedByAdminId: adminId } },
          },
        });
        // The "shipped" SMS held at booking (shippedSmsTrigger = HANDOVER) goes now — once, keyed by the order.
        if (o.shippedSmsDeferred) {
          await recordOutboxEvents(tx as AppTransactionClient, [
            { eventType: "order.status_changed.v1", consumer: "customer-order-sms", eventKey: `handover-sms:${o.id}`, aggregateType: "Order", aggregateId: o.id, payload: { orderId: o.id, touchpoint: "SHIPPED" } },
          ]);
        }
      } else {
        await tx.order.update({
          where: { id: o.id },
          data: {
            receivedBackAt: now,
            receivedBackByAdminId: adminId,
            receivedBackBatchId: batchId,
            statusHistory: { create: { status: o.status, note: `Parcel physically back (return scan, ${when}) — stock is unchanged until it is inspected`, changedByAdminId: adminId } },
          },
        });
      }
    }
    await tx.parcelScanBatch.update({ where: { id: batchId }, data: { status: "CONFIRMED", confirmedAt: now, confirmedByAdminId: adminId } });
  });
  return getBatch(batchId);
}

export async function cancelBatch(batchId: string) {
  await prisma.$transaction(async (tx) => {
    const [batch] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "ParcelScanBatch" WHERE id = ${batchId} FOR UPDATE`;
    if (!batch) throw AppError.notFound("Batch not found");
    if (batch.status === "CONFIRMED") throw new AppError(409, "A confirmed batch can't be cancelled", { code: "BATCH_CLOSED" });
    const now = new Date();
    await tx.parcelScanEvent.updateMany({ where: { batchId, voidedAt: null }, data: { voidedAt: now } });
    await tx.parcelScanBatch.update({ where: { id: batchId }, data: { status: "CANCELLED" } });
  });
  return getBatch(batchId);
}

async function toEventRow(id: string) {
  const e = await prisma.parcelScanEvent.findUniqueOrThrow({ where: { id }, include: { order: { select: { orderNumber: true, customerName: true } } } });
  return eventRow(e);
}

function eventRow(e: Prisma.ParcelScanEventGetPayload<{ include: { order: { select: { orderNumber: true; customerName: true } } } }>) {
  return {
    id: e.id,
    clientScanId: e.clientScanId,
    code: e.code,
    result: e.result as ParcelScanResult,
    message: e.message,
    orderId: e.orderId,
    orderNumber: e.order?.orderNumber ?? null,
    customerName: e.order?.customerName ?? null,
    discrepancy: e.discrepancy,
    voided: Boolean(e.voidedAt),
    createdAt: e.createdAt.toISOString(),
  };
}

export async function getBatch(batchId: string): Promise<ParcelScanBatchView> {
  const b = await prisma.parcelScanBatch.findUnique({
    where: { id: batchId },
    include: {
      createdBy: { select: { name: true } },
      events: { orderBy: { createdAt: "desc" }, include: { order: { select: { orderNumber: true, customerName: true } } } },
    },
  });
  if (!b) throw AppError.notFound("Batch not found");
  const confirmedBy = b.confirmedByAdminId ? (await prisma.adminUser.findUnique({ where: { id: b.confirmedByAdminId }, select: { name: true } }))?.name ?? null : null;
  const events = b.events.map(eventRow);
  return {
    id: b.id,
    kind: b.kind as ParcelScanKind,
    status: b.status as ParcelScanBatchView["status"],
    createdAt: b.createdAt.toISOString(),
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    createdBy: b.createdBy?.name ?? null,
    confirmedBy,
    accepted: events.filter((e) => e.result === "ACCEPTED" && !e.voided).length,
    events,
  };
}

/** Today's dispatch picture: booked today vs handed over today (the pilot's "booked − handed over = 0"). */
export async function dispatchSummary(dayStart: Date) {
  const [booked, handedOver] = await Promise.all([
    prisma.order.count({ where: { deletedAt: null, courierBookedAt: { gte: dayStart }, courierConsignmentId: { not: null } } }),
    prisma.order.count({ where: { deletedAt: null, courierBookedAt: { gte: dayStart }, handedOverAt: { not: null } } }),
  ]);
  return { bookedToday: booked, handedOverToday: handedOver };
}
