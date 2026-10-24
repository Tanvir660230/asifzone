/**
 * Stock hub overview (docs/STOCK_HUB.md, /admin/stock): every stock-tracked item in three groups —
 *
 *   FINISHED       sells as it is (caps, clothes…)
 *   FILL_TO_ORDER  filled when orders come (attar): stock = filled bottles (may be negative), `makeable` = what the approved
 *                  recipe can still make from the materials unfilled orders haven't claimed — read live, not the shop's memo
 *   MATERIAL       oil, bottles, boxes, stickers, poly… in their own stock unit (ml, pcs)
 *
 * For each: what waits unpacked on orders (`reserved`) and so what should be on the shelf, the value at the running average
 * (inventory costing — only with costing.read; otherwise null), the use over the last 30 days (orders net of cancellations
 * and returns, production issues net of returns, packaging; over fewer days for an item that first moved more recently)
 * and the days that lasts. Low: 10 days or less, or a fill-to-order variant that can sell 10 or fewer (filled + makeable).
 * Plus the rolls in use (bubble poly) and whether costing is live.
 */
import { sellable, stockPolicySchema, type StockPolicy, type StockPolicyInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordAudit } from "../../lib/audit";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { businessDateOf, financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { listRolls } from "../finance/stock-check.service";
import { fillCapacity, fillCapacityChanged } from "./fill-capacity.service";
import { expectedOnShelf, reservedNotDispatched } from "./count.service";
import { materialRole, unitOf, variantLabel } from "./hub-entry";

export const USE_WINDOW_DAYS = 30;
export const LOW_AT = 10;
/** Movements that are use (or undo use): their net, negated, is what went out. Receipts, counts and edits are not use. */
const USE_REASONS = ["ORDER", "CANCELLATION", "RETURN", "PRODUCTION_ISSUE", "PRODUCTION_RETURN", "PACKAGING_USE"] as const;

/** The days use is averaged over: the last 30, or — for an item that first moved more recently — the days since then
 * (rounded up, at least 1), so a new item's use isn't diluted over days it didn't exist. */
export function useWindowDays(firstMovedAt: Date | null, now: number): number {
  if (!firstMovedAt) return USE_WINDOW_DAYS;
  return Math.min(USE_WINDOW_DAYS, Math.max(1, Math.ceil((now - firstMovedAt.getTime()) / 86_400_000)));
}

export type StockHubGroupKey = "FINISHED" | "FILL_TO_ORDER" | "MATERIAL";

export interface StockHubItem {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  /** The product's name and the variant's own size and colour (as entered), so the page can group colours × sizes. */
  productName: string;
  size: string | null;
  color: string | null;
  unit: string;
  stock: number;
  reserved: number;
  expectedOnShelf: number;
  makeable: number | null;
  /** Fill-to-order only: how it sells past the filled bottles and what the materials make (the variant's override, else
   * the product's), its backorder limit, and the bottles sold but not yet filled. Null for every other item. */
  policy: { policy: StockPolicy; overridden: boolean; backorderLimit: number | null; owed: number } | null;
  /** Materials only: RAW (oil, by volume or weight) or PACKAGING (bottles, boxes, stickers, poly — in pieces). */
  materialKind: "RAW" | "PACKAGING" | null;
  avgCost: number | null;
  value: number | null;
  usedPerDay: number | null;
  daysLeft: number | null;
  low: boolean;
}

export async function stockHub(viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const variants = await prisma.productVariant.findMany({
    where: { product: { deletedAt: null, trackInventory: true }, OR: [{ isActive: true }, { stock: { not: 0 } }] },
    select: {
      id: true, sku: true, size: true, color: true, stock: true, createdAt: true, stockPolicy: true,
      product: { select: { id: true, name: true, kind: true, stockUnit: true, fillToOrder: true, stockPolicy: true, backorderLimit: true } },
      costState: { select: { avgUnitCost: true, value: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sortOrder: "asc" }, { sku: "asc" }],
  });
  const ids = variants.map((v) => v.id);
  const since = new Date(Date.now() - USE_WINDOW_DAYS * 86_400_000);
  const [reserved, made, use, biz, last, rolls] = await Promise.all([
    reservedNotDispatched(prisma),
    variants.some((v) => v.product.fillToOrder) ? fillCapacity(prisma, { materialsOnly: true }) : Promise.resolve(new Map<string, number>()),
    prisma.stockMovement.groupBy({ by: ["variantId"], where: { variantId: { in: ids }, createdAt: { gte: since }, reason: { in: [...USE_REASONS] } }, _sum: { change: true } }),
    prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } }),
    prisma.stockCount.findFirst({ where: { businessId: business.id }, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], select: { countDate: true } }),
    listRolls({ openOnly: true }),
  ]);
  const usedOf = new Map(use.map((u) => [u.variantId, Math.max(0, -(u._sum.change ?? 0))]));
  // An item younger than the window divides its use by the days it has existed, from its first movement (history may be
  // back-dated before the row was made). Only an item created inside the window and used in it can be younger — the rest
  // divide by the whole window — so only their movements are scanned, not every movement on every load.
  const young = variants.filter((v) => v.createdAt >= since && (usedOf.get(v.id) ?? 0) > 0).map((v) => v.id);
  const first = young.length ? await prisma.stockMovement.groupBy({ by: ["variantId"], where: { variantId: { in: young } }, _min: { createdAt: true } }) : [];
  const firstOf = new Map(first.map((m) => [m.variantId, m._min.createdAt]));
  const now = Date.now();

  const groups: Record<StockHubGroupKey, StockHubItem[]> = { FINISHED: [], FILL_TO_ORDER: [], MATERIAL: [] };
  let totalMinor = 0;
  for (const v of variants) {
    const key: StockHubGroupKey = v.product.kind === "MATERIAL" ? "MATERIAL" : v.product.fillToOrder ? "FILL_TO_ORDER" : "FINISHED";
    const waiting = reserved.get(v.id) ?? 0;
    const makeable = key === "FILL_TO_ORDER" ? made.get(v.id) ?? 0 : null;
    const valueMinor = viewer.canSeeCost && v.costState ? toMinor(v.costState.value, cur) : null;
    if (valueMinor !== null) totalMinor += valueMinor;
    const used = usedOf.get(v.id) ?? 0;
    // What lasts: filled bottles plus what can still be made for a fill-to-order variant; the shelf otherwise.
    const left = makeable !== null ? sellable(v.stock, makeable) : Math.max(0, v.stock);
    const window = v.createdAt < since ? USE_WINDOW_DAYS : useWindowDays(firstOf.get(v.id) ?? v.createdAt, now);
    const daysLeft = used > 0 ? Math.floor((left * window) / used) : null;
    groups[key].push({
      variantId: v.id, productId: v.product.id, sku: v.sku, name: variantLabel(v), productName: v.product.name, size: v.size, color: v.color, unit: unitOf(v.product),
      stock: v.stock, reserved: waiting, expectedOnShelf: expectedOnShelf(v.stock, waiting), makeable,
      materialKind: key === "MATERIAL" ? materialRole(unitOf(v.product)) : null,
      policy: key === "FILL_TO_ORDER" ? { policy: v.stockPolicy ?? v.product.stockPolicy, overridden: v.stockPolicy !== null, backorderLimit: v.product.backorderLimit, owed: Math.max(0, -v.stock) } : null,
      avgCost: viewer.canSeeCost && v.costState?.avgUnitCost != null ? Number(v.costState.avgUnitCost) : null,
      value: valueMinor === null ? null : toMajorNumber(valueMinor, cur),
      usedPerDay: used > 0 ? Math.round((used / window) * 100) / 100 : null,
      daysLeft,
      // a fill-to-order variant is low by what it can sell (filled bottles + what can be made)
      // (never for an attar on UNLIMITED: it does not sell out — its oil and bottles show low under Materials)
      low: (v.stockPolicy ?? v.product.stockPolicy) !== "UNLIMITED" || key !== "FILL_TO_ORDER" ? (daysLeft !== null && daysLeft <= LOW_AT) || (makeable !== null && left <= LOW_AT) : false,
    });
  }

  return {
    totalValue: viewer.canSeeCost ? toMajorNumber(totalMinor, cur) : null,
    costingActive: Boolean(biz.inventoryCostingActivatedAt),
    groups: (["FINISHED", "FILL_TO_ORDER", "MATERIAL"] as const).map((key) => ({ key, items: groups[key] })),
    lastCount: last ? businessDateOf(last.countDate) : null,
    /** Rolls in use (bubble poly): opened, not yet finished — parcels booked since it was opened so far. */
    rolls: rolls.rolls.map((r) => ({ id: r.id, materialVariantId: r.materialVariantId, material: r.material, openedOn: r.openedOn, parcels: r.parcels, rollCost: viewer.canSeeCost ? r.rollCost : null })),
  };
}
export type StockHub = Awaited<ReturnType<typeof stockHub>>;

/**
 * Sets how a fill-to-order product sells past its filled bottles (inventory recovery phase 2). Only the policy changes:
 * no stock, movement or valuation is written, and history is untouched. A product that is not filled to order (caps,
 * clothing) is refused — it sells only what is on the shelf. UNLIMITED / BACKORDER sales still leave stock (it goes below
 * zero = bottles owed) and are costed when filled, so they are never free stock.
 */
export async function setStockPolicy(productId: string, raw: StockPolicyInput, actor: FinanceActor) {
  const input = stockPolicySchema.parse(raw);
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, fillToOrder: true, trackInventory: true, deletedAt: true, stockPolicy: true, backorderLimit: true, variants: { select: { id: true, sku: true, stockPolicy: true } } } });
  if (!product || product.deletedAt) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  if (!product.fillToOrder || !product.trackInventory) {
    if (input.policy !== "TRACKED" || (input.variants ?? []).some((v) => v.policy && v.policy !== "TRACKED")) {
      throw financeError(400, "STOCK_POLICY_NEEDS_FILL", `${product.name} sells only what is on the shelf — unlimited or backorder selling is for products filled to order (attar)`);
    }
  }
  const own = new Map(product.variants.map((v) => [v.id, v]));
  const strange = (input.variants ?? []).filter((v) => !own.has(v.variantId));
  if (strange.length) throw financeError(400, "VARIANT_NOT_FOUND", "A size listed is not on this product");
  const backorderLimit = input.policy === "BACKORDER" || (input.variants ?? []).some((v) => v.policy === "BACKORDER") ? input.backorderLimit ?? null : null;
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { stockPolicy: input.policy, backorderLimit } });
    for (const v of input.variants ?? []) await tx.productVariant.update({ where: { id: v.variantId }, data: { stockPolicy: v.policy } });
  });
  // the shop's capacity memo reads the policy: drop it so the change shows at once in this process
  fillCapacityChanged();
  recordAudit({
    adminId: actor.type === "ADMIN" ? actor.adminId : null,
    action: "product.stock_policy_changed",
    entityType: "products",
    entityId: productId,
    ipAddress: null,
    metadata: {
      reason: input.reason,
      before: { policy: product.stockPolicy, backorderLimit: product.backorderLimit, variants: product.variants.filter((v) => v.stockPolicy).map((v) => ({ sku: v.sku, policy: v.stockPolicy })) },
      after: { policy: input.policy, backorderLimit, variants: (input.variants ?? []).map((v) => ({ sku: own.get(v.variantId)!.sku, policy: v.policy })) },
    },
  });
  return { productId, policy: input.policy, backorderLimit, variants: (input.variants ?? []).map((v) => ({ variantId: v.variantId, policy: v.policy })) };
}
