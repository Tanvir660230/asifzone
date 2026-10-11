import { describe, it, expect } from "vitest";
import {
  checkRefund,
  derivePaymentPosition,
  money,
  type Money,
  type PaymentLedgerInput,
  type PaymentPosition,
} from "@clothing-brand/shared";

// Mutation tests (docs/PAYMENT_LEDGER.md §13). The invariant suite below encodes the business rules the Phase 4 audit
// found broken (PHASE_4_AUDIT §1.1). Each mutant re-introduces one of those defects on top of the canonical engine; the
// suite must reject every mutant and accept the canonical engine. If a mutant survives, the invariants are too weak.

type Engine = (i: PaymentLedgerInput) => PaymentPosition;
type RefundGate = (p: PaymentPosition, amount: Money) => boolean;

const T = (n: number) => money(n * 100, "BDT");
const input = (o: Partial<Omit<PaymentLedgerInput, "total">> & { paid?: number[]; refunded?: number[]; requested?: number[]; total?: number }): PaymentLedgerInput => {
  const { paid = [], refunded = [], requested = [], total = 1000, ...rest } = o;
  return {
    currency: "BDT", total: T(total), paymentMethod: "COD", orderStatus: "CONFIRMED",
    settlements: paid.map(T), failedAttempts: 0, refundsCompleted: refunded.map(T), refundsRequested: requested.map(T), ...rest,
  };
};

/** The invariant suite: returns the rules an engine breaks. */
function violations(engine: Engine, allowRefund: RefundGate): string[] {
  const out: string[] = [];
  const check = (rule: string, ok: boolean) => { if (!ok) out.push(rule); };

  // P4 — a partial refund is not a full refund, and the rest can still be refunded.
  const partial = engine(input({ paid: [1000], refunded: [200] }));
  check("P4 partial refund status", partial.status === "PARTIALLY_REFUNDED");
  check("P4 remainder refundable", allowRefund(partial, T(800)));
  check("PL-3 full refund status", engine(input({ paid: [1000], refunded: [1000] })).status === "REFUNDED");

  // P3 — refunds are capped by money received, cumulatively, including requested (owed) refunds.
  check("P3 cap vs received", !allowRefund(engine(input({ paid: [600], total: 1000 })), T(700)));
  check("P3 cap vs earlier refunds", !allowRefund(engine(input({ paid: [1000], refunded: [900] })), T(200)));
  check("P5 requested refund reserves money", !allowRefund(engine(input({ paid: [1000], requested: [900] })), T(200)));
  check("P3 nothing received", !allowRefund(engine(input({})), T(1)));

  // P6 — the courier collects the balance due, not the total.
  check("P6 prepaid COD collects 0", engine(input({ paid: [1000] })).codToCollect.amount === 0);
  check("P6 part-prepaid COD collects the rest", engine(input({ paid: [250] })).codToCollect.amount === T(750).amount);
  check("P6 online order collects 0", engine(input({ paymentMethod: "EPS_PG" })).codToCollect.amount === 0);
  check("P6 cancelled order collects 0", engine(input({ orderStatus: "CANCELLED" })).codToCollect.amount === 0);

  // PL-1 status rules.
  check("PL-1 failed only when nothing received", engine(input({ paid: [1000], failedAttempts: 1 })).status === "PAID");
  check("PL-1 duplicate refunded stays PAID", engine(input({ paid: [1000, 1000], refunded: [1000] })).status === "PAID");
  check("PL-1 partial receipt not PAID", engine(input({ paid: [999] })).status !== "PAID");
  check("PL-1 free exchange PAID", engine(input({ total: 0, paid: [0] })).status === "PAID");

  // Floors: no negative debts, no refund creating a debt.
  check("floor amountDue", engine(input({ paid: [1500] })).amountDue.amount === 0);
  check("refund creates no debt", engine(input({ paid: [1000], refunded: [1000] })).amountDue.amount === 0);

  // P9/P4-4 — the refund queue amount for a cancelled order is everything still held.
  check("refundDue cancelled", engine(input({ orderStatus: "CANCELLED", paid: [1000], refunded: [400] })).refundDue.amount === T(600).amount);
  return out;
}

const canonical: Engine = derivePaymentPosition;
const canonicalGate: RefundGate = (p, a) => checkRefund(p, a).ok;

// Each mutant = the canonical result with one defect re-introduced.
const mutants: Array<[string, Engine, RefundGate]> = [
  ["partial refund stored as REFUNDED (pre-Phase-4 refundOrderPayment)", (i) => {
    const p = canonical(i);
    return p.refunded.amount > 0 ? { ...p, status: "REFUNDED" } : p;
  }, canonicalGate],
  ["refund capped by order total, not by money received", canonical, (p, a) => a.amount > 0 && a.amount <= p.paid.amount + p.amountDue.amount],
  ["refund cap ignores earlier refunds", canonical, (p, a) => a.amount > 0 && a.amount <= p.paid.amount - p.refundPending.amount],
  ["refund cap ignores requested refunds", canonical, (p, a) => a.amount > 0 && a.amount <= p.paid.amount - p.refunded.amount],
  ["COD amount = total whatever was paid (pre-Phase-4 courier)", (i) => {
    const p = canonical(i);
    return { ...p, codToCollect: i.paymentMethod === "COD" ? i.total : money(0, i.currency) };
  }, canonicalGate],
  ["COD collected even for closed orders", (i) => {
    const p = canonical(i);
    return { ...p, codToCollect: i.paymentMethod === "COD" ? p.amountDue : p.codToCollect };
  }, canonicalGate],
  ["FAILED even after a success", (i) => {
    const p = canonical(i);
    return i.failedAttempts > 0 ? { ...p, status: "FAILED" } : p;
  }, canonicalGate],
  ["PAID compared on gross paid (duplicate refund → partially refunded)", (i) => {
    const p = canonical(i);
    const refundedSome = p.refunded.amount > 0 && p.refunded.amount < p.paid.amount;
    return refundedSome ? { ...p, status: "PARTIALLY_REFUNDED" } : p;
  }, canonicalGate],
  ["any settlement counts as PAID", (i) => {
    const p = canonical(i);
    return p.settled && p.refunded.amount === 0 ? { ...p, status: "PAID" } : p;
  }, canonicalGate],
  ["amountDue not floored", (i) => {
    const p = canonical(i);
    return { ...p, amountDue: money(i.total.amount - p.paid.amount, i.currency) };
  }, canonicalGate],
  ["refundDue ignores cancellation (overpayment only)", (i) => {
    const p = canonical(i);
    return { ...p, refundDue: p.overpaid };
  }, canonicalGate],
];

describe("payment ledger — mutation tests", () => {
  it("the canonical engine satisfies every invariant", () => {
    expect(violations(canonical, canonicalGate)).toEqual([]);
  });
  it.each(mutants)("kills mutant: %s", (_name, engine, gate) => {
    expect(violations(engine, gate).length).toBeGreaterThan(0);
  });
});
