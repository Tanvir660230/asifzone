/**
 * A product's kit (docs/STOCK_HUB.md §11): everything that goes out with one sale of each size, from the owner's own records
 * — the approved recipe's materials (oil, bottle, box, sticker), or the item itself when it is bought ready; the packing
 * rules for a one-item parcel (poly, box); and rolls (bubble poly) at what a finished roll lasted. For each: what is in
 * stock, how many sales it covers, when it runs out at the last 30 days' pace, and the last purchase. Nothing is assumed:
 * a figure the records don't give (no purchase yet, no finished roll) is shown as unknown.
 */
import { prisma } from "../../config/prisma";
import { getFinanceContext } from "../finance/finance-context";
import { financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { packagingFor } from "../finance/packaging.service";
import { listRolls } from "../finance/stock-check.service";
import { stockHub, type StockHubItem } from "./stock-hub.service";

export interface KitComponent {
  variantId: string;
  name: string;
  unit: string;
  /** What one sale takes, in the component's stock unit; null for a roll (a share of a roll per parcel). */
  perSale: number | null;
  /** RECIPE: the approved recipe's line; ITEM: the product itself (bought ready); PACKING: a packing rule; ROLL: a roll in use. */
  source: "RECIPE" | "ITEM" | "PACKING" | "ROLL";
  stock: number;
  /** How many sales the stock covers (floor); null when unknown (a roll). */
  enoughFor: number | null;
  /** Days left at the last 30 days' use of this component (all products together); null when not used lately. */
  daysLeft: number | null;
  avgCost: number | null;
  /** What it costs in one sale (perSale × average, or the roll's cost per parcel). */
  costPerSale: number | null;
  lastPurchase: { date: string; unitCost: number | null; qty: number } | null;
  low: boolean;
}

export async function productKit(productId: string, viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, kind: "FINISHED" },
    select: { id: true, name: true, categoryId: true, fillToOrder: true, variants: { where: { isActive: true }, select: { id: true, sku: true, size: true, color: true }, orderBy: [{ sortOrder: "asc" }, { sku: "asc" }] } },
  });
  if (!product) throw financeError(404, "PRODUCT_NOT_FOUND", "Product not found");
  const [hub, bom, rules, rolls] = await Promise.all([
    stockHub(viewer),
    prisma.billOfMaterials.findFirst({
      where: { productId, status: "APPROVED" },
      orderBy: { version: "desc" },
      select: { id: true, version: true, lines: { where: { suppliedBy: "BUSINESS" }, select: { materialVariantId: true, finishedVariantId: true, qtyPerUnit: true, wastagePct: true } } },
    }),
    prisma.packingRule.findMany({ where: { isActive: true }, select: { id: true, scope: true, scopeId: true, materialVariantId: true, quantity: true, per: true, createdAt: true } }),
    listRolls({ openOnly: true }),
  ]);
  const items = new Map<string, StockHubItem>(hub.groups.flatMap((g) => g.items).map((i) => [i.variantId, i]));
  const allIds = new Set<string>();
  for (const v of product.variants) allIds.add(v.id);
  for (const l of bom?.lines ?? []) allIds.add(l.materialVariantId);
  for (const r of rules) allIds.add(r.materialVariantId);
  for (const r of rolls.rolls) allIds.add(r.materialVariantId);
  const purchases = await lastPurchases([...allIds], cur);

  const component = (variantId: string, perSale: number | null, source: KitComponent["source"], rollCostPerParcel: number | null = null): KitComponent | null => {
    const it = items.get(variantId);
    if (!it) return null;
    const free = Math.max(0, it.stock);
    const avg = viewer.canSeeCost ? it.avgCost : null;
    return {
      variantId,
      name: it.name,
      unit: it.unit,
      perSale,
      source,
      stock: it.stock,
      enoughFor: perSale && perSale > 0 ? Math.floor(free / perSale + 1e-9) : null,
      daysLeft: it.daysLeft,
      avgCost: avg,
      costPerSale: source === "ROLL" ? (viewer.canSeeCost ? rollCostPerParcel : null) : avg !== null && perSale !== null ? Math.round(avg * perSale * 100) / 100 : null,
      lastPurchase: viewer.canSeeCost ? purchases.get(variantId) ?? null : (purchases.get(variantId) ? { ...purchases.get(variantId)!, unitCost: null } : null),
      low: it.low,
    };
  };

  const sizes = product.variants.map((v) => {
    const own = items.get(v.id);
    const parts: KitComponent[] = [];
    const recipeLines = (bom?.lines ?? []).filter((l) => !l.finishedVariantId || l.finishedVariantId === v.id);
    if (recipeLines.length) {
      const per = new Map<string, number>();
      for (const l of recipeLines) per.set(l.materialVariantId, (per.get(l.materialVariantId) ?? 0) + Number(l.qtyPerUnit) * (1 + Number(l.wastagePct) / 100));
      for (const [id, q] of per) { const c = component(id, Math.round(q * 10_000) / 10_000, "RECIPE"); if (c) parts.push(c); }
    } else {
      const c = component(v.id, 1, "ITEM");
      if (c) parts.push(c);
    }
    for (const [id, q] of packagingFor([{ variantId: v.id, productId: product.id, categoryId: product.categoryId, quantity: 1 }], rules)) {
      const c = component(id, q, "PACKING");
      if (c) parts.push(c);
    }
    for (const r of rolls.rolls) {
      if (parts.some((p) => p.variantId === r.materialVariantId)) continue;
      const c = component(r.materialVariantId, null, "ROLL", rolls.averagePerParcel);
      if (c) parts.push(c);
    }
    const limits = parts.filter((p) => p.enoughFor !== null);
    const limiting = limits.length ? limits.reduce((a, b) => (b.enoughFor! < a.enoughFor! ? b : a)) : null;
    const costs = parts.map((p) => p.costPerSale);
    return {
      variantId: v.id,
      sku: v.sku,
      label: [v.size, v.color].filter((x) => x && x !== "Standard").join(" / ") || v.sku,
      stock: own?.stock ?? 0,
      soldPerDay: own?.usedPerDay ?? null,
      recipe: recipeLines.length ? { bomId: bom!.id, version: bom!.version } : null,
      components: parts,
      /** Sales the stock of every component still covers — the one that runs out first decides. */
      canSell: limiting ? limiting.enoughFor : null,
      runsOutFirst: limiting ? { variantId: limiting.variantId, name: limiting.name } : null,
      /** What the kit costs in one sale; null while any part has no cost yet. */
      kitCost: viewer.canSeeCost && costs.every((c) => c !== null) ? Math.round(costs.reduce((s, c) => s + (c ?? 0), 0) * 100) / 100 : null,
    };
  });
  return { productId: product.id, name: product.name, fillToOrder: product.fillToOrder, costingActive: hub.costingActive, sizes };
}

/** The last purchase of each item — a goods receipt (Stock › Received goods) or a stock purchase document — with its unit
 * cost from the valuation entry it made. */
async function lastPurchases(variantIds: string[], cur: string) {
  const out = new Map<string, { date: string; unitCost: number | null; qty: number }>();
  if (!variantIds.length) return out;
  const rows = await prisma.inventoryValuationEntry.findMany({
    where: { variantId: { in: variantIds }, kind: "INFLOW", costBasis: "DOCUMENT", stockMovement: { reason: "PURCHASE_RECEIPT" } },
    orderBy: { createdAt: "desc" },
    select: { variantId: true, financialDate: true, qtyChange: true, unitCost: true, bookValue: true },
  });
  for (const r of rows) {
    if (out.has(r.variantId)) continue;
    const unit = r.unitCost !== null ? Number(r.unitCost) : r.qtyChange ? toMajorNumber(Math.round(toMinor(r.bookValue, cur) / r.qtyChange), cur) : null;
    out.set(r.variantId, { date: r.financialDate.toISOString().slice(0, 10), unitCost: unit === null ? null : Math.round(unit * 100) / 100, qty: r.qtyChange });
  }
  return out;
}
