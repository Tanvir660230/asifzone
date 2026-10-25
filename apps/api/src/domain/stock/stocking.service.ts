/**
 * How a product is stocked (docs/STOCK_HUB.md §8) — the owner's switch on the product:
 *
 *   READY            sold from the shelf (caps, clothes); stock is what is there
 *   FILLED_TO_ORDER  filled from its approved recipe as orders come (attar); stock = filled bottles, may go below zero, and
 *                    the selling rule (stock-hub.service setStockPolicy) says how far past the bottles it sells
 *   MATERIAL         used to make other products (oil, bottles…); never sold — the database keeps it inactive
 *
 * Only the setting changes: no stock, movement or valuation is written. Leaving FILLED_TO_ORDER needs no bottles owed
 * (they would turn into an oversold shelf), and only a product never ordered and without a recipe becomes a material —
 * its orders, prices and recipes belong to a product that is sold. A material stays a material (create the product).
 */
import { stockingSchema, type StockingInput, type StockingMode } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordAudit } from "../../lib/audit";
import type { FinanceActor } from "../finance/finance-audit";
import { financeError } from "../finance/finance-values";
import { materialsCategoryInTx } from "../manufacturing/manufacturing-setup.service";
import { fillCapacityChanged } from "./fill-capacity.service";

const SELECT = {
  id: true, name: true, kind: true, fillToOrder: true, trackInventory: true, deletedAt: true, stockPolicy: true, stockUnit: true,
  variants: { select: { id: true, sku: true, stock: true } },
} as const;

type Row = { kind: string; fillToOrder: boolean };
const modeOf = (p: Row): StockingMode => (p.kind === "MATERIAL" ? "MATERIAL" : p.fillToOrder ? "FILLED_TO_ORDER" : "READY");

/** The product's mode and what stands in the way of each other mode (null = allowed). */
export async function getStocking(productId: string) {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: SELECT });
  if (!p || p.deletedAt) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  const ids = p.variants.map((v) => v.id);
  const [ordered, recipes, approved] = await Promise.all([
    ids.length ? prisma.orderItem.count({ where: { variantId: { in: ids } } }) : 0,
    prisma.billOfMaterials.count({ where: { productId } }),
    prisma.billOfMaterials.count({ where: { productId, status: "APPROVED" } }),
  ]);
  const owed = p.variants.reduce((s, v) => s + Math.max(0, -v.stock), 0);
  const mode = modeOf(p);
  const blocked: Record<StockingMode, string | null> = {
    READY: mode === "MATERIAL" ? "A material stays a material — create the product to sell" : owed > 0 ? `${owed} owed — fill them first` : null,
    FILLED_TO_ORDER: mode === "MATERIAL" ? "A material stays a material — create the product to sell" : !p.trackInventory ? "Turn on stock tracking first" : null,
    MATERIAL: mode === "MATERIAL" ? null : ordered > 0 ? "It has been ordered — only a product never sold can become a material" : recipes > 0 ? "It has a recipe — a material can't have one" : owed > 0 ? `${owed} owed — fill them first` : null,
  };
  return { productId, mode, stockUnit: p.stockUnit, hasApprovedRecipe: approved > 0, owed, blocked };
}

export async function setStocking(productId: string, raw: StockingInput, actor: FinanceActor) {
  const input = stockingSchema.parse(raw);
  const current = await getStocking(productId);
  if (current.mode === input.mode) return { ...current, changed: false, warning: null };
  const why = current.blocked[input.mode];
  if (why) throw financeError(409, "STOCKING_REFUSED", why);
  await prisma.$transaction(async (tx) => {
    // Re-checked under the row lock: an order placed between the read and the write must still stop a material.
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
    if (input.mode === "FILLED_TO_ORDER") {
      await tx.product.update({ where: { id: productId }, data: { fillToOrder: true } });
      return;
    }
    const variants = await tx.productVariant.findMany({ where: { productId }, select: { id: true, stock: true } });
    if (variants.some((v) => v.stock < 0)) throw financeError(409, "STOCKING_REFUSED", "Bottles are owed — fill them first");
    if (input.mode === "READY") {
      await tx.product.update({ where: { id: productId }, data: { fillToOrder: false, stockPolicy: "TRACKED", backorderLimit: null } });
      await tx.productVariant.updateMany({ where: { productId }, data: { stockPolicy: null } });
      return;
    }
    if (await tx.orderItem.count({ where: { variantId: { in: variants.map((v) => v.id) } } })) throw financeError(409, "STOCKING_REFUSED", "It has been ordered — only a product never sold can become a material");
    const categoryId = await materialsCategoryInTx(tx);
    await tx.product.update({
      where: { id: productId },
      data: { kind: "MATERIAL", isActive: false, status: "DRAFT", trackInventory: true, stockUnit: input.stockUnit!.trim(), fillToOrder: false, stockPolicy: "TRACKED", backorderLimit: null, categoryId },
    });
    await tx.productVariant.updateMany({ where: { productId }, data: { stockPolicy: null } });
  });
  // the shop's capacity memo reads fill-to-order: drop it so the change shows at once in this process
  fillCapacityChanged();
  recordAudit({
    adminId: actor.type === "ADMIN" ? actor.adminId : null,
    action: "product.stocking_changed",
    entityType: "products",
    entityId: productId,
    ipAddress: null,
    metadata: { reason: input.reason, before: current.mode, after: input.mode, stockUnit: input.mode === "MATERIAL" ? input.stockUnit : undefined },
  });
  const after = await getStocking(productId);
  const warning = after.mode === "FILLED_TO_ORDER" && !after.hasApprovedRecipe ? "Add a recipe so bottles can be filled — until then it sells only what is filled" : null;
  return { ...after, changed: true, warning };
}
