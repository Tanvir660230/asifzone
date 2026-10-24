/**
 * Count losses waiting for the owner (docs/STOCK_HUB.md §7). A loss counted by someone without inventory.approve and worth
 * at least FinanceBusiness.countLossApprovalThreshold — at the item's average cost, else its cost price; an item with
 * neither counts as over, so an unpriced loss never slips through — is held: count.service keeps the count and calls
 * `holdLossForApprovalInTx` instead of adjusting the stock.
 *
 * Approving applies the difference recorded at the count (not one worked out again: units sold since are already out of
 * stock) through the ordinary stock adjustment, at the average cost then; rejecting moves nothing and keeps the count.
 * A decision is made once: the same decision again replays (200), the other one is refused (409 APPROVAL_DECIDED).
 */
import type { StockApprovalDecisionInput, StockCountReason } from "@clothing-brand/shared";
import { stockApprovalDecisionSchema } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { adjustVariantStockInTx, afterAdjustment, type AdjustResult } from "../../modules/inventory/inventory.service";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { MOVEMENT_REASON, REASON_WORD, reservedNotDispatched } from "./count.service";
import { variantLabel } from "./hub-entry";

export const APPROVE_PERMISSION = "inventory.approve";

const canApprove = (actor: FinanceActor) => actor.type === "ADMIN" && actor.permissions.includes(APPROVE_PERMISSION);

/** Holds a count loss for the owner when it must wait; returns the approval's id, or null when the loss may be booked now.
 * Finds the approval an earlier attempt of the same count line made. */
export async function holdLossForApprovalInTx(
  tx: AppTransactionClient,
  business: { id: string; baseCurrency: string },
  line: { stockCountId: string; variantId: string; difference: number; reason: StockCountReason; note: string | null },
  actor: FinanceActor,
): Promise<string | null> {
  const earlier = await tx.stockCountApproval.findUnique({ where: { stockCountId: line.stockCountId }, select: { id: true } });
  if (earlier) return earlier.id;
  if (canApprove(actor)) return null;
  const [settings, variant] = await Promise.all([
    tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { countLossApprovalThreshold: true } }),
    tx.productVariant.findUniqueOrThrow({ where: { id: line.variantId }, select: { costPrice: true, costState: { select: { avgUnitCost: true } }, product: { select: { costPrice: true } } } }),
  ]);
  // a known positive cost, else the cost price; ৳0 means unvalued (a found count gain), so it is unknown, not free
  const positive = (d: { toString(): string } | null | undefined) => (d !== null && d !== undefined && Number(d) > 0 ? Number(d) : null);
  const unit = positive(variant.costState?.avgUnitCost) ?? positive(variant.costPrice) ?? positive(variant.product.costPrice);
  const value = unit === null || unit === undefined ? null : toMajorNumber(toMinor(Number(unit) * -line.difference, business.baseCurrency), business.baseCurrency);
  if (value !== null && toMinor(value, business.baseCurrency) < toMinor(Number(settings.countLossApprovalThreshold), business.baseCurrency)) return null;
  const held = await tx.stockCountApproval.create({
    data: {
      businessId: business.id,
      stockCountId: line.stockCountId,
      variantId: line.variantId,
      difference: line.difference,
      reason: line.reason,
      note: line.note,
      value,
      requestedByAdminId: actor.type === "ADMIN" ? actor.adminId : null,
    },
    select: { id: true },
  });
  return held.id;
}

export async function listApprovals(query: { status?: "PENDING" | "APPROVED" | "REJECTED" }, viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const rows = await prisma.stockCountApproval.findMany({
    where: { businessId: business.id, ...(query.status ? { status: query.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, variantId: true, difference: true, reason: true, note: true, value: true, status: true, createdAt: true, decidedAt: true, decisionNote: true,
      requestedByAdminId: true, decidedByAdminId: true,
      stockCount: { select: { countDate: true, counted: true, siteStock: true } },
      variant: { select: { sku: true, size: true, color: true, product: { select: { name: true, kind: true, stockUnit: true } } } },
    },
  });
  const adminIds = [...new Set(rows.flatMap((r) => [r.requestedByAdminId, r.decidedByAdminId]).filter((x): x is string => Boolean(x)))];
  const admins = adminIds.length ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true } }) : [];
  const who = new Map(admins.map((a) => [a.id, a.name || a.email]));
  return {
    approvals: rows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      sku: r.variant.sku,
      name: variantLabel(r.variant),
      difference: r.difference,
      counted: r.stockCount.counted,
      expected: r.stockCount.siteStock,
      reason: r.reason,
      note: r.note,
      value: viewer.canSeeCost && r.value !== null ? Number(r.value) : null,
      status: r.status,
      countedOn: r.stockCount.countDate.toISOString().slice(0, 10),
      requestedBy: r.requestedByAdminId ? who.get(r.requestedByAdminId) ?? null : null,
      decidedBy: r.decidedByAdminId ? who.get(r.decidedByAdminId) ?? null : null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
    })),
  };
}

export async function decideApproval(id: string, raw: StockApprovalDecisionInput, actor: FinanceActor) {
  const input = stockApprovalDecisionSchema.parse(raw);
  if (!canApprove(actor) || actor.type !== "ADMIN") throw financeError(403, "APPROVAL_FORBIDDEN", "Only the owner can decide a count loss");
  const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const { business } = await getFinanceContext();
  let adjusted: AdjustResult | null = null;
  const result = await financeTransaction(async (tx) => {
    const row = await tx.stockCountApproval.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, status: true, variantId: true, difference: true, reason: true, note: true, stockCount: { select: { countDate: true } }, variant: { select: { product: { select: { fillToOrder: true } } } } },
    });
    if (!row) throw financeError(404, "APPROVAL_NOT_FOUND", "This count is no longer waiting");
    if (row.status !== "PENDING") {
      if (row.status === status) return { id, status, replayed: true };
      throw financeError(409, "APPROVAL_DECIDED", `This count was already ${row.status.toLowerCase()}`);
    }
    // only one decision wins: the row moves out of PENDING under this condition, a racing second one finds 0 rows
    const claimed = await tx.stockCountApproval.updateMany({ where: { id, status: "PENDING" }, data: { status, decidedByAdminId: actor.adminId, decidedAt: new Date(), decisionNote: input.note } });
    if (!claimed.count) throw financeError(409, "APPROVAL_DECIDED", "This count was decided a moment ago — reload");
    if (status === "APPROVED") {
      const reason = row.reason as StockCountReason;
      const date = row.stockCount.countDate.toISOString().slice(0, 10);
      const note = `Stock count ${date}: ${REASON_WORD[reason] ?? reason}${row.note ? ` — ${row.note}` : ""} (approved)`.slice(0, 300);
      const source = { type: "StockCountApproval", id: row.id };
      const waiting = row.variant.product.fillToOrder ? (await reservedNotDispatched(tx, [row.variantId])).get(row.variantId) ?? 0 : 0;
      adjusted = await adjustVariantStockInTx(tx, row.variantId, row.difference, MOVEMENT_REASON[reason] ?? "ADJUSTMENT", actor.adminId, note, { source, floor: waiting });
      const mv = await tx.stockMovement.findFirstOrThrow({ where: { variantId: row.variantId, sourceType: source.type, sourceId: source.id }, select: { id: true } });
      await tx.stockCountApproval.update({ where: { id }, data: { movementId: mv.id } });
    }
    return { id, status, replayed: false };
  });
  if (adjusted) afterAdjustment(adjusted);
  return result;
}
