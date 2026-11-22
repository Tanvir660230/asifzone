/**
 * The delivery charge Steadfast's webhook carries for a parcel (docs/COURIER_COSTS.md §2), kept on the parcel's leg.
 *
 * Checked 2026-11-22 against a merchant export: 43 of 43 parcels equal. Still a push's claim, so it is provisional
 * (ENTERED, source COURIER_WEBHOOK): it becomes COURIER_CONFIRMED when a payout's total proves it (courier-evidence.ts),
 * or VERIFIED by an admin. A charge a person entered, or one already confirmed, is never overwritten.
 */
import { prisma } from "../../config/prisma";
import { derivedColumns, diff, recordShipmentEvent, toMajor, toMinor } from "./shipment-core";
import { STEADFAST } from "./shipment-sync";

export const COURIER_WEBHOOK_SOURCE = "COURIER_WEBHOOK";

/** Returns whether the leg's charge changed. Zero or less is not a charge (Steadfast sends 0 when it has none). */
export async function recordCourierCharge(consignmentId: string, charge: number, reference: string | null = null): Promise<boolean> {
  if (!(charge > 0)) return false;
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Shipment" WHERE courier = ${STEADFAST} AND "consignmentId" = ${consignmentId} AND type IN ('OUTBOUND', 'REPLACEMENT') ORDER BY id LIMIT 1 FOR UPDATE`;
    if (!locked) return false;
    const leg = await tx.shipment.findUniqueOrThrow({ where: { id: locked.id } });
    const ours = leg.chargeStatus === "MISSING" || (leg.chargeStatus === "ENTERED" && leg.chargeSource === COURIER_WEBHOOK_SOURCE);
    if (!ours || leg.reconciledAt) return false;
    const minor = Math.round(charge * 100);
    if (toMinor(leg.actualCharge) === minor) return false;
    const after = { actualCharge: toMajor(minor), chargeStatus: "ENTERED" as const, chargeSource: COURIER_WEBHOOK_SOURCE, chargeReference: reference };
    const changes = diff(leg as unknown as Record<string, unknown>, after);
    const updated = await tx.shipment.update({ where: { id: leg.id }, data: { ...after, version: { increment: 1 } } });
    await tx.shipment.update({ where: { id: leg.id }, data: derivedColumns(updated) });
    await recordShipmentEvent(tx, { shipmentId: leg.id, action: "SYNCED", source: COURIER_WEBHOOK_SOURCE, reference: consignmentId, changes, note: "Delivery charge reported by Steadfast" });
    return true;
  });
}

/** Legs with no charge whose parcel's charge is already in the webhook log (pushes from before this was kept): filled from
 * the latest one. Bounded; safe to call any number of times. Returns how many were filled. */
export async function fillMissingCourierCharges(limit = 500): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ consignmentId: string; charge: string }>>`
    SELECT s."consignmentId", e."deliveryCharge"::text AS charge
    FROM "Shipment" s
    JOIN LATERAL (
      SELECT w."deliveryCharge" FROM "CourierWebhookEvent" w
      WHERE w."consignmentId" = s."consignmentId" AND w."deliveryCharge" > 0 AND w.outcome = 'APPLIED'
      ORDER BY w."receivedAt" DESC LIMIT 1
    ) e ON true
    WHERE s.courier = ${STEADFAST} AND s."chargeStatus" = 'MISSING' AND s."reconciledAt" IS NULL AND s.type IN ('OUTBOUND', 'REPLACEMENT')
    ORDER BY s."createdAt" DESC LIMIT ${limit}`;
  let filled = 0;
  for (const r of rows) if (await recordCourierCharge(r.consignmentId, Number(r.charge))) filled += 1;
  return filled;
}
