/**
 * Production home (docs/STOCK_HUB.md §9, /admin/inventory/production): the one page for making things — what needs the
 * owner (bottles owed, a filled-to-order product without a recipe, materials running low, sizes below their target
 * margin), how many of each size the
 * materials in stock can still make and which material runs out first, and the latest fills.
 *
 * "Can still make" reads the latest approved recipe of every product, the business-supplied lines only, against the
 * materials' stock now (each size on its own — they share oil and boxes, so the figures are "or", not "and"). It is a
 * planning figure; the shop's fill capacity (fill-capacity.service) additionally sets aside what owed orders claim.
 */
import { prisma } from "../../config/prisma";
import { getFinanceContext } from "../finance/finance-context";
import { stockHub } from "./stock-hub.service";
import { unitOf, variantLabel } from "./hub-entry";
import { productCosts } from "../finance/cost-sheet.service";

export interface CanMakeRow {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  label: string;
  canMake: number;
  /** The material that runs out first, with what is left of it. */
  limiting: { variantId: string; name: string; stock: number; unit: string } | null;
}

/** Per finished size with an approved recipe: how many the materials in stock make, and what runs out first. */
export async function canStillMake(): Promise<CanMakeRow[]> {
  const boms = await prisma.billOfMaterials.findMany({
    where: { status: "APPROVED", product: { deletedAt: null, kind: "FINISHED" } },
    orderBy: [{ productId: "asc" }, { version: "desc" }],
    select: {
      productId: true,
      product: { select: { name: true, variants: { where: { isActive: true }, select: { id: true, sku: true, size: true, color: true }, orderBy: [{ sortOrder: "asc" }, { sku: "asc" }] } } },
      lines: {
        where: { suppliedBy: "BUSINESS" },
        select: { finishedVariantId: true, qtyPerUnit: true, wastagePct: true, materialVariant: { select: { id: true, sku: true, size: true, color: true, stock: true, product: { select: { name: true, stockUnit: true, kind: true } } } } },
      },
    },
  });
  const seen = new Set<string>();
  const rows: CanMakeRow[] = [];
  for (const b of boms) {
    if (seen.has(b.productId)) continue; // the latest approved version only
    seen.add(b.productId);
    for (const v of b.product.variants) {
      const need = new Map<string, { perUnit: number; m: (typeof b.lines)[number]["materialVariant"] }>();
      for (const l of b.lines) {
        if (l.finishedVariantId && l.finishedVariantId !== v.id) continue;
        const per = Number(l.qtyPerUnit) * (1 + Number(l.wastagePct) / 100);
        const had = need.get(l.materialVariant.id);
        need.set(l.materialVariant.id, { perUnit: (had?.perUnit ?? 0) + per, m: l.materialVariant });
      }
      if (!need.size) continue;
      let best: { n: number; m: (typeof b.lines)[number]["materialVariant"] } | null = null;
      for (const { perUnit, m } of need.values()) {
        if (perUnit <= 0) continue;
        const n = Math.floor(Math.max(0, m.stock) / perUnit + 1e-9);
        if (!best || n < best.n) best = { n, m };
      }
      if (!best) continue;
      rows.push({
        productId: b.productId,
        productName: b.product.name,
        variantId: v.id,
        sku: v.sku,
        label: [v.size, v.color].filter(Boolean).join(" / ") || v.sku,
        canMake: best.n,
        limiting: { variantId: best.m.id, name: variantLabel({ ...best.m, product: best.m.product }), stock: best.m.stock, unit: unitOf(best.m.product) },
      });
    }
  }
  return rows.sort((a, b) => a.productName.localeCompare(b.productName) || a.label.localeCompare(b.label));
}

export async function productionHome(viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const [hub, make, fillProducts, fills, costs] = await Promise.all([
    stockHub(viewer),
    canStillMake(),
    prisma.product.findMany({ where: { fillToOrder: true, deletedAt: null, kind: "FINISHED" }, select: { id: true, name: true, billsOfMaterials: { where: { status: "APPROVED" }, select: { id: true }, take: 1 } }, orderBy: { name: "asc" } }),
    prisma.stockHubEntry.findMany({ where: { businessId: business.id, kind: "FILL", completedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, entryDate: true, steps: true } }),
    // the margin check reads costs — only for someone who may see them
    viewer.canSeeCost ? productCosts() : Promise.resolve(null),
  ]);
  const group = (k: string) => hub.groups.find((g) => g.key === k)?.items ?? [];
  const owed = group("FILL_TO_ORDER").filter((i) => (i.policy?.owed ?? 0) > 0).map((i) => ({ variantId: i.variantId, productId: i.productId, name: i.name, owed: i.policy!.owed }));
  const lowMaterials = group("MATERIAL").filter((i) => i.low).map((i) => ({ variantId: i.variantId, name: i.name, stock: i.stock, unit: i.unit, daysLeft: i.daysLeft }));

  // the fills' production orders and sizes, in two reads
  const steps = fills.map((f) => f.steps as { request?: { variantId?: string; quantity?: number }; productionOrderId?: string });
  const [orders, sizes] = await Promise.all([
    prisma.productionOrder.findMany({ where: { id: { in: steps.map((s) => s.productionOrderId).filter((x): x is string => Boolean(x)) } }, select: { id: true, number: true } }),
    prisma.productVariant.findMany({ where: { id: { in: steps.map((s) => s.request?.variantId).filter((x): x is string => Boolean(x)) } }, select: { id: true, sku: true, size: true, color: true, product: { select: { name: true } } } }),
  ]);
  const numberOf = new Map(orders.map((o) => [o.id, o.number]));
  const sizeOf = new Map(sizes.map((s) => [s.id, s]));

  return {
    costingActive: hub.costingActive,
    owed,
    noRecipe: fillProducts.filter((p) => !p.billsOfMaterials.length).map((p) => ({ productId: p.id, name: p.name })),
    lowMaterials,
    /** Sizes whose planned profit is below their target margin, worst first (costing.read only; null otherwise). */
    belowTarget: costs === null ? null : costs.products.flatMap((p) => p.sizes.filter((z) => z.belowTarget).map((z) => ({ productId: p.productId, name: `${p.name} ${z.label}`.trim(), marginPct: z.marginPct, loss: z.profit < 0 }))).sort((a, b) => (a.marginPct ?? -1e9) - (b.marginPct ?? -1e9)),
    canMake: make,
    recentFills: fills.map((f, i) => {
      const s = steps[i]!;
      const v = s.request?.variantId ? sizeOf.get(s.request.variantId) : undefined;
      return {
        id: f.id,
        date: f.entryDate.toISOString().slice(0, 10),
        number: s.productionOrderId ? numberOf.get(s.productionOrderId) ?? null : null,
        name: v ? `${v.product.name} ${[v.size, v.color].filter(Boolean).join(" / ")}`.trim() : "Filled bottles",
        quantity: s.request?.quantity ?? null,
      };
    }),
  };
}
