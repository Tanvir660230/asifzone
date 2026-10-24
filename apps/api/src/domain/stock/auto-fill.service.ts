/**
 * Bottles filled at courier booking (docs/STOCK_HUB.md §7, owner decision 2026-10-24). An attar parcel is only booked once
 * its bottles are filled, so booking records the fill the shop already did: for each fill-to-order line of the order, the
 * bottles that were still owed for it — worked out *before* the booking takes it off the shelf (filled bottles go to the
 * waiting orders oldest first, fill-status.service) — are recorded through Stock › Filled (recordFill), so the materials
 * leave stock at their average and the bottles come in at what they took. Filled bottles already on the shelf are used first.
 *
 * It never fails a booking: the parcel is already with the courier. A fill that can't be made is kept as a
 * StockAutoFillFailure for Today with its key, `auto-fill:<order>:<consignment>:<variant>:<units>` — one per booking (a
 * re-booked order fills again) and fingerprinted, so Try again resumes the same fill:
 *
 *   refused before writing (no recipe, a material short)   nothing was taken; it clears once the size owes no bottles
 *   stopped after writing (FILL_STOPPED, or unknown)        materials may already be issued, so only Try again closes it
 */
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { logger } from "../../lib/observability/logger";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeError } from "../finance/finance-values";
import { recordFill } from "./fill.service";
import { waitingLines } from "./fill-status.service";

export const AUTO_FILL_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:courier-booking" };
/** Refusals recordFill makes before it writes anything — every other failure may have issued materials. */
const REFUSED_BEFORE_WRITING = new Set(["NO_RECIPE", "FILL_SHORT", "FILL_MATERIAL_NOT_IN_RECIPE", "FILL_NOTHING_USED", "VARIANT_NOT_FOUND", "IDEMPOTENCY_KEY_REUSED"]);

export type AutoFillPlan = Map<string, Array<{ variantId: string; units: number }>>;

/** The bottles each order still needs filled, before booking takes it off the shelf (only these orders' sizes are read). */
export async function planAutoFill(orderIds: string[]): Promise<AutoFillPlan> {
  const plan: AutoFillPlan = new Map();
  if (!orderIds.length) return plan;
  const sizes = await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { variantId: true }, distinct: ["variantId"] });
  const variantIds = sizes.map((s) => s.variantId).filter((v): v is string => Boolean(v));
  if (!variantIds.length) return plan;
  const ids = new Set(orderIds);
  for (const line of await waitingLines(prisma, variantIds)) {
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

const codeOf = (err: unknown) => (err instanceof AppError ? ((err.details as { code?: string } | undefined)?.code ?? null) : null);

/** Records the planned fills of one booked order (its consignment makes the key). Never throws. */
export async function fillForBookedOrder(orderId: string, consignmentId: string, plan: AutoFillPlan): Promise<AutoFillResult> {
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
    const fillKey = `auto-fill:${orderId}:${consignmentId}:${l.variantId}:${l.units}`;
    try {
      await recordFill({ variantId: l.variantId, quantity: l.units, note: "Filled for a booked parcel" }, AUTO_FILL_ACTOR, fillKey);
      result.filled.push(l);
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const partial = !REFUSED_BEFORE_WRITING.has(codeOf(err) ?? "");
      result.failed.push({ ...l, reason });
      logger.error("[stock] auto-fill at booking failed", { detail: `${orderId} ${l.variantId} ×${l.units}: ${reason}` });
      await prisma.stockAutoFillFailure
        .upsert({ where: { fillKey }, create: { orderId, variantId: l.variantId, units: l.units, reason, fillKey, partial }, update: { reason, partial, resolvedAt: null } })
        .catch((e: unknown) => logger.error("[stock] couldn't keep the auto-fill failure", { detail: String(e) }));
    }
  }
  return result;
}

/** Try again: sends the same fill once more (a half-done one finishes, nothing is taken twice); closes it when it works. */
export async function retryAutoFill(id: string, actor: FinanceActor) {
  const row = await prisma.stockAutoFillFailure.findUnique({ where: { id }, select: { id: true, variantId: true, units: true, fillKey: true, resolvedAt: true } });
  if (!row) throw financeError(404, "AUTO_FILL_NOT_FOUND", "This fill is no longer waiting");
  if (row.resolvedAt) return { id, resolved: true, replayed: true };
  try {
    await recordFill({ variantId: row.variantId, quantity: row.units, note: "Filled for a booked parcel" }, actor, row.fillKey);
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await prisma.stockAutoFillFailure.update({ where: { id }, data: { reason } });
    throw err;
  }
  await prisma.stockAutoFillFailure.update({ where: { id }, data: { resolvedAt: new Date() } });
  return { id, resolved: true, replayed: false };
}

/** Open failures for Today (a read: nothing is written). One refused before writing drops out once the size owes no
 * bottles (they were filled some other way); one that stopped after writing stays until Try again finishes it. */
export async function openAutoFillFailures(): Promise<Array<{ id: string; orderNumber: string; variantId: string; name: string; units: number; reason: string; partial: boolean }>> {
  const rows = await prisma.stockAutoFillFailure.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, units: true, reason: true, partial: true, variantId: true, order: { select: { orderNumber: true } }, variant: { select: { stock: true, size: true, product: { select: { name: true } } } } },
  });
  return rows
    .filter((r) => r.partial || r.variant.stock < 0)
    .map((r) => ({ id: r.id, orderNumber: r.order.orderNumber, variantId: r.variantId, name: [r.variant.product.name, r.variant.size].filter(Boolean).join(" — "), units: r.units, reason: r.reason, partial: r.partial }));
}
