/**
 * Material requirements of a production order (docs/MANUFACTURING.md §4) — pure and exact. Quantities per unit and wastage
 * are decimals (6 dp / 2 dp); they are scaled to integers (BigInt) so no floating point touches a requirement, and each
 * requirement is rounded UP to whole stock units (you can't issue part of a stock unit).
 *
 *   requirement(material) = ⌈ Σ over the order lines it applies to ( planned units × qty per unit × (1 + wastage %) ) ⌉
 *
 * A BOM line applies to every line of the order (finishedVariantId null) or to the order line of its finished variant.
 * Lines for the same material and supplier are combined (one requirement each); BUSINESS- and PRODUCER-supplied stay
 * apart (only the first is issued from stock).
 */

export interface RequirementBomLine {
  id: string;
  materialVariantId: string;
  finishedVariantId: string | null;
  /** Decimal string, up to 6 dp. */
  qtyPerUnit: string;
  /** Decimal string, up to 2 dp. */
  wastagePct: string;
  suppliedBy: "BUSINESS" | "PRODUCER";
}

export interface RequirementOrderLine {
  variantId: string;
  plannedQty: number;
}

export interface MaterialRequirement {
  materialVariantId: string;
  suppliedBy: "BUSINESS" | "PRODUCER";
  /** The BOM line when exactly one produced it (its qty per unit and wastage are then snapshotted). */
  bomLineId: string | null;
  qtyPerUnit: string | null;
  wastagePct: string | null;
  plannedQty: number;
}

/** A non-negative decimal string → integer × 10^scale (exact; extra digits are refused). */
export function scaleDecimal(value: string, scale: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`not a non-negative decimal: ${value}`);
  const frac = m[2] ?? "";
  if (frac.replace(/0+$/, "").length > scale) throw new Error(`${value} has more than ${scale} decimals`);
  return BigInt(m[1]!) * 10n ** BigInt(scale) + BigInt((frac + "0".repeat(scale)).slice(0, scale) || "0");
}

const QTY_SCALE = 6; // qty per unit
const PCT_SCALE = 2; // wastage percent
const DENOM = 10n ** BigInt(QTY_SCALE) * 100n * 10n ** BigInt(PCT_SCALE); // qty scale × percent (×100) × its scale

/** Exact requirement of one BOM line for `units` finished units, as a scaled numerator over DENOM (summed before rounding). */
function numerator(units: number, line: RequirementBomLine): bigint {
  const q = scaleDecimal(line.qtyPerUnit, QTY_SCALE);
  const w = scaleDecimal(line.wastagePct, PCT_SCALE);
  if (q <= 0n) throw new Error("a quantity per unit is positive");
  if (w >= 100n * 10n ** BigInt(PCT_SCALE)) throw new Error("wastage is below 100%");
  // units × q/10^6 × (100 + w/100)/100  →  units × q × (100×100 + w) / (10^6 × 100 × 100)
  return BigInt(units) * q * (100n * 10n ** BigInt(PCT_SCALE) + w);
}

const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;

export function computeRequirements(bomLines: RequirementBomLine[], orderLines: RequirementOrderLine[]): MaterialRequirement[] {
  for (const l of orderLines) if (!Number.isSafeInteger(l.plannedQty) || l.plannedQty <= 0) throw new Error("planned quantities are positive whole numbers");
  const total = orderLines.reduce((n, l) => n + l.plannedQty, 0);
  const byVariant = new Map(orderLines.map((l) => [l.variantId, l.plannedQty]));
  const groups = new Map<string, { materialVariantId: string; suppliedBy: "BUSINESS" | "PRODUCER"; sum: bigint; lines: RequirementBomLine[] }>();
  for (const b of bomLines) {
    const units = b.finishedVariantId === null ? total : (byVariant.get(b.finishedVariantId) ?? 0);
    if (units === 0) continue;
    const key = `${b.materialVariantId}|${b.suppliedBy}`;
    const g = groups.get(key) ?? { materialVariantId: b.materialVariantId, suppliedBy: b.suppliedBy, sum: 0n, lines: [] };
    g.sum += numerator(units, b);
    g.lines.push(b);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const single = g.lines.length === 1 ? g.lines[0]! : null;
    return {
      materialVariantId: g.materialVariantId,
      suppliedBy: g.suppliedBy,
      bomLineId: single?.id ?? null,
      qtyPerUnit: single?.qtyPerUnit ?? null,
      wastagePct: single?.wastagePct ?? null,
      plannedQty: Number(ceilDiv(g.sum, DENOM)),
    };
  });
}
