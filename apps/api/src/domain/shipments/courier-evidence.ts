/**
 * What the courier's own API can prove about a shipment (docs/COURIER_COSTS.md §2). Steadfast reports, per parcel, only
 * its status and the COD it was booked for; charges come per PAYOUT (`due_bills` = the delivery and return charges of the
 * payout's parcels, `charges` = its COD charge). So a parcel's actual charge is taken from the courier only where the
 * payout's total pins it down:
 *
 *   • every parcel of the payout is a shipment here, and the parcels' charges (recorded, else the tariff estimate) add up
 *     EXACTLY to the payout's delivery & return charges → each is COURIER_CONFIRMED (Steadfast billed the payout that);
 *   • exactly one parcel has no charge recorded and every other one is confirmed → it is the remainder (COURIER_CONFIRMED
 *     only when the others are courier-confirmed too, otherwise ENTERED for an admin to verify);
 *   • every parcel has a confirmed charge and the sum differs → each is flagged NEEDS_REVIEW with both totals.
 * Nothing else is assumed. The cash the courier collected is recorded per parcel only when the payout's totals pin it down
 * (delivered = its booked COD, returned = 0, the single partly delivered parcel = what is left).
 */
import { Prisma, type Shipment } from "@prisma/client";
import { formatMoney, isChargeConfirmed, type ShipmentOperationalStatus } from "@clothing-brand/shared";
import { getCurrency } from "../config/commerce-settings";
import { prisma } from "../../config/prisma";
import { getProviders } from "../../providers/registry";
import { parsePayoutDetail, parsePayoutList, type ParsedPayout, type ParsedPayoutLine } from "../finance/courier-payouts.service";
import { refreshSteadfastStatus } from "../../modules/courier/courier.service";
import { AppError } from "../../lib/app-error";
import { derivedColumns, diff, recordShipmentEvent, toMajor, toMinor } from "./shipment-core";
import { fillMissingReferences, STEADFAST } from "./shipment-sync";

const LIST_CACHE_MS = 2 * 60_000;
const DETAIL_CACHE_MS = 30 * 60_000;
let listCache: { at: number; payouts: ParsedPayout[] } | null = null;
const detailCache = new Map<string, { at: number; payout: ParsedPayout | null; lines: ParsedPayoutLine[] }>();

/** Test hook: forget cached courier payouts. */
export function clearCourierPayoutCache() {
  listCache = null;
  detailCache.clear();
}

async function payoutList(): Promise<ParsedPayout[]> {
  if (listCache && Date.now() - listCache.at < LIST_CACHE_MS) return listCache.payouts;
  const { payouts } = parsePayoutList(await getProviders().courier.payouts());
  listCache = { at: Date.now(), payouts };
  return payouts;
}

async function payoutDetail(id: string) {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_CACHE_MS) return hit;
  const parsed = parsePayoutDetail(await getProviders().courier.payout(id));
  const entry = { at: Date.now(), payout: parsed.payout, lines: parsed.lines };
  detailCache.set(id, entry);
  return entry;
}

const kind = (s: string | null) => (s ?? "").trim().toLowerCase();
const PAYOUT_REVIEW_PREFIX = "Steadfast payout";

export interface PayoutCheck {
  payoutId: string;
  parcels: number;
  matched: number;
  /** Charges proven by this payout now (newly confirmed or derived). */
  confirmed: number;
  flagged: number;
  outcome: "CONFIRMED" | "DERIVED" | "MISMATCH" | "INCOMPLETE" | "NO_CHARGES" | "OPEN";
  message: string;
}

/** Records one payout's facts on its parcels' legs and checks its charges (see the file comment). */
export async function applyPayoutEvidence(payout: ParsedPayout, lines: ParsedPayoutLine[]): Promise<PayoutCheck> {
  const ids = lines.map((l) => l.consignmentId).filter((x): x is string => Boolean(x));
  const check: PayoutCheck = { payoutId: payout.id, parcels: lines.length, matched: 0, confirmed: 0, flagged: 0, outcome: "OPEN", message: "" };
  if (!ids.length) return { ...check, outcome: "INCOMPLETE", message: "No parcels in this payout carry a consignment id" };
  // Money in the store currency for the messages and review reasons.
  const currency = await getCurrency();
  const tk = (minor: number) => formatMoney(minor / 100, currency);

  return prisma.$transaction(async (tx) => {
    // Lock the legs: a save in progress can't interleave with the payout check.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Shipment" WHERE courier = ${STEADFAST} AND "consignmentId" IN (${Prisma.join(ids)}) AND type IN ('OUTBOUND', 'REPLACEMENT') ORDER BY id FOR UPDATE`;
    const legs = await tx.shipment.findMany({ where: { id: { in: locked.map((r) => r.id) } } });
    const byCid = new Map(legs.map((l) => [l.consignmentId!, l]));
    check.matched = lines.filter((l) => l.consignmentId && byCid.has(l.consignmentId)).length;

    // 1 — parcel facts: payout, booked COD, the cash collected when the totals pin it down; a cancelled parcel the courier
    // billed in a payout came back (it was not voided before pickup).
    const gross = payout.gross === null ? null : Math.round(payout.gross * 100);
    const deliveredSum = lines.reduce((s, l) => s + (kind(l.status).startsWith("delivered") ? Math.round(l.booked * 100) : 0), 0);
    const partials = lines.filter((l) => kind(l.status).startsWith("partial"));
    const collectedOf = (l: ParsedPayoutLine): number | null => {
      const s = kind(l.status);
      if (s.startsWith("delivered")) return Math.round(l.booked * 100);
      if (s.startsWith("cancelled")) return 0;
      if (s.startsWith("partial") && partials.length === 1 && gross !== null && gross - deliveredSum >= 0) return gross - deliveredSum;
      return null;
    };
    const current = new Map<string, Shipment>();
    for (const line of lines) {
      const leg = line.consignmentId ? byCid.get(line.consignmentId) : undefined;
      if (!leg) continue;
      const collected = collectedOf(line);
      const op: ShipmentOperationalStatus = leg.trackedByCourier && leg.operationalStatus === "CANCELLED" && kind(line.status).startsWith("cancelled") ? "RETURNED" : leg.operationalStatus;
      const after = { courierPayoutRef: payout.id, bookedCodAmount: line.booked, courierCollected: toMajor(collected), operationalStatus: op };
      const changes = diff(leg as unknown as Record<string, unknown>, after);
      if (!Object.keys(changes).length) {
        current.set(leg.id, leg);
        continue;
      }
      const updated = await tx.shipment.update({
        where: { id: leg.id },
        data: { ...after, version: { increment: 1 }, ...derivedColumns({ ...leg, operationalStatus: op }) },
      });
      current.set(leg.id, updated);
      await recordShipmentEvent(tx, {
        shipmentId: leg.id, action: "SYNCED", source: "COURIER_PAYOUT", reference: payout.id, changes,
        note: op !== leg.operationalStatus ? "Steadfast billed this cancelled parcel in a payout — it came back after pickup" : null,
      });
    }

    // 2 — charges.
    if (payout.deliveryCharges === null) return { ...check, outcome: "NO_CHARGES" as const, message: "This payout doesn't state its delivery charges" };
    const due = Math.round(payout.deliveryCharges * 100);
    if (check.matched < lines.length) {
      return { ...check, outcome: "INCOMPLETE" as const, message: `${lines.length - check.matched} parcel(s) in payout ${payout.id} aren't shipments on the website, so its ${tk(due)} of charges can't be split per parcel` };
    }
    const ordered = lines.map((l) => current.get(byCid.get(l.consignmentId!)!.id)!);
    const recorded = ordered.map((leg) => toMinor(leg.actualCharge));
    const candidates = ordered.map((leg, i) => recorded[i] ?? toMinor(leg.estimatedCharge));
    const sum = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

    const confirm = async (leg: Shipment, charge: number, status: "COURIER_CONFIRMED" | "ENTERED", note: string) => {
      const after = {
        actualCharge: toMajor(charge), chargeStatus: status, chargeSource: "COURIER_PAYOUT", chargeReference: payout.id,
        reviewReason: leg.reviewReason?.startsWith(PAYOUT_REVIEW_PREFIX) ? null : leg.reviewReason,
      };
      const changes = diff(leg as unknown as Record<string, unknown>, after);
      if (!Object.keys(changes).length) return false;
      await tx.shipment.update({
        where: { id: leg.id },
        data: { ...after, version: { increment: 1 }, ...derivedColumns({ ...leg, actualCharge: new Prisma.Decimal(charge / 100), chargeStatus: status, reviewReason: after.reviewReason }) },
      });
      await recordShipmentEvent(tx, { shipmentId: leg.id, action: status === "COURIER_CONFIRMED" ? "COURIER_CONFIRMED" : "UPDATED", source: "COURIER_PAYOUT", reference: payout.id, changes, note });
      return true;
    };

    if (candidates.every((c) => c !== null) && sum(candidates) === due) {
      const basis = recorded.every((r) => r !== null) ? "recorded charges" : "charges (recorded, else the standard rate for the zone)";
      for (const [i, leg] of ordered.entries()) {
        if (leg.chargeStatus === "COURIER_CONFIRMED" && recorded[i] === candidates[i]) continue;
        if (await confirm(leg, candidates[i]!, "COURIER_CONFIRMED", `Payout ${payout.id} charged ${tk(due)} for its ${lines.length} parcel(s) — exactly these parcels' ${basis}`)) check.confirmed += 1;
      }
      return { ...check, outcome: "CONFIRMED" as const, message: `Payout ${payout.id}: ${tk(due)} of charges matches its ${lines.length} parcel(s)` };
    }

    const missing = ordered.filter((leg, i) => recorded[i] === null);
    const others = ordered.filter((leg, i) => recorded[i] !== null);
    if (missing.length === 1 && others.every((leg) => isChargeConfirmed(leg.chargeStatus))) {
      const rest = due - sum(others.map((leg) => toMinor(leg.actualCharge)));
      if (rest >= 0) {
        const status = others.every((leg) => leg.chargeStatus === "COURIER_CONFIRMED") ? "COURIER_CONFIRMED" : "ENTERED";
        const ok = await confirm(missing[0]!, rest, status, `Payout ${payout.id} charged ${tk(due)}; the other ${others.length} parcel(s) account for ${tk(due - rest)} — this one is the rest`);
        if (ok) check.confirmed += 1;
        return { ...check, outcome: "DERIVED" as const, message: `Payout ${payout.id}: one parcel's charge derived from the payout total` };
      }
    }

    if (!missing.length && ordered.every((leg) => isChargeConfirmed(leg.chargeStatus))) {
      const reason = `${PAYOUT_REVIEW_PREFIX} ${payout.id} charged ${tk(due)} for its ${lines.length} parcel(s); their recorded charges add up to ${tk(sum(recorded))}`;
      for (const leg of ordered) {
        if (leg.reviewReason === reason) continue;
        await tx.shipment.update({ where: { id: leg.id }, data: { reviewReason: reason, version: { increment: 1 }, ...derivedColumns({ ...leg, reviewReason: reason }) } });
        await recordShipmentEvent(tx, { shipmentId: leg.id, action: "REVIEW_FLAGGED", source: "COURIER_PAYOUT", reference: payout.id, note: reason });
        check.flagged += 1;
      }
      return { ...check, outcome: "MISMATCH" as const, message: reason };
    }
    return { ...check, outcome: "OPEN" as const, message: `Payout ${payout.id}: ${tk(due)} of charges; the parcels' known charges add up to ${tk(sum(candidates))} — record the missing ones to check it` };
  });
}

/** Walks the courier's payouts (newest first) and applies each one's evidence. */
export async function syncCourierPayouts(limit = 30) {
  await fillMissingReferences();
  const payouts = (await payoutList()).slice(0, limit);
  const checks: PayoutCheck[] = [];
  const problems: Array<{ payoutId: string; message: string }> = [];
  for (const p of payouts) {
    try {
      const detail = await payoutDetail(p.id);
      checks.push(await applyPayoutEvidence({ ...p, ...(detail.payout ?? {}), id: p.id }, detail.lines));
    } catch (err) {
      problems.push({ payoutId: p.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { payouts: payouts.length, checks, problems };
}

// ── one shipment ──────────────────────────────────────────────────────────────────────────────────────────────────────

const RETURN_STATUS: Array<[RegExp, ShipmentOperationalStatus]> = [
  [/^(pending|requested|new)/, "RETURN_REQUESTED"],
  [/^(approved|accepted|processing|picked|in_transit|in transit|on_the_way)/, "RETURN_IN_TRANSIT"],
  [/^(completed|complete|returned|delivered|received)/, "RETURNED"],
  [/^(cancel|reject|declined)/, "CANCELLED"],
];

function returnRequestsOf(data: unknown): Array<{ id: string; consignmentId: string | null; status: string | null }> {
  const root = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const rows = Array.isArray(root.data) ? root.data : Array.isArray(data) ? (data as unknown[]) : [];
  return rows.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const c = (o.consignment ?? {}) as Record<string, unknown>;
    const cid = o.consignment_id ?? c.consignment_id;
    return { id: String(o.id ?? ""), consignmentId: cid == null ? null : String(cid), status: typeof o.status === "string" ? o.status : null };
  });
}

/** "Retrieve from courier": the consignment's current status (through the order's courier sync), the payout it was paid
 * in (and that payout's charge check), and for a return leg Steadfast's return request. Failures are reported, not thrown. */
export async function refreshShipmentFromCourier(id: string) {
  const leg = await prisma.shipment.findUnique({ where: { id } });
  if (!leg) throw AppError.notFound("Shipment not found");
  const messages: string[] = [];
  if (leg.courier !== STEADFAST || !leg.consignmentId) {
    return { messages: [`${leg.courier} isn't connected — enter this leg's figures from the courier's statement`] };
  }

  if (leg.type !== "RETURN") {
    if (leg.trackedByCourier && leg.parcelOrderId) {
      try {
        await refreshSteadfastStatus(leg.parcelOrderId);
        messages.push("Status refreshed from Steadfast");
      } catch (err) {
        messages.push(`Status: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      await fillMissingReferences();
      let found = false;
      for (const p of await payoutList()) {
        const detail = await payoutDetail(p.id);
        if (!detail.lines.some((l) => l.consignmentId === leg.consignmentId)) continue;
        const result = await applyPayoutEvidence({ ...p, ...(detail.payout ?? {}), id: p.id }, detail.lines);
        messages.push(result.message);
        found = true;
        break;
      }
      if (!found) messages.push("Not in any Steadfast payout yet — Steadfast reports charges only per payout");
    } catch (err) {
      messages.push(`Payouts: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { messages };
  }

  try {
    const match = returnRequestsOf(await getProviders().courier.returnRequests()).find((r) => r.consignmentId === leg.consignmentId);
    if (!match) return { messages: ["Steadfast has no return request for this consignment"] };
    const op = RETURN_STATUS.find(([re]) => re.test(kind(match.status)))?.[1] ?? leg.operationalStatus;
    if (op !== leg.operationalStatus || match.status !== leg.courierStatus) {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.shipment.findUniqueOrThrow({ where: { id } });
        const after = { operationalStatus: op, courierStatus: match.status, courierSyncedAt: new Date(), completedAt: ["RETURNED", "CANCELLED"].includes(op) ? (fresh.completedAt ?? new Date()) : null };
        await tx.shipment.update({ where: { id }, data: { ...after, version: { increment: 1 }, ...derivedColumns({ ...fresh, operationalStatus: op }) } });
        await recordShipmentEvent(tx, { shipmentId: id, action: "SYNCED", source: "COURIER_RETURN_REQUEST", reference: match.id, changes: diff(fresh as unknown as Record<string, unknown>, { operationalStatus: op, courierStatus: match.status }) });
      });
    }
    messages.push(`Steadfast return request ${match.id}: ${match.status ?? "no status"}`);
  } catch (err) {
    messages.push(`Return request: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { messages };
}
