import { describe, it, expect } from "vitest";
import { canCompleteRefund, checkManualPayment, checkRefund, derivePaymentPosition, money, type PaymentLedgerInput } from "@clothing-brand/shared";

// docs/PAYMENT_LEDGER.md §3–§4 — the one derivation of an order's payment position. Amounts in paisa.
const T = (n: number) => money(n * 100, "BDT");
function pos(over: Partial<Omit<PaymentLedgerInput, "total">> & { total?: number; paid?: number[]; refunded?: number[]; requested?: number[] } = {}) {
  const { total = 1000, paid = [], refunded = [], requested = [], ...rest } = over;
  return derivePaymentPosition({
    currency: "BDT",
    total: T(total),
    paymentMethod: "COD",
    orderStatus: "CONFIRMED",
    settlements: paid.map(T),
    failedAttempts: 0,
    refundsCompleted: refunded.map(T),
    refundsRequested: requested.map(T),
    ...rest,
  });
}
const major = (m: { amount: number }) => m.amount / 100;

describe("payment ledger engine — status (§4, PL-1)", () => {
  it("nothing received → UNPAID; a failed attempt with nothing received → FAILED", () => {
    expect(pos().status).toBe("UNPAID");
    expect(pos({ failedAttempts: 2 }).status).toBe("FAILED");
  });
  it("a later success wins over earlier failures → PAID", () => {
    expect(pos({ paid: [1000], failedAttempts: 1 }).status).toBe("PAID");
  });
  it("partial receipt is not PAID (balance still due) — PARTIALLY_PAID since the order-adjustments phase", () => {
    const p = pos({ paid: [400] });
    expect(p.status).toBe("PARTIALLY_PAID");
    expect(major(p.amountDue)).toBe(600);
  });
  it("a zero-amount settlement settles a zero total (free exchange / total-0 COD at delivery)", () => {
    expect(pos({ total: 0, paid: [0] }).status).toBe("PAID");
    expect(pos({ total: 0 }).status).toBe("UNPAID");
  });
  it("partial refund → PARTIALLY_REFUNDED; the full amount → REFUNDED (PL-3)", () => {
    expect(pos({ paid: [1000], refunded: [200] }).status).toBe("PARTIALLY_REFUNDED");
    expect(pos({ paid: [1000], refunded: [200, 800] }).status).toBe("REFUNDED");
  });
  it("refunding only a duplicate payment leaves the order PAID", () => {
    const p = pos({ paid: [1000, 1000], refunded: [1000] });
    expect(p.status).toBe("PAID");
    expect(major(p.overpaid)).toBe(0);
  });
  it("a requested (not yet paid out) refund doesn't change the status", () => {
    expect(pos({ paid: [1000], requested: [200] }).status).toBe("PAID");
  });
});

describe("payment ledger engine — amounts", () => {
  it("refundable = paid − refunded − requested, never negative (PL-2)", () => {
    expect(major(pos({ paid: [1000], refunded: [300], requested: [200] }).refundable)).toBe(500);
    expect(major(pos({ paid: [100], refunded: [100] }).refundable)).toBe(0);
  });
  it("amountDue never goes negative and refunds never create a debt", () => {
    expect(major(pos({ paid: [1500] }).amountDue)).toBe(0);
    expect(major(pos({ paid: [1000], refunded: [1000] }).amountDue)).toBe(0);
  });
  it("codToCollect = balance due of an open COD order; 0 once prepaid, 0 for online and closed orders (PL-6)", () => {
    expect(major(pos().codToCollect)).toBe(1000);
    expect(major(pos({ paid: [300] }).codToCollect)).toBe(700);
    expect(major(pos({ paid: [1000] }).codToCollect)).toBe(0);
    expect(major(pos({ paymentMethod: "SSLCOMMERZ" }).codToCollect)).toBe(0);
    expect(major(pos({ orderStatus: "CANCELLED" }).codToCollect)).toBe(0);
  });
  it("refundDue: all net receipts for a cancelled/returned order, only the overpayment otherwise, net of requests", () => {
    expect(major(pos({ orderStatus: "CANCELLED", paid: [1000], refunded: [300] }).refundDue)).toBe(700);
    expect(major(pos({ orderStatus: "RETURNED", paid: [1000], requested: [1000] }).refundDue)).toBe(0);
    expect(major(pos({ paid: [1000, 1000] }).refundDue)).toBe(1000);
    expect(major(pos({ paid: [1000] }).refundDue)).toBe(0);
  });
});

describe("payment ledger engine — command checks", () => {
  it("checkRefund: positive and ≤ refundable", () => {
    const p = pos({ paid: [1000], refunded: [400] });
    expect(checkRefund(p, T(600))).toEqual({ ok: true });
    expect(checkRefund(p, money(60001, "BDT"))).toMatchObject({ ok: false, code: "EXCEEDS_REFUNDABLE" });
    expect(checkRefund(p, T(0))).toMatchObject({ ok: false, code: "NOT_POSITIVE" });
  });
  it("checkManualPayment: positive and ≤ amount due (no manual overpayment)", () => {
    const p = pos({ paid: [400] });
    expect(checkManualPayment(p, T(600))).toEqual({ ok: true });
    expect(checkManualPayment(p, T(601))).toMatchObject({ ok: false, code: "EXCEEDS_AMOUNT_DUE" });
  });
  it("canCompleteRefund keeps Σ completed refunds ≤ Σ paid", () => {
    expect(canCompleteRefund(pos({ paid: [1000], refunded: [800] }), T(200))).toBe(true);
    expect(canCompleteRefund(pos({ paid: [1000], refunded: [800] }), T(201))).toBe(false);
  });
  it("is exact in minor units (no float drift)", () => {
    const p = derivePaymentPosition({
      currency: "BDT", total: money(30, "BDT"), paymentMethod: "COD", orderStatus: "CONFIRMED",
      settlements: [money(10, "BDT"), money(20, "BDT")], failedAttempts: 0, refundsCompleted: [], refundsRequested: [],
    });
    expect(p.status).toBe("PAID");
    expect(p.amountDue.amount).toBe(0);
  });
});

describe("payment ledger engine — return charge (docs/PAYMENT_LEDGER.md §5a)", () => {
  it("a refused parcel's return charge is not order money: a returned order owes none of it back", () => {
    const p = pos({ orderStatus: "RETURNED", returnCharges: [T(120)] });
    expect(major(p.returnCharge)).toBe(120);
    expect(major(p.paid)).toBe(0);
    expect(major(p.refundDue)).toBe(0);
    expect(major(p.refundable)).toBe(0);
    expect(p.status).toBe("UNPAID");
  });
  it("order money next to it is still owed back in full", () => {
    const p = pos({ orderStatus: "CANCELLED", paid: [500], returnCharges: [T(120)] });
    expect(major(p.refundDue)).toBe(500);
    expect(major(p.refundable)).toBe(500);
    expect(major(p.returnCharge)).toBe(120);
  });
  it("never pays for an open order or counts as an overpayment", () => {
    const p = pos({ orderStatus: "PARTIALLY_DELIVERED", paid: [1000], returnCharges: [T(120)] });
    expect(p.status).toBe("PAID");
    expect(major(p.overpaid)).toBe(0);
    expect(major(pos({ returnCharges: [T(120)] }).amountDue)).toBe(1000);
  });
  it("absent → zero", () => {
    expect(major(pos().returnCharge)).toBe(0);
  });
});

describe("payment ledger engine — nothing more to collect", () => {
  it("a closed order (cancelled / returned / refunded) owes nothing more, whatever it was charged", () => {
    for (const orderStatus of ["CANCELLED", "RETURNED", "REFUNDED"]) {
      expect(major(pos({ orderStatus }).amountDue)).toBe(0);
      expect(major(pos({ orderStatus, paid: [300] }).amountDue)).toBe(0);
    }
  });
  it("a partial delivery: the courier is done — it collects nothing more; what the customer kept is still due", () => {
    const p = pos({ orderStatus: "PARTIALLY_DELIVERED", returned: [T(600)] });
    expect(major(p.codToCollect)).toBe(0);
    expect(major(p.amountDue)).toBe(400);
    expect(major(pos({ orderStatus: "PARTIALLY_DELIVERED", returned: [T(600)], paid: [400] }).amountDue)).toBe(0);
    expect(pos({ orderStatus: "PARTIALLY_DELIVERED", returned: [T(600)], paid: [400] }).status).toBe("PAID");
  });
});
