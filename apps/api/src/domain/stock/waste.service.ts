/**
 * Wasted (docs/MATERIALS_PURCHASING.md §5): material broken or spoiled outside a fill — a cracked bottle, stickers torn while
 * packing. One DAMAGED movement out at the item's moving average (booked as a loss like any damaged stock), with the reason
 * typed. Idempotent by the Idempotency-Key (the movement's source), so a double tap takes it once. A loss worth at least the
 * owner's count-loss threshold is the owner's to record (inventory.approve), as with counts.
 */
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { actorCan, type FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeTransaction } from "../finance/finance-tx";
import { financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { adjustVariantStockInTx, afterAdjustment, type AdjustResult } from "../../modules/inventory/inventory.service";
import { APPROVE_PERMISSION } from "./count-approval.service";

export const stockWasteSchema = z.object({
  variantId: z.string().trim().min(1).max(64),
  quantity: z.number().int("Whole stock units").min(1).max(1_000_000),
  note: z.string().trim().min(3, "Say what happened").max(300),
});
export type StockWasteInput = z.input<typeof stockWasteSchema>;

export async function recordWaste(raw: StockWasteInput, actor: FinanceActor, key: string | null) {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header");
  if (actor.type !== "ADMIN") throw financeError(403, "FORBIDDEN", "Recorded by a person");
  const input = stockWasteSchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    select: { id: true, stock: true, costPrice: true, costState: { select: { avgUnitCost: true } }, product: { select: { name: true, kind: true, stockUnit: true, deletedAt: true } } },
  });
  if (!variant || variant.product.deletedAt) throw financeError(404, "VARIANT_NOT_FOUND", "Item not found");
  if (variant.product.kind !== "MATERIAL") throw financeError(400, "NOT_A_MATERIAL", "Wasted is for materials — damaged goods for sale are counted out on Count");
  const source = { type: "StockWaste", id: key };
  const done = await prisma.stockMovement.findFirst({ where: { variantId: variant.id, sourceType: source.type, sourceId: source.id }, select: { id: true } });
  if (done) return { replayed: true, movementId: done.id, value: null };
  const avg = variant.costState?.avgUnitCost ?? variant.costPrice;
  const valueMinor = avg === null ? null : Math.round(toMinor(Number(avg), cur) * input.quantity);
  const limit = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { countLossApprovalThreshold: true } });
  if (valueMinor !== null && limit.countLossApprovalThreshold !== null && valueMinor >= toMinor(Number(limit.countLossApprovalThreshold), cur) && !actorCan(actor, APPROVE_PERMISSION)) {
    throw financeError(403, "WASTE_NEEDS_OWNER", `That's ${toMajorNumber(valueMinor, cur)} of ${variant.product.name} — a loss this size is the owner's to record`);
  }
  let adjusted: AdjustResult | null = null;
  await financeTransaction(async (tx) => {
    adjusted = await adjustVariantStockInTx(tx, variant.id, -input.quantity, "DAMAGED", actor.adminId, `Wasted: ${input.note}`.slice(0, 300), { source });
  });
  if (adjusted) afterAdjustment(adjusted);
  const mv = await prisma.stockMovement.findFirstOrThrow({ where: { variantId: variant.id, sourceType: source.type, sourceId: source.id }, select: { id: true } });
  return { replayed: false, movementId: mv.id, value: valueMinor === null ? null : toMajorNumber(valueMinor, cur) };
}
