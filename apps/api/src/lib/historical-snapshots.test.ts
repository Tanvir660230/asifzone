import { describe, it, expect } from "vitest";
import { contributions, groupKeyOf, resolveBusinessRange, snapshotCoverage, sumOf, type BusinessRange, type OrderFact } from "@clothing-brand/shared";
import { T, deliveredCod, line, paidOnline } from "./metrics-facts.fixture";

// Phase 6 (docs/PHASE_6_AUDIT.md, METRICS_REGISTRY §3): COGS and gross margin come from each line's recorded cost only;
// category/brand/product from the line's own snapshots. Nothing reads today's catalog for history.

const TZ = "Asia/Dhaka";
const SEPT = resolveBusinessRange({ from: "2026-09-01", to: "2026-09-30" }, TZ, new Date("2026-09-30T12:00:00Z"));
const sum = (key: string, orders: OrderFact[], r: BusinessRange = SEPT) => sumOf(contributions(key, orders, r));
const d12 = new Date("2026-09-12T06:00:00Z");
const d14 = new Date("2026-09-14T06:00:00Z");
const d20 = new Date("2026-09-20T06:00:00Z");

describe("recorded cost (G1)", () => {
  it("COGS = units × recorded cost; margin = merchandise ex VAT − recorded cost", () => {
    const o = deliveredCod(d12, { lines: [line({ unitPrice: T(1150), quantity: 2, unitCostSnapshot: T(400) })], subtotal: T(2300), total: T(2360), taxAmount: T(300), shippingTaxAmount: 0 });
    expect(sum("cogs", [o])).toBe(T(800));
    expect(sum("gross_margin", [o])).toBe(T(2300 - 300 - 800)); // VAT is not margin
  });

  it("uncosted lines are unknown: excluded from both sides of the margin and reported as line coverage", () => {
    const o = deliveredCod(d12, {
      lines: [line({ unitPrice: T(1000), unitCostSnapshot: T(400) }), line({ unitPrice: T(1000), unitCostSnapshot: null })],
      subtotal: T(2000),
      total: T(2060),
    });
    expect(sum("cogs", [o])).toBe(T(400));
    expect(sum("gross_margin", [o])).toBe(T(1000 - 400)); // the uncosted line's revenue is not margin at zero cost
    expect(snapshotCoverage("cogs", [o], SEPT)).toEqual({ recorded: 1, missing: 1 });
    expect(snapshotCoverage("gross_margin", [o], SEPT)).toEqual({ recorded: 1, missing: 1 });
  });

  it("returned units reverse their recorded cost and margin; unknown-cost returns reverse nothing", () => {
    const o = deliveredCod(d12, {
      status: "RETURNED",
      lines: [line({ variantId: "rv", unitPrice: T(1000), quantity: 2, unitCostSnapshot: T(400) })],
      subtotal: T(2000),
      total: T(2060),
      returnMovements: [{ variantId: "rv", units: 1, at: d20 }],
    });
    expect(sum("cogs", [o])).toBe(T(400));
    expect(sum("gross_margin", [o])).toBe(T(600));
    const uncosted = { ...o, lines: o.lines.map((l) => ({ ...l, unitCostSnapshot: null })) };
    expect([sum("cogs", [uncosted]), sum("gross_margin", [uncosted])]).toEqual([0, 0]);
  });

  it("a cancellation after realisation reverses COGS and margin too (P5-2)", () => {
    const o = paidOnline(d12, { status: "CANCELLED", cancelledAt: d14, lines: [line({ unitCostSnapshot: T(400) })] });
    expect(sum("cogs", [o], resolveBusinessRange({ from: "2026-09-12", to: "2026-09-12" }, TZ, new Date("2026-09-30T12:00:00Z")))).toBe(T(400));
    expect(sum("cogs", [o])).toBe(0);
  });
});

describe("attribution snapshots (G2–G4)", () => {
  const key = (o: OrderFact, g: "category" | "brand" | "product") => groupKeyOf(contributions("gross_merchandise_sales", [o], SEPT)[0]!, g, TZ);

  it("category, brand and product come from the line's snapshot", () => {
    const o = deliveredCod(d12, { lines: [line({ productId: "pSnap", categoryId: "catSnap", categoryName: "Shirts (then)", brand: "Brand (then)" })] });
    expect([key(o, "category"), key(o, "brand"), key(o, "product").key]).toEqual([{ key: "catSnap", label: "Shirts (then)" }, { key: "Brand (then)", label: "Brand (then)" }, "pSnap"]);
  });

  it("no brand recorded → Unbranded; a line written before Phase 6 → Not recorded (category and brand), never reconstructed", () => {
    const unbranded = deliveredCod(d12, { lines: [line({ brand: null })] });
    expect(key(unbranded, "brand").key).toBe("unbranded");
    const legacy = deliveredCod(d12, { lines: [line({ attributionRecorded: false, categoryId: null, categoryName: null, brand: null })] });
    expect([key(legacy, "category").key, key(legacy, "brand").key]).toEqual(["not_recorded", "not_recorded"]);
  });
});
