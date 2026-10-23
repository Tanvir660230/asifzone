import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { applyCostOperation, averageUnitCostMinor, divRound, EMPTY_POSITION, recipeStandardCosts, type CostOperation, type CostPosition } from "./costing.service";

// Financial Core Phase 4A (docs/FINANCE_PHASE_4.md §13): the moving weighted-average method, figure by figure. Every
// expected value below is computed by hand (BDT: 2 minor digits; the average is major units × 10^6).

const BDT = "BDT";
const run = (ops: CostOperation[], from: CostPosition = EMPTY_POSITION) => {
  let pos = from;
  const entries = [];
  for (const op of ops) {
    const r = applyCostOperation(pos, op, BDT);
    pos = r.next;
    entries.push(r.entry);
  }
  return { pos, entries, last: entries[entries.length - 1]! };
};
const receipt = (qty: number, valueMinor: number | null): CostOperation => ({ type: "INFLOW", qty, valueMinor, basis: "DOCUMENT" });
const sale = (qty: number, unitCostMinor: number | null): CostOperation => ({ type: "OUTFLOW", qty, basis: { kind: "SNAPSHOT", unitCostMinor } });
const writeOff = (qty: number): CostOperation => ({ type: "OUTFLOW", qty, basis: { kind: "AVERAGE" } });
/** The rule every entry obeys: the inventory account ends where the valuation is. */
const ruleHolds = (e: { valueChange: bigint; bookValue: bigint; costAdjustment: bigint }) => expect(e.costAdjustment).toBe(e.valueChange - e.bookValue);

describe("integer arithmetic", () => {
  it("rounds half to even, both signs", () => {
    expect([divRound(5n, 2n), divRound(7n, 2n), divRound(-5n, 2n), divRound(-7n, 2n), divRound(1n, 3n), divRound(2n, 3n)]).toEqual([2n, 4n, -2n, -4n, 0n, 1n]);
    expect(() => divRound(1n, 0n)).toThrow();
  });
});

describe("weighted average", () => {
  it("first receipt sets the average; a second receipt at another cost blends it", () => {
    const a = run([receipt(10, 100_000)]); // 10 × 100.00
    expect(a.pos).toMatchObject({ valuedQty: 10, value: 100_000n, avgScaled: 100_000_000n, unvaluedQty: 0, deficitQty: 0 });
    expect(a.last).toMatchObject({ kind: "INFLOW", qtyChange: 10, valueChange: 100_000n, bookValue: 100_000n, costAdjustment: 0n, valuationStatus: "KNOWN" });
    const b = run([receipt(5, 65_000)], a.pos); // 5 × 130.00 → (1000 + 650) / 15 = 110.00
    expect(b.pos).toMatchObject({ valuedQty: 15, value: 165_000n, avgScaled: 110_000_000n });
    expect(averageUnitCostMinor(b.pos, BDT)).toBe(11_000);
  });

  it("a sale between receipts leaves at its snapshot and does not move the average", () => {
    const { pos, last } = run([receipt(10, 100_000), receipt(5, 65_000), sale(3, 11_000)]);
    expect(pos).toMatchObject({ valuedQty: 12, value: 132_000n, avgScaled: 110_000_000n });
    expect(last).toMatchObject({ kind: "OUTFLOW", qtyChange: -3, valueChange: -33_000n, bookValue: -33_000n, costAdjustment: 0n, costBasis: "SNAPSHOT", valuationStatus: "KNOWN" });
    const after = run([receipt(12, 120_000)], pos); // (1320 + 1200) / 24 = 105.00
    expect(after.pos).toMatchObject({ valuedQty: 24, value: 252_000n, avgScaled: 105_000_000n });
  });

  it("the last unit takes all remaining value — rounding never leaves a residue, and any difference is an explicit adjustment", () => {
    const { pos } = run([receipt(3, 100_000)]); // 1000.00 / 3
    expect(pos.avgScaled).toBe(333_333_333n);
    expect(averageUnitCostMinor(pos, BDT)).toBe(33_333);
    const s1 = run([sale(1, 33_333)], pos);
    expect(s1.pos).toMatchObject({ valuedQty: 2, value: 66_667n });
    const s2 = run([sale(1, 33_333)], s1.pos); // a snapshot taken before s1: 333.33
    expect(s2.pos).toMatchObject({ valuedQty: 1, value: 33_334n });
    const s3 = run([sale(1, 33_333)], s2.pos);
    expect(s3.pos).toMatchObject({ valuedQty: 0, value: 0n });
    expect(s3.last).toMatchObject({ valueChange: -33_334n, bookValue: -33_333n, costAdjustment: -1n }); // 0.01 to 5150
    ruleHolds(s3.last);
  });

  it("an average-basis outflow (write-off) removes its proportional share, rounded half-even", () => {
    const { pos, last } = run([receipt(3, 100_000), writeOff(1)]);
    expect(last).toMatchObject({ valueChange: -33_333n, bookValue: -33_333n, costAdjustment: 0n, costBasis: "AVERAGE" });
    expect(pos).toMatchObject({ valuedQty: 2, value: 66_667n, avgScaled: 333_335_000n });
  });

  it("a stale snapshot larger than the value held falls back to the average; the difference is an adjustment", () => {
    const { last, pos } = run([receipt(2, 1_000), sale(1, 1_000)]);
    expect(last).toMatchObject({ valueChange: -500n, bookValue: -1_000n, costAdjustment: 500n });
    expect(pos).toMatchObject({ valuedQty: 1, value: 500n });
  });

  it("a customer return re-enters at the line's own cost", () => {
    const { pos, last } = run([receipt(10, 100_000), sale(2, 10_000), { type: "INFLOW", qty: 1, valueMinor: 10_000, basis: "SNAPSHOT" }]);
    expect(last).toMatchObject({ valueChange: 10_000n, bookValue: 10_000n, costAdjustment: 0n });
    expect(pos).toMatchObject({ valuedQty: 9, value: 90_000n, avgScaled: 100_000_000n });
  });

  it("multiple receipts with fractional averages stay exact in value", () => {
    const { pos } = run([receipt(7, 100_000), receipt(3, 33_333), receipt(11, 123_457)]);
    expect(pos.value).toBe(256_790n);
    expect(pos.valuedQty).toBe(21);
    expect(pos.avgScaled).toBe(divRound(256_790n * 10_000n, 21n));
  });
});

describe("negative inventory (§15)", () => {
  it("a sale beyond stock issues the rest provisionally; the next receipt covers it and the difference reaches 5150, never the old journal", () => {
    const short = run([receipt(2, 20_000), sale(5, 10_000)]);
    expect(short.pos).toMatchObject({ valuedQty: 0, value: 0n, deficitQty: 3, avgScaled: 100_000_000n, deficitLayers: [{ qty: 3, unitCostMinor: 10_000 }] });
    expect(short.last).toMatchObject({ valueChange: -20_000n, bookValue: -50_000n, costAdjustment: 30_000n, deficitQtyChange: 3, valuationStatus: "ESTIMATED" });
    const cover = run([receipt(4, 48_000)], short.pos); // 4 × 120.00: 3 cover the deficit, 1 enters stock
    expect(cover.pos).toMatchObject({ valuedQty: 1, value: 12_000n, deficitQty: 0, deficitLayers: [], avgScaled: 120_000_000n });
    expect(cover.last).toMatchObject({ coveredQty: 3, coveredProvisional: 30_000n, valueChange: 12_000n, bookValue: 48_000n, costAdjustment: -36_000n, deficitQtyChange: -3 });
    // 5150 over the cycle: +30 000 credited at issue, −36 000 debited at cover → 6 000 = (120 − 100) × 3 units sold short.
    expect(short.last.costAdjustment + cover.last.costAdjustment).toBe(-6_000n);
  });

  it("units sold short with no cost known: nothing is booked at issue; the covering receipt's cost goes to 5150 in full", () => {
    const short = run([sale(2, null)]);
    expect(short.pos).toMatchObject({ deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: null }] });
    expect(short.last).toMatchObject({ valueChange: 0n, bookValue: 0n, costAdjustment: 0n, valuationStatus: "MISSING", unitCostScaled: null });
    const cover = run([receipt(2, 50_000)], short.pos);
    expect(cover.last).toMatchObject({ coveredQty: 2, coveredWithoutCost: 2, valueChange: 0n, bookValue: 50_000n, costAdjustment: -50_000n });
    expect(cover.pos).toMatchObject({ valuedQty: 0, value: 0n, deficitQty: 0 });
  });

  it("a deficit is covered FIFO across layers and partially", () => {
    const { pos } = run([sale(2, 10_000), sale(3, 12_000)]);
    const part = run([receipt(4, 40_000)], pos);
    expect(part.last).toMatchObject({ coveredQty: 4, coveredProvisional: 2n * 10_000n + 2n * 12_000n });
    expect(part.pos).toMatchObject({ deficitQty: 1, deficitLayers: [{ qty: 1, unitCostMinor: 12_000 }], valuedQty: 0 });
  });
});

describe("units without a cost", () => {
  it("are held unvalued (never at zero), leave after valued stock, and are flagged", () => {
    const a = run([receipt(5, null)]);
    expect(a.pos).toMatchObject({ valuedQty: 0, unvaluedQty: 5, value: 0n, avgScaled: null });
    expect(a.last).toMatchObject({ valuationStatus: "MISSING", unvaluedQtyChange: 5, valueChange: 0n });
    expect(averageUnitCostMinor(a.pos, BDT)).toBeNull();
    const b = run([receipt(3, 30_000), writeOff(4)], a.pos);
    expect(b.last).toMatchObject({ valueChange: -30_000n, bookValue: -30_000n, unvaluedQtyChange: -1, valuationStatus: "MISSING" });
    expect(b.pos).toMatchObject({ valuedQty: 0, unvaluedQty: 4, value: 0n });
  });

  it("a sale of unvalued units at a known snapshot keeps the ledger equal to the valuation through 5150", () => {
    const { last } = run([receipt(1, null), { type: "OUTFLOW", qty: 1, basis: { kind: "SNAPSHOT", unitCostMinor: 5_000 } }]);
    expect(last).toMatchObject({ valueChange: 0n, bookValue: -5_000n, costAdjustment: 5_000n, valuationStatus: "MISSING" });
  });

  it("an unvalued inflow does not settle a deficit (its true cost is still unknown)", () => {
    const { pos } = run([sale(2, 10_000), receipt(2, null)]);
    expect(pos).toMatchObject({ deficitQty: 2, unvaluedQty: 2 });
  });

  it("an unvalued inflow nets off units issued short with no cost: a cancelled sale of a never-costed variant leaves nothing behind", () => {
    const short = run([sale(2, null)]);
    const back = run([{ type: "INFLOW", qty: 2, valueMinor: null, basis: "SNAPSHOT" }], short.pos);
    expect(back.pos).toMatchObject({ valuedQty: 0, value: 0n, unvaluedQty: 0, deficitQty: 0, deficitLayers: [] });
    expect(back.last).toMatchObject({ qtyChange: 2, valueChange: 0n, bookValue: 0n, costAdjustment: 0n, deficitQtyChange: -2, unvaluedQtyChange: 0, coveredQty: 2, coveredWithoutCost: 2, coveredProvisional: 0n, valuationStatus: "MISSING" });
    // The next fill is valued in full — no phantom deficit to cover, no adjustment.
    const fill = run([receipt(5, 50_000)], back.pos);
    expect(fill.pos).toMatchObject({ valuedQty: 5, value: 50_000n, unvaluedQty: 0, deficitQty: 0 });
    expect(fill.last).toMatchObject({ coveredQty: 0, coveredWithoutCost: 0, costAdjustment: 0n });
  });

  it("only no-cost deficit layers are netted (a provisional cost stays to be trued up), the rest is held unvalued", () => {
    const { pos, last } = run([sale(2, 10_000), sale(3, null), receipt(4, null)]);
    expect(pos).toMatchObject({ deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: 10_000 }], unvaluedQty: 1 });
    expect(last).toMatchObject({ qtyChange: 4, deficitQtyChange: -3, unvaluedQtyChange: 1, coveredQty: 3, costAdjustment: 0n });
  });

  it("a mixed return nets its no-cost units against no-cost deficit first, then values the rest", () => {
    const short = run([sale(2, null)]);
    const back = run([{ type: "INFLOW", qty: 3, valueMinor: 10_000, basis: "SNAPSHOT", unvaluedQty: 2 }], short.pos);
    expect(back.pos).toMatchObject({ valuedQty: 1, value: 10_000n, unvaluedQty: 0, deficitQty: 0 });
    expect(back.last).toMatchObject({ qtyChange: 3, valueChange: 10_000n, bookValue: 10_000n, costAdjustment: 0n, deficitQtyChange: -2, unvaluedQtyChange: 0, coveredQty: 2, valuationStatus: "MISSING" });
  });
});

describe("late cost (§16–§17)", () => {
  it("a price difference revalues what is still held and sends the sold share to 5150", () => {
    const { pos, last } = run([receipt(10, 100_000), sale(6, 10_000), { type: "REVALUE", deltaMinor: 2_000, qty: 10 }]);
    expect(last).toMatchObject({ kind: "REVALUATION", qtyChange: 0, valueChange: 800n, bookValue: 2_000n, costAdjustment: -1_200n });
    expect(pos).toMatchObject({ valuedQty: 4, value: 40_800n, avgScaled: 102_000_000n });
  });

  it("a credit larger than what is held can't make stock negative — the rest is an adjustment", () => {
    const { pos, last } = run([receipt(1, 1_000), { type: "REVALUE", deltaMinor: -5_000, qty: 1 }]);
    expect(pos).toMatchObject({ valuedQty: 1, value: 0n });
    expect(last).toMatchObject({ valueChange: -1_000n, bookValue: -5_000n, costAdjustment: 4_000n });
  });

  it("with nothing held, the whole difference is an adjustment", () => {
    const { last } = run([receipt(1, 1_000), sale(1, 1_000), { type: "REVALUE", deltaMinor: 300, qty: 1 }]);
    expect(last).toMatchObject({ valueChange: 0n, bookValue: 300n, costAdjustment: -300n });
  });
});

describe("cutover", () => {
  it("sets the first position — valued, unvalued or short — and only once", () => {
    expect(run([{ type: "CUTOVER", qty: 10, valueMinor: 50_000 }]).pos).toMatchObject({ valuedQty: 10, value: 50_000n, avgScaled: 50_000_000n });
    const est = run([{ type: "CUTOVER", qty: 10, valueMinor: 50_000, status: "ESTIMATED" }]);
    expect(est.last.valuationStatus).toBe("ESTIMATED");
    expect(run([{ type: "CUTOVER", qty: 4, valueMinor: null }]).pos).toMatchObject({ unvaluedQty: 4, valuedQty: 0 });
    expect(run([{ type: "CUTOVER", qty: -2, valueMinor: null }]).pos).toMatchObject({ deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: null }] });
    expect(() => run([receipt(1, 100), { type: "CUTOVER", qty: 1, valueMinor: 100 }])).toThrow(/first valuation/);
    expect(() => run([{ type: "CUTOVER", qty: 0, valueMinor: 100 }])).toThrow();
  });
});

describe("every entry obeys the adjustment rule and keeps physical units consistent", () => {
  it("over a mixed sequence", () => {
    const ops: CostOperation[] = [
      receipt(10, 100_000), sale(4, 10_000), receipt(5, 61_000), writeOff(2), sale(12, 10_733), receipt(3, 36_000),
      { type: "REVALUE", deltaMinor: -900, qty: 3 }, { type: "INFLOW", qty: 2, valueMinor: 21_466, basis: "SNAPSHOT" }, receipt(2, null), sale(5, 10_000),
    ];
    let pos = EMPTY_POSITION;
    let physical = 0;
    for (const op of ops) {
      const r = applyCostOperation(pos, op, BDT);
      ruleHolds(r.entry);
      physical += r.entry.qtyChange;
      pos = r.next;
      expect(pos.valuedQty + pos.unvaluedQty - pos.deficitQty).toBe(physical);
      expect(pos.value >= 0n && (pos.valuedQty > 0 || pos.value === 0n)).toBe(true);
    }
  });

  it("refuses malformed input", () => {
    expect(() => run([receipt(0, 100)])).toThrow();
    expect(() => run([receipt(1.5, 100)])).toThrow();
    expect(() => run([receipt(1, -1)])).toThrow();
    expect(() => run([receipt(1, 10.5)])).toThrow();
    expect(() => run([sale(1, -5)])).toThrow();
  });
});

// Fill to order (docs/STOCK_HUB.md §3): a bottle sold before it is filled leaves at its recipe's standard cost, and the
// bottles ordered-not-filled at the cutover start at it. That provisional cost is held OFF the inventory account (no
// adjustment when issued): the order credits it at delivery and the fill, which covers the units, posts only the
// difference between what the bottles really cost and the provisional cost.
describe("unbooked provisional deficits (fill to order)", () => {
  const unfilled = (qty: number, unitCostMinor: number): CostOperation => ({ type: "OUTFLOW", qty, basis: { kind: "SNAPSHOT", unitCostMinor, unbooked: true } });
  /** What the ledger posts for an entry: the adjustment less what the unbooked deficit absorbs. */
  const posted = (e: { costAdjustment: bigint; unbookedDeficitChange: bigint }) => e.costAdjustment - e.unbookedDeficitChange;

  it("a sale before any fill: an unbooked layer at the recipe cost, nothing posted", () => {
    const r = run([unfilled(2, 27_800)]);
    expect(r.pos).toMatchObject({ deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: 27_800, unbooked: true }], valuedQty: 0, value: 0n });
    ruleHolds(r.last);
    expect(r.last).toMatchObject({ costAdjustment: 55_600n, unbookedDeficitChange: 55_600n, valuationStatus: "ESTIMATED", unitCostScaled: 278_000_000n });
    expect(posted(r.last)).toBe(0n);
  });

  it("the fill covers it: only actual − provisional is posted (0 at the same prices)", () => {
    const same = run([unfilled(2, 27_800), receipt(2, 55_600)]);
    expect(same.pos).toMatchObject({ deficitQty: 0, deficitLayers: [], valuedQty: 0, value: 0n });
    ruleHolds(same.last);
    expect(same.last).toMatchObject({ coveredQty: 2, costAdjustment: -55_600n, unbookedDeficitChange: -55_600n });
    expect(posted(same.last)).toBe(0n);
    const dearer = run([unfilled(2, 27_800), receipt(3, 90_000)]); // 300 a bottle now
    expect(dearer.pos).toMatchObject({ deficitQty: 0, valuedQty: 1, value: 30_000n });
    expect(dearer.last).toMatchObject({ costAdjustment: -60_000n, unbookedDeficitChange: -55_600n });
    expect(posted(dearer.last)).toBe(-4_400n); // 2 × (300 − 278) to 5150
  });

  it("a cancel before the fill nets the deficit at the same provisional cost, nothing posted", () => {
    const r = run([unfilled(2, 27_800), { type: "INFLOW", qty: 2, valueMinor: 55_600, basis: "SNAPSHOT" }]);
    expect(r.pos).toMatchObject({ deficitQty: 0, deficitLayers: [], unvaluedQty: 0, valuedQty: 0, value: 0n });
    expect(r.last).toMatchObject({ coveredQty: 2, unbookedDeficitChange: -55_600n });
    expect(posted(r.last)).toBe(0n);
    // An inflow with no cost never settles a layer that has one.
    expect(run([unfilled(1, 27_800), receipt(1, null)]).pos).toMatchObject({ deficitQty: 1, unvaluedQty: 1 });
  });

  it("after a first fill: a sale beyond the filled bottles at the average — the valued one leaves as usual, the rest unbooked, nothing posted", () => {
    const r = run([receipt(1, 31_600), unfilled(3, 31_600)]);
    expect(r.pos).toMatchObject({ valuedQty: 0, value: 0n, deficitQty: 2, deficitLayers: [{ qty: 2, unitCostMinor: 31_600, unbooked: true }] });
    ruleHolds(r.last);
    expect(r.last).toMatchObject({ valueChange: -31_600n, unbookedDeficitChange: 63_200n });
    expect(posted(r.last)).toBe(0n);
    expect(posted(run([receipt(2, 63_200)], r.pos).last)).toBe(0n); // the fill at the same price
    // A non-integral average: only the valued units' rounding residue is posted, exactly as an ordinary sale of them would.
    const odd = run([receipt(3, 100_000), unfilled(5, 33_333)]);
    expect(odd.last).toMatchObject({ unbookedDeficitChange: 66_666n });
    expect(posted(odd.last)).toBe(run([receipt(3, 100_000), sale(3, 33_333)]).last.costAdjustment); // −1
  });

  it("booked layers (ordinary provisional deficits) are unchanged and covered in order", () => {
    const ordinary = run([receipt(1, 10_000), sale(3, 10_000)]);
    expect(ordinary.last).toMatchObject({ costAdjustment: 20_000n, unbookedDeficitChange: 0n });
    expect(ordinary.pos.deficitLayers).toEqual([{ qty: 2, unitCostMinor: 10_000 }]);
    const mixed = run([unfilled(1, 27_800), sale(1, 27_800), receipt(2, 60_000)], EMPTY_POSITION);
    expect(mixed.last).toMatchObject({ coveredQty: 2, costAdjustment: -60_000n, unbookedDeficitChange: -27_800n });
  });

  it("the cutover starts unfilled bottles at the recipe cost, unbooked; a fill then posts the difference only", () => {
    const c = run([{ type: "CUTOVER", qty: -3, valueMinor: null, deficitUnitCostMinor: 27_800 }]);
    expect(c.pos).toMatchObject({ deficitQty: 3, deficitLayers: [{ qty: 3, unitCostMinor: 27_800, unbooked: true }] });
    expect(c.last).toMatchObject({ costAdjustment: 0n, unbookedDeficitChange: 83_400n, valuationStatus: "ESTIMATED" });
    const f = run([receipt(3, 83_400)], c.pos);
    expect(posted(f.last)).toBe(0n);
    // Without a recipe cost the cutover is as before (a no-cost deficit).
    expect(run([{ type: "CUTOVER", qty: -2, valueMinor: null, deficitUnitCostMinor: null }]).last).toMatchObject({ valuationStatus: "MISSING", unbookedDeficitChange: 0n });
  });
});

describe("recipe standard cost", () => {
  const D = (n: string) => new Prisma.Decimal(n);
  const lines = [
    { variantId: "v6", materialVariantId: "oil", qtyPerUnit: D("6"), wastagePct: D("10") },
    { variantId: "v6", materialVariantId: "btl", qtyPerUnit: D("1"), wastagePct: D("0") },
    { variantId: "vx", materialVariantId: "oil", qtyPerUnit: D("12"), wastagePct: D("0") },
    { variantId: "vx", materialVariantId: "none", qtyPerUnit: D("1"), wastagePct: D("0") },
  ];
  it("Σ qty × (1 + wastage) × material cost, rounded once; null when a material has no cost", () => {
    const cost = (id: string) => (id === "oil" ? D("38.125") : id === "btl" ? D("50") : null);
    const r = recipeStandardCosts(lines, cost, BDT);
    expect(r.get("v6")).toBe(30_162); // 6.6 × 38.125 = 251.625 + 50 = 301.625 → 301.62 (half to even)
    expect(r.get("vx")).toBeNull();
    expect(r.has("other")).toBe(false);
  });
});
