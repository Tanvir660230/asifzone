import { describe, it, expect } from "vitest";
import { computeRequirements, scaleDecimal } from "./requirements";

// Manufacturing M1 (docs/MANUFACTURING.md §4): material requirements — exact, rounded up to whole stock units.

const cap = (over: Partial<Parameters<typeof computeRequirements>[0][number]> = {}) => ({ id: "b1", materialVariantId: "FABRIC", finishedVariantId: null, qtyPerUnit: "37.5", wastagePct: "4", suppliedBy: "BUSINESS" as const, ...over });

describe("material requirements", () => {
  it("1,000 caps × 37.5 cm × (1 + 4%) = 39,000 cm exactly", () => {
    const r = computeRequirements([cap()], [{ variantId: "S", plannedQty: 400 }, { variantId: "M", plannedQty: 600 }]);
    expect(r).toEqual([{ materialVariantId: "FABRIC", suppliedBy: "BUSINESS", bomLineId: "b1", qtyPerUnit: "37.5", wastagePct: "4", plannedQty: 39_000 }]);
  });

  it("rounds UP to whole stock units — never under-plans", () => {
    expect(computeRequirements([cap({ qtyPerUnit: "0.333333", wastagePct: "0" })], [{ variantId: "S", plannedQty: 3 }])[0]!.plannedQty).toBe(1); // 0.999999
    expect(computeRequirements([cap({ qtyPerUnit: "0.333334", wastagePct: "0" })], [{ variantId: "S", plannedQty: 3 }])[0]!.plannedQty).toBe(2); // 1.000002
    expect(computeRequirements([cap({ qtyPerUnit: "1", wastagePct: "2.5" })], [{ variantId: "S", plannedQty: 10 }])[0]!.plannedQty).toBe(11); // 10.25
  });

  it("variant-specific lines apply only to their variant; same material and supplier combine before rounding", () => {
    const r = computeRequirements(
      [
        cap({ id: "base", qtyPerUnit: "30", wastagePct: "0" }),
        cap({ id: "xl-extra", finishedVariantId: "XL", qtyPerUnit: "5.5", wastagePct: "0" }),
        { id: "label", materialVariantId: "LABEL", finishedVariantId: null, qtyPerUnit: "1", wastagePct: "0", suppliedBy: "PRODUCER" },
      ],
      [{ variantId: "M", plannedQty: 100 }, { variantId: "XL", plannedQty: 50 }],
    );
    expect(r).toContainEqual({ materialVariantId: "FABRIC", suppliedBy: "BUSINESS", bomLineId: null, qtyPerUnit: null, wastagePct: null, plannedQty: 150 * 30 + 50 * 5.5 });
    expect(r).toContainEqual({ materialVariantId: "LABEL", suppliedBy: "PRODUCER", bomLineId: "label", qtyPerUnit: "1", wastagePct: "0", plannedQty: 150 });
  });

  it("a variant line for a variant not on the order needs nothing", () => {
    expect(computeRequirements([cap({ finishedVariantId: "XXL" })], [{ variantId: "M", plannedQty: 10 }])).toEqual([]);
  });

  it("refuses bad input: fractional or zero planned units, wastage ≥ 100%, too many decimals", () => {
    expect(() => computeRequirements([cap()], [{ variantId: "M", plannedQty: 1.5 }])).toThrow();
    expect(() => computeRequirements([cap()], [{ variantId: "M", plannedQty: 0 }])).toThrow();
    expect(() => computeRequirements([cap({ wastagePct: "100" })], [{ variantId: "M", plannedQty: 1 }])).toThrow();
    expect(() => scaleDecimal("1.1234567", 6)).toThrow();
    expect(scaleDecimal("12.5", 6)).toBe(12_500_000n);
  });
});
