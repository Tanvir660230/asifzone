import { describe, it, expect } from "vitest";
import { buildPayoutLines, parsePayoutDetail, parsePayoutList } from "./courier-payouts.service";

// Steadfast's payout responses, as the live API sends them (checked 2026-10-21; field names only, figures invented in the
// same relation the real ones have: amount − due_bills − charges = total).

const listed = {
  status: 200, alertClass: "success", message: "ok",
  payments: [{ payment_id: "SFC-1", amount: 2300, method: "Bkash", due_bills: 260, paid_bills: 0, charges: 20, total: 2020, status_label: "paid", created_at: "2026-08-21 11:39:57", ready_at: "x", paid_at: "2026-08-21 15:59:59" }],
};
const detail = {
  status: 200, alertClass: "success", message: "ok",
  payment: {
    ...listed.payments[0],
    consignments: [
      { consignment_id: 11, invoice: "ORD-1", cod_amount: 1000, status: "delivered" },
      { consignment_id: 12, invoice: "ORD-2", cod_amount: 900, status: "partial_delivered" },
      { consignment_id: 13, invoice: "ORD-3", cod_amount: 800, status: "cancelled" },
      { consignment_id: 14, invoice: "ORD-4", cod_amount: 700, status: "delivered" },
    ],
  },
};

describe("payout list and detail (the live shape)", () => {
  it("reads the payout's own totals: collected, charges, net paid and the paid date", () => {
    expect(parsePayoutList(listed)).toEqual({ unreadable: 0, payouts: [{ id: "SFC-1", net: 2020, gross: 2300, deliveryCharges: 260, codCharges: 20, date: "2026-08-21" }] });
  });
  it("reads each parcel's booked COD and status from payment.consignments", () => {
    const d = parsePayoutDetail(detail);
    expect(d.payout).toMatchObject({ id: "SFC-1", net: 2020, gross: 2300 });
    expect(d.lines.map((l) => [l.consignmentId, l.invoice, l.booked, l.status])).toEqual([["11", "ORD-1", 1000, "delivered"], ["12", "ORD-2", 900, "partial_delivered"], ["13", "ORD-3", 800, "cancelled"], ["14", "ORD-4", 700, "delivered"]]);
  });
  it("still reads an older shape with one amount and a charge per parcel; refuses one it can't read", () => {
    expect(parsePayoutList([{ id: 2, amount: 10 }]).payouts).toEqual([{ id: "2", net: 10, gross: null, deliveryCharges: null, codCharges: null, date: null }]);
    expect(parsePayoutDetail({ data: { consignments: [{ consignment_id: 5, cod_amount: 100, delivery_charge: 60, cod_charge: 1 }] } }).lines[0]).toMatchObject({ booked: 100, charge: 61 });
    expect(() => parsePayoutList({ message: "Unauthorized" })).toThrow(/import the payout file/);
  });
});

describe("building the lines from the payout's totals", () => {
  const parcels = detail.payment.consignments.map((c) => ({ booked: c.cod_amount * 100, status: c.status }));
  it("delivered parcels collect their booked COD, returned ones nothing, the partly delivered one the rest", () => {
    const lines = buildPayoutLines({ gross: 230000, charges: 28000 }, parcels, [1, 1, 1, 1]);
    expect(lines.map((l) => l.collected)).toEqual([100000, 60000, 0, 70000]);
    expect(lines.reduce((s, l) => s + l.collected, 0)).toBe(230000);
    expect(lines.reduce((s, l) => s + l.charge, 0)).toBe(28000);
  });
  it("charges follow the rate card's estimate for each parcel", () => {
    const lines = buildPayoutLines({ gross: 230000, charges: 28000 }, parcels, [7000, 7000, 3000, 11000]);
    expect(lines.map((l) => l.charge)).toEqual([7000, 7000, 3000, 11000]);
  });
  it("collected less than the delivered parcels were booked for: shared by their booked COD", () => {
    const lines = buildPayoutLines({ gross: 150000, charges: 0 }, parcels, [1, 1, 1, 1]);
    expect(lines.reduce((s, l) => s + l.collected, 0)).toBe(150000);
    expect(lines[2]!.collected).toBe(0);
  });
});
