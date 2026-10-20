import { describe, it, expect } from "vitest";
import { parsePayoutDetail, parsePayoutList } from "./courier-payouts.service";

// Steadfast's payout responses are known only from a third-party SDK — the parser accepts the likely shapes and reports
// what it can't read instead of guessing.

describe("payout list", () => {
  it("reads a bare array, { data: [] } and { data: { data: [] } } (paginated)", () => {
    expect(parsePayoutList([{ id: 1, amount: "1,200.50", created_at: "2026-10-01 09:00:00" }]).payouts).toEqual([{ id: "1", amount: 1200.5, date: "2026-10-01" }]);
    expect(parsePayoutList({ status: 200, data: [{ id: 2, amount: 10 }] }).payouts).toEqual([{ id: "2", amount: 10, date: null }]);
    expect(parsePayoutList({ data: { data: [{ payment_id: "3", paid_amount: 5 }], current_page: 1 } }).payouts).toEqual([{ id: "3", amount: 5, date: null }]);
  });
  it("counts rows without an id or amount, and refuses a shape it can't read", () => {
    expect(parsePayoutList([{ id: 1 }, { amount: 2 }, { id: 3, amount: 3 }])).toMatchObject({ unreadable: 2, payouts: [{ id: "3" }] });
    expect(() => parsePayoutList({ message: "Unauthorized" })).toThrow(/import the payout file/);
  });
});

describe("payout detail", () => {
  it("charge = total_charge, else delivery + COD + return charges, else collected − net", () => {
    const d = parsePayoutDetail({
      data: {
        amount: 2000,
        consignments: [
          { consignment_id: 11, invoice: "ORD-1", cod_amount: 1000, total_charge: 70 },
          { consignment_id: 12, cod_amount: 1100, delivery_charge: 60, cod_charge: 11 },
          { cid: 13, collected_amount: 0, return_charge: 30 },
          { consignment_id: 14, cod_amount: 500, payable_amount: 440 },
          { invoice: null, foo: 1 },
        ],
      },
    });
    expect(d.amount).toBe(2000);
    expect(d.unreadable).toBe(1);
    expect(d.lines).toEqual([
      { consignmentId: "11", invoice: "ORD-1", collected: 1000, charge: 70 },
      { consignmentId: "12", invoice: null, collected: 1100, charge: 71 },
      { consignmentId: "13", invoice: null, collected: 0, charge: 30 },
      { consignmentId: "14", invoice: null, collected: 500, charge: 60 },
    ]);
  });
});
