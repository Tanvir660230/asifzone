/**
 * Bottles filled at courier booking (docs/STOCK_HUB.md §7, owner decision 2026-10-24). An attar parcel is only booked once
 * its bottles are filled, so booking records the fill the shop already did: for each fill-to-order line of the order, the
 * bottles that were still owed for it — worked out *before* the booking takes it off the shelf (filled bottles go to the
 * waiting orders oldest first, fill-status.service) — are recorded through Stock › Filled (recordFill), so the materials
 * leave stock at their average and the bottles come in at what they took. Filled bottles already on the shelf are used first.
 *
 * It never fails a booking: the parcel is already with the courier. A fill that can't be made (no recipe, a material short)
 * is kept as a StockAutoFillFailure for Today, and the bottles stay owed until someone fills them. Each fill's key is
 * `auto-fill:<order>:<variant>:<units>` (keys are fingerprinted, so the units are part of it), so it is recorded once.
 */
import { prisma } from "../../config/prisma";
import { logger } from "../../lib/observability/logger";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { recordFill } from "./fill.service";
import { waitingLines } from "./fill-status.service";

export const AUTO_FILL_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:courier-booking" };

export type AutoFillPlan = Map<string, Array<{ variantId: string; units: number }>>;

/** The bottles each order still needs filled, before booking takes it off the shelf. */
export async function planAutoFill(orderIds: string[]): Promise<AutoFillPlan> {
  const plan: AutoFillPlan = new Map();
  if (!orderIds.length) return plan;
  const ids = new Set(orderIds);
  for (const line of await waitingLines(prisma)) {
    if (!ids.has(line.orderId) || line.toFill <= 0) continue;
    const lines = plan.get(line.orderId) ?? [];
    const same = lines.find((l) => l.variantId === line.variantId);
    if (same) same.units += line.toFill;
    else lines.push({ variantId: line.variantId, units: line.toFill });
    plan.set(line.orderId, lines);
  }
  return plan;
}

export interface AutoFillResult {
  filled: Array<{ variantId: string; units: number }>;
  failed: Array<{ variantId: string; units: number; reason: string }>;
}

/** Records the planned fills of one booked order. Never throws. */
export async function fillForBookedOrder(orderId: string, plan: AutoFillPlan): Promise<AutoFillResult> {
  const result: AutoFillResult = { filled: [], failed: [] };
  const lines = plan.get(orderId) ?? [];
  if (!lines.length) return result;
  let costingLive = false;
  try {
    const { business } = await getFinanceContext();
    costingLive = Boolean((await prisma.financeBusiness.findUnique({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } }))?.inventoryCostingActivatedAt);
  } catch {
    costingLive = false;
  }
  // before stock costing is live there is no Filled to record through; the bottles stay owed, as they always did
  if (!costingLive) return result;
  for (const l of lines) {
    try {
      await recordFill({ variantId: l.variantId, quantity: l.units, note: "Filled for a booked parcel" }, AUTO_FILL_ACTOR, `auto-fill:${orderId}:${l.variantId}:${l.units}`);
      result.filled.push(l);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      result.failed.push({ ...l, reason });
      logger.error("[stock] auto-fill at booking failed", { detail: `${orderId} ${l.variantId} ×${l.units}: ${reason}` });
      await prisma.stockAutoFillFailure
        .upsert({ where: { orderId_variantId: { orderId, variantId: l.variantId } }, create: { orderId, variantId: l.variantId, units: l.units, reason: reason.slice(0, 500) }, update: { units: l.units, reason: reason.slice(0, 500), resolvedAt: null } })
        .catch((e: unknown) => logger.error("[stock] couldn't keep the auto-fill failure", { detail: String(e) }));
    }
  }
  return result;
}

/** Open failures for Today; one whose size no longer owes bottles (filled since) is marked resolved and left out. */
export async function openAutoFillFailures(): Promise<Array<{ orderNumber: string; variantId: string; name: string; units: number; reason: string }>> {
  const rows = await prisma.stockAutoFillFailure.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, units: true, reason: true, variantId: true, order: { select: { orderNumber: true } }, variant: { select: { stock: true, size: true, product: { select: { name: true } } } } },
  });
  const settled = rows.filter((r) => r.variant.stock >= 0).map((r) => r.id);
  if (settled.length) await prisma.stockAutoFillFailure.updateMany({ where: { id: { in: settled } }, data: { resolvedAt: new Date() } });
  return rows
    .filter((r) => r.variant.stock < 0)
    .map((r) => ({ orderNumber: r.order.orderNumber, variantId: r.variantId, name: [r.variant.product.name, r.variant.size].filter(Boolean).join(" — "), units: r.units, reason: r.reason }));
}
