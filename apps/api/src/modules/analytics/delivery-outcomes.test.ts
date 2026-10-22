import { describe, it, expect } from "vitest";
import { breakdown, outcomeTotals, repeatRefusers, valueBand, weeklyTrend, type Parcel } from "./delivery-outcomes";

const day = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00+06:00`);
let n = 0;
const parcel = (p: Partial<Parcel> & Pick<Parcel, "outcome">): Parcel => ({
  orderId: `o${++n}`,
  bookedAt: day("2026-10-01"),
  endedAt: day("2026-10-03"),
  district: "Dhaka",
  division: "Dhaka",
  paymentMethod: "COD",
  value: 100_000,
  codValue: 100_000,
  phone: `0170000000${n % 10}`,
  customerName: "X",
  repeatCustomer: false,
  channel: "Facebook",
  products: [{ id: "p1", name: "Panjabi" }],
  ...p,
});

describe("delivery outcomes", () => {
  const parcels: Parcel[] = [
    parcel({ outcome: "delivered", district: "Dhaka" }),
    parcel({ outcome: "delivered", district: "Dhaka", endedAt: day("2026-10-02") }),
    parcel({ outcome: "refused", district: "Dhaka", codValue: 150_000 }),
    parcel({ outcome: "delivered", district: "Sylhet", endedAt: day("2026-10-06"), products: [{ id: "p1", name: "Panjabi" }, { id: "p2", name: "Cap" }] }),
    parcel({ outcome: "partial", district: "Sylhet", products: [{ id: "p2", name: "Cap" }] }),
    parcel({ outcome: "refused", district: "Sylhet", paymentMethod: "SSLCOMMERZ", codValue: 0, products: [{ id: "p2", name: "Cap" }] }),
  ];

  it("totals: success = delivered in full ÷ finished parcels; refused COD is the money that came back", () => {
    const t = outcomeTotals(parcels);
    expect(t).toMatchObject({ parcels: 6, delivered: 3, partial: 1, refused: 2, refusedCodValue: 150_000 });
    expect(t.successRate).toBeCloseTo(3 / 6);
    expect(t.refusalRate).toBeCloseTo(2 / 6);
    // booking → delivered, delivered parcels only: 2d, 1d, 5d
    expect(t.avgDaysToDeliver).toBeCloseTo((2 + 1 + 5) / 3);
  });

  it("breaks down by any dimension, worst refusal first among groups with enough parcels", () => {
    const rows = breakdown(parcels, (p) => [p.district], { minParcels: 1 });
    expect(rows.map((r) => r.key)).toEqual(["Dhaka", "Sylhet"]); // biggest first
    expect(rows.find((r) => r.key === "Sylhet")).toMatchObject({ parcels: 3, delivered: 1, partial: 1, refused: 1 });
  });

  it("an order with two products counts once for each product", () => {
    const rows = breakdown(parcels, (p) => p.products.map((x) => x.name), { minParcels: 1 });
    expect(rows.find((r) => r.key === "Cap")).toMatchObject({ parcels: 3, refused: 1, partial: 1, delivered: 1 });
    expect(rows.find((r) => r.key === "Panjabi")!.parcels).toBe(4);
  });

  it("hides groups too small to say anything when asked", () => {
    expect(breakdown(parcels, (p) => [p.district], { minParcels: 4 })).toEqual([]);
  });

  it("value bands", () => {
    expect(valueBand(49_900)).toBe("Under ৳500");
    expect(valueBand(50_000)).toBe("৳500–999");
    expect(valueBand(150_000)).toBe("৳1,000–1,999");
    expect(valueBand(250_000)).toBe("৳2,000+");
  });

  it("repeat refusers: phones that refused two or more parcels, worst first", () => {
    const list = repeatRefusers([
      parcel({ outcome: "refused", phone: "01711111111", customerName: "A" }),
      parcel({ outcome: "refused", phone: "+8801711111111", customerName: "A" }), // same phone, other spelling
      parcel({ outcome: "delivered", phone: "01711111111", customerName: "A" }),
      parcel({ outcome: "refused", phone: "01722222222" }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ phone: "01711111111", refused: 2, delivered: 1, name: "A" });
  });

  it("weekly trend buckets by the week the parcel finished (Monday first)", () => {
    const weeks = weeklyTrend(
      [parcel({ outcome: "delivered", endedAt: day("2026-10-05") }), parcel({ outcome: "refused", endedAt: day("2026-10-11") }), parcel({ outcome: "delivered", endedAt: day("2026-10-12") })],
      "Asia/Dhaka",
    );
    expect(weeks).toEqual([
      { week: "2026-10-05", parcels: 2, delivered: 1, partial: 0, refused: 1, successRate: 0.5 },
      { week: "2026-10-12", parcels: 1, delivered: 1, partial: 0, refused: 0, successRate: 1 },
    ]);
  });
});
