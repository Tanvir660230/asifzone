/**
 * The owner's stock value correction (docs/STOCK_HUB.md §12): "these units on hand are really worth ৳X a piece". For a
 * value the books took wrongly at go-live — the B caps valued at the old ৳587 when the batch cost ৳476.77, or units that
 * came in with no value at all (a hand entry, a cancelled never-costed sale) — and that no purchase document can carry
 * because the purchase is already in the books (the owner's capital). Every held unit of each item is set to its unit
 * cost (costing.service SET_UNIT_COST); the change is booked against opening balance equity, so no sale is re-costed and
 * profit doesn't move. Units issued short (a deficit) are left alone.
 *
 * `commit: false` previews — the same arithmetic, nothing written. A commit needs an Idempotency-Key and the owner
 * (finance.sensitive: it moves equity); the same key again replays.
 */
import { stockValueCorrectionSchema, type StockValueCorrectionInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { financeError, toMajorNumber, toMinor } from "./finance-values";
import { activeCostingInTx, correctHeldValuesInTx, positionOf, previewHeldValue } from "./costing.service";

const SOURCE = "StockValueCorrection";

export async function correctStockValues(raw: StockValueCorrectionInput, actor: FinanceActor, key: string | null) {
  const input = stockValueCorrectionSchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const m = (v: number | bigint) => toMajorNumber(Number(v), cur);

  if (input.commit) {
    if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with a correction");
    if (!actorCan(actor, "finance.sensitive")) throw financeError(403, "VALUE_CORRECTION_OWNER", "A stock value correction moves the owner's equity — only the owner can make it");
    const done = await prisma.inventoryValuationEntry.findMany({ where: { sourceType: SOURCE, sourceId: key }, select: { variantId: true, valueChange: true } });
    if (done.length) return { committed: true, replayed: true, lines: done.map((d) => ({ variantId: d.variantId, change: Number(d.valueChange) })), total: done.reduce((s, d) => s + Number(d.valueChange), 0) };
  }

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: input.lines.map((l) => l.variantId) } },
    select: { id: true, sku: true, size: true, product: { select: { name: true, trackInventory: true, deletedAt: true } }, costState: true },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const rows = input.lines.map((l, i) => {
    const v = byId.get(l.variantId);
    if (!v || v.product.deletedAt) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: item not found`);
    if (!v.product.trackInventory) throw financeError(400, "VALUE_UNTRACKED", `Line ${i + 1}: ${v.product.name} isn't stock-tracked`);
    const pos = positionOf(v.costState, cur);
    const unitCostMinor = toMinor(l.unitCost, cur);
    const { next, entry } = previewHeldValue(pos, unitCostMinor, cur);
    return {
      variantId: v.id, sku: v.sku, name: `${v.product.name}${v.size ? ` — ${v.size}` : ""}`, unitCostMinor,
      held: pos.valuedQty + pos.unvaluedQty, unvalued: pos.unvaluedQty, short: pos.deficitQty,
      valueBefore: m(pos.value), valueAfter: m(next.value), change: m(entry.valueChange),
    };
  });
  const total = rows.reduce((s, r) => s + toMinor(r.change, cur), 0);
  const view = rows.map(({ unitCostMinor, ...r }) => ({ ...r, unitCost: m(unitCostMinor) }));
  if (!input.commit) return { committed: false, replayed: false, lines: view, total: m(total) };

  const date = businessToday(business);
  await financeTransaction(async (tx) => {
    const scope = await activeCostingInTx(tx);
    if (!scope) throw financeError(409, "COSTING_NOT_ACTIVE", "Stock costing isn't live yet — the go-live count sets the values");
    await correctHeldValuesInTx(tx, { scope, sourceId: key!, financialDate: date, note: input.reason, items: rows.filter((r) => r.held > 0).map((r) => ({ variantId: r.variantId, unitCostMinor: r.unitCostMinor })) });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "stock.value_correction", entityType: SOURCE, entityId: key!, after: { reason: input.reason, lines: view, total: m(total) }, reason: input.reason });
  });
  return { committed: true, replayed: false, lines: view, total: m(total) };
}
