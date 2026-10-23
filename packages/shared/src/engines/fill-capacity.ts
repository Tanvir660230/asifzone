/**
 * Fill to order (docs/STOCK_HUB.md §3): a fill-to-order variant's stock is filled bottles and may go negative (ordered,
 * not yet filled). What the shop can still sell on top of that is what its approved recipe can make from the materials
 * unfilled orders haven't already claimed:
 *   need per unit = qtyPerUnit × (1 + wastagePct / 100)
 *   free material = stock − Σ over variants with negative stock of (−stock × need per unit)
 *   makeable(v)   = min over v's lines of ⌊free / need⌋;  no recipe → 0 (never unlimited)
 * A material shared by several variants (one bottle size for every fragrance) is counted in full for each of them; the
 * checkout locks the materials, so the shared limit holds there. Exact: quantities are scaled to integers (qtyPerUnit
 * has 6 dp, wastagePct 2 dp — the BillOfMaterialsLine columns) and divided as BigInt, so 618 ml at 6.18 is 100, not 99.
 */
export interface RecipeLine {
  finishedVariantId: string;
  materialVariantId: string;
  qtyPerUnit: number;
  wastagePct: number;
}

/** need per unit × 10^10 (10^6 for the quantity's 6 dp × 10^4 for 1 + wastage% at 2 dp). */
const NEED_SCALE = 10n ** 10n;
const needScaled = (l: RecipeLine) => BigInt(Math.round(l.qtyPerUnit * 1e6)) * BigInt(10_000 + Math.round(l.wastagePct * 100));

export function makeableUnits(input: {
  recipes: RecipeLine[];
  materialStock: Map<string, number>;
  filled: Map<string, number>;
}): Map<string, number> {
  // Each variant's need per material (lines for the same material are summed); a line that needs nothing limits nothing.
  const needs = new Map<string, Map<string, bigint>>();
  for (const l of input.recipes) {
    const need = needScaled(l);
    if (need <= 0n) continue;
    const perMaterial = needs.get(l.finishedVariantId) ?? new Map<string, bigint>();
    perMaterial.set(l.materialVariantId, (perMaterial.get(l.materialVariantId) ?? 0n) + need);
    needs.set(l.finishedVariantId, perMaterial);
  }

  const free = new Map<string, bigint>();
  for (const [material, stock] of input.materialStock) free.set(material, BigInt(Math.trunc(stock)) * NEED_SCALE);
  for (const [variant, stock] of input.filled) {
    if (stock >= 0) continue;
    for (const [material, need] of needs.get(variant) ?? []) {
      free.set(material, (free.get(material) ?? 0n) - BigInt(-Math.trunc(stock)) * need);
    }
  }

  const made = new Map<string, number>();
  for (const variant of new Set([...input.filled.keys(), ...needs.keys()])) {
    const perMaterial = needs.get(variant);
    if (!perMaterial || perMaterial.size === 0) {
      made.set(variant, 0);
      continue;
    }
    let units: bigint | null = null;
    for (const [material, need] of perMaterial) {
      const available = free.get(material) ?? 0n;
      const n = available > 0n ? available / need : 0n;
      if (units === null || n < units) units = n;
    }
    made.set(variant, Number(units ?? 0n));
  }
  return made;
}

/** What the shop sells of a fill-to-order variant: the filled bottles on hand (never below 0) plus what can be made. */
export function sellable(stock: number, makeable: number): number {
  return Math.max(0, stock) + makeable;
}
