/**
 * Fill to order (docs/STOCK_HUB.md §3) — the database side of the capacity engine (packages/shared engines/fill-capacity).
 * A fill-to-order variant's stock is filled bottles and may go negative (ordered, not yet filled); what the shop can still
 * sell on top of it is what the product's recipe can make from the materials unfilled orders haven't claimed.
 *
 *   recipe        = the product's latest APPROVED bill of materials, lines the business supplies (suppliedBy = BUSINESS —
 *                   a PRODUCER line is not our stock); a line without a finished variant applies to every variant
 *   material      = the material variants' ProductVariant.stock
 *   filled        = the fill-to-order variants' stock (every fill-to-order variant, so other fragrances' unfilled orders
 *                   reserve a shared bottle too)
 *
 * Readers (storefront, quote, reorder) call `withFillToOrder`; the checkout calls `fillToOrderFloors` inside its order
 * transaction, which locks the materials first so two orders racing for the last shared bottle serialize. Products with
 * `fillToOrder = false` (every product of an installation without attar) never reach a query here.
 */
import { Prisma } from "@prisma/client";
import { makeableUnits, sellable, type RecipeLine } from "@clothing-brand/shared";
import type { Db } from "../../config/prisma";

interface CapacityInputs {
  recipes: RecipeLine[];
  materialStock: Map<string, number>;
  filled: Map<string, number>;
}

/** Every fill-to-order product's recipe lines, expanded per variant. Pure read; no stock. */
async function loadRecipes(db: Db): Promise<{ recipes: RecipeLine[]; variantIds: string[] }> {
  const products = await db.product.findMany({
    where: { fillToOrder: true },
    select: {
      variants: { select: { id: true } },
      billsOfMaterials: {
        where: { status: "APPROVED" },
        orderBy: { version: "desc" },
        take: 1,
        select: { lines: { where: { suppliedBy: "BUSINESS" }, select: { finishedVariantId: true, materialVariantId: true, qtyPerUnit: true, wastagePct: true } } },
      },
    },
  });
  const recipes: RecipeLine[] = [];
  const variantIds: string[] = [];
  for (const p of products) {
    const own = p.variants.map((v) => v.id);
    variantIds.push(...own);
    for (const l of p.billsOfMaterials[0]?.lines ?? []) {
      // A line for a variant no longer on the product limits nothing; a line without one applies to every variant.
      const targets = l.finishedVariantId ? own.filter((id) => id === l.finishedVariantId) : own;
      for (const finishedVariantId of targets) {
        recipes.push({ finishedVariantId, materialVariantId: l.materialVariantId, qtyPerUnit: Number(l.qtyPerUnit), wastagePct: Number(l.wastagePct) });
      }
    }
  }
  return { recipes, variantIds };
}

/** Recipes plus current stock. `lock` = the variants whose rows are taken FOR UPDATE first, in id order (the lock order
 * inventory.service uses), so the stock read afterwards is current for them. */
async function loadInputs(db: Db, lock: (recipes: RecipeLine[]) => string[]): Promise<CapacityInputs> {
  const { recipes, variantIds } = await loadRecipes(db);
  const materialIds = [...new Set(recipes.map((r) => r.materialVariantId))];
  const toLock = [...new Set(lock(recipes))].sort();
  if (toLock.length) await db.$queryRaw`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(toLock)}) ORDER BY id FOR UPDATE`;
  const ids = [...new Set([...materialIds, ...variantIds])];
  const rows = ids.length ? await db.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, stock: true } }) : [];
  const stock = new Map(rows.map((r) => [r.id, r.stock]));
  return {
    recipes,
    materialStock: new Map(materialIds.map((id) => [id, stock.get(id) ?? 0])),
    filled: new Map(variantIds.map((id) => [id, stock.get(id) ?? 0])),
  };
}

const materialsOf = (recipes: RecipeLine[], variantIds: Set<string>) => recipes.filter((r) => variantIds.has(r.finishedVariantId)).map((r) => r.materialVariantId);

/**
 * Makeable units per fill-to-order variant (≥ 0; a variant without an approved recipe → 0, never unlimited). `variantIds`
 * limits the answer (the free material still accounts for every fill-to-order variant's unfilled orders). `lockMaterials`
 * takes FOR UPDATE on the material rows of those variants, in id order — call it inside the transaction that sells.
 */
export async function fillCapacity(db: Db, opts: { variantIds?: string[]; lockMaterials?: boolean } = {}): Promise<Map<string, number>> {
  const wanted = opts.variantIds ? new Set(opts.variantIds) : null;
  const inputs = await loadInputs(db, (recipes) => (opts.lockMaterials ? materialsOf(recipes, wanted ?? new Set(recipes.map((r) => r.finishedVariantId))) : []));
  const made = makeableUnits(inputs);
  if (!wanted) return made;
  return new Map([...made].filter(([id]) => wanted.has(id)));
}

/** Variants as the shop sells them: for a fill-to-order product each variant's stock becomes `sellable(stock, makeable)`;
 * any other product (or an untracked one, already unlimited) is returned as is, without a query. Apply before
 * withMarkedSoldOut, so "show as sold out" still wins. */
export async function withFillToOrder<V extends { id: string; stock: number }>(db: Db, product: { fillToOrder?: boolean | null; trackInventory?: boolean }, variants: V[]): Promise<V[]> {
  if (product.fillToOrder !== true || product.trackInventory === false || !variants.length) return variants;
  const made = await fillCapacity(db, { variantIds: variants.map((v) => v.id) });
  return applyCapacity(made, variants);
}

/** Pure: replaces each variant's stock by what it sells, given capacities already computed (batch readers). */
export function applyCapacity<V extends { id: string; stock: number }>(made: Map<string, number>, variants: V[]): V[] {
  return variants.map((v) => ({ ...v, stock: sellable(v.stock, made.get(v.id) ?? 0) }));
}

/**
 * The checkout's guard for fill-to-order lines, inside the order transaction and BEFORE the stock decrement: locks the
 * materials of these variants and the variants themselves (one statement, id order), then gives each variant the floor its
 * stock may reach — `recordSale` lets it go down to `-floor`.
 *
 * Exact: a line of q units is allowed iff q ≤ sellable(s, m) = max(0, s) + m, i.e. s − q ≥ min(s, 0) − m, so
 * floor = m + max(0, −s). Lines are taken one after another, each seeing the material the earlier ones claimed (two
 * fragrances in one cart can't both take the last shared bottle). A variant that appears twice is summed by the caller.
 * Returns the materials it locked too, so the caller can refresh the products that share them after commit.
 */
export async function fillToOrderFloors(tx: Db, lines: Array<{ variantId: string; quantity: number }>): Promise<{ floors: Map<string, number>; materialIds: string[] }> {
  const wanted = new Set(lines.map((l) => l.variantId));
  let materialIds: string[] = [];
  const inputs = await loadInputs(tx, (recipes) => {
    materialIds = [...new Set(materialsOf(recipes, wanted))];
    return [...materialIds, ...wanted];
  });
  const filled = new Map(inputs.filled);
  const floors = new Map<string, number>();
  for (const line of lines) {
    const s = filled.get(line.variantId);
    if (s === undefined) continue; // not a fill-to-order variant
    const m = makeableUnits({ ...inputs, filled }).get(line.variantId) ?? 0;
    floors.set(line.variantId, m + Math.max(0, -s));
    // What this line will claim, so the next line sees the material it leaves (never more than it may take).
    filled.set(line.variantId, Math.max(s - line.quantity, Math.min(s, 0) - m));
  }
  return { floors, materialIds };
}
