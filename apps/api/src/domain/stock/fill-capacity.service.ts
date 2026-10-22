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
 * Readers (storefront, quote, reorder, exchange preview) call `withFillToOrder`; in-stock counts and filters add
 * `fillToOrderInStockIds`. Every sale of a fill-to-order unit takes floors inside its transaction, which locks the materials
 * first so two sales racing for the last shared bottle serialize: the checkout and an exchange call `fillToOrderFloors`
 * (they know the product), an order modification and a restore from Trash call `fillToOrderFloorsFor`. Products with
 * `fillToOrder = false` (every product of an installation without attar) never reach a capacity query here.
 */
import { Prisma } from "@prisma/client";
import { makeableUnits, sellable, type RecipeLine } from "@clothing-brand/shared";
import type { Db } from "../../config/prisma";
import { AppError } from "../../lib/app-error";

export interface FillFloors {
  /** Per fill-to-order variant: how far below zero its stock may go (recordSale `floors`). */
  floors: Map<string, number>;
  /** The recipe materials locked. */
  materialIds: string[];
  /** Per variant: what its line could take at its turn. */
  available: Map<string, number>;
}

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

/**
 * In-stock counts and filters: the products matching `where` that a "has an active variant with stock > 0" SQL test misses
 * but that are in stock all the same — fill-to-order, no filled bottle on such a variant, and able to make at least one.
 * Callers keep their SQL fast path for every other product and add these ids. `storefront`: as the shop sells (a product
 * or variant marked sold out is not in stock); otherwise the admin's stock view (active variants, marks ignored).
 * One query, returning nothing, on an installation without fill-to-order products.
 */
export async function fillToOrderInStockIds(db: Db, where: Prisma.ProductWhereInput, opts: { storefront: boolean }): Promise<string[]> {
  const variantWhere = opts.storefront ? { isActive: true, markedSoldOut: false } : { isActive: true };
  const rows = await db.product.findMany({
    where: {
      AND: [
        where,
        { fillToOrder: true, trackInventory: true, ...(opts.storefront ? { markedSoldOut: false } : {}), variants: { none: { ...variantWhere, stock: { gt: 0 } } } },
      ],
    },
    select: { id: true, variants: { where: variantWhere, select: { id: true, stock: true } } },
  });
  const variantIds = rows.flatMap((r) => r.variants.map((v) => v.id));
  if (!variantIds.length) return [];
  const made = await fillCapacity(db, { variantIds });
  return rows.filter((r) => r.variants.some((v) => sellable(v.stock, made.get(v.id) ?? 0) > 0)).map((r) => r.id);
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
 * Returns the materials it locked too, so the caller can refresh the products that share them after commit, and what each
 * line could take at its turn (`available` = max(0, s) + m) for a specific refusal.
 */
export async function fillToOrderFloors(tx: Db, lines: Array<{ variantId: string; quantity: number }>): Promise<FillFloors> {
  const wanted = new Set(lines.map((l) => l.variantId));
  let materialIds: string[] = [];
  const inputs = await loadInputs(tx, (recipes) => {
    materialIds = [...new Set(materialsOf(recipes, wanted))];
    return [...materialIds, ...wanted];
  });
  const filled = new Map(inputs.filled);
  const floors = new Map<string, number>();
  const available = new Map<string, number>();
  for (const line of lines) {
    const s = filled.get(line.variantId);
    if (s === undefined) continue; // not a fill-to-order variant
    const m = makeableUnits({ ...inputs, filled }).get(line.variantId) ?? 0;
    floors.set(line.variantId, m + Math.max(0, -s));
    available.set(line.variantId, sellable(s, m));
    // What this line will claim, so the next line sees the material it leaves (never more than it may take).
    filled.set(line.variantId, Math.max(s - line.quantity, Math.min(s, 0) - m));
  }
  return { floors, materialIds, available };
}

/**
 * `fillToOrderFloors` for a sale that doesn't already know its products (order modification, paid modification, restore
 * from Trash): one lookup picks the lines of tracked fill-to-order products; none → null, and nothing is locked (every
 * product of an installation without attar). Lines of one variant are summed. Call it inside the selling transaction,
 * before the decrement, like the checkout.
 */
export async function fillToOrderFloorsFor(tx: Db, lines: Array<{ variantId: string; quantity: number }>): Promise<FillFloors | null> {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (!ids.length) return null;
  const filling = await tx.productVariant.findMany({ where: { id: { in: ids }, product: { fillToOrder: true, trackInventory: true } }, select: { id: true } });
  if (!filling.length) return null;
  const wanted = new Set(filling.map((v) => v.id));
  const summed = new Map<string, number>();
  for (const l of lines) if (wanted.has(l.variantId)) summed.set(l.variantId, (summed.get(l.variantId) ?? 0) + l.quantity);
  return fillToOrderFloors(tx, [...summed].map(([variantId, quantity]) => ({ variantId, quantity })));
}

/** The variants a fill-to-order sale moved — its own lines and the materials it locked — for `notifyStockMoved` after commit. */
export const fillMoved = (fill: FillFloors | null | undefined): string[] => (fill ? [...fill.materialIds, ...fill.floors.keys()] : []);

/**
 * The checkout's specific refusal for a fill-to-order line its floor can't cover (several lines sharing a material, or a
 * stale quote): how many more can be made, never why. Null when every line fits. Same 409 shape as recordSale's.
 */
export function fillShortfall(fill: FillFloors | null | undefined, lines: Array<{ variantId: string; quantity: number; label: string }>): AppError | null {
  if (!fill) return null;
  for (const line of lines) {
    const n = fill.available.get(line.variantId);
    if (n === undefined || line.quantity <= n) continue;
    return AppError.conflict(n > 0 ? `Only ${n} more ${line.label} can be made right now — please update the quantity` : `${line.label} has just sold out — please review your cart`);
  }
  return null;
}
