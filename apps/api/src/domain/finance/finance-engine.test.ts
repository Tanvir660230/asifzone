import { describe, it, expect } from "vitest";
import {
  ACCOUNT_MAPPING_KEYS,
  DEFAULT_CHART_OF_ACCOUNTS,
  checkJournal,
  defaultNormalBalance,
  eventJournalKey,
  financialEventEnvelopeSchema,
  fiscalYearLabel,
  fiscalYearOf,
  journalFingerprint,
  monthPeriod,
  openingInventoryItemsSchema,
  reverseLines,
  signedBalance,
  trialBalance,
  validateChartTemplate,
} from "@clothing-brand/shared";

// Financial Core Phase 1 (docs/FINANCE_PHASE_1.md): the pure double-entry rules, chart template, periods and event contract.

describe("journal amounts engine", () => {
  it("accepts a balanced journal and totals it", () => {
    const r = checkJournal([{ debit: 1500, credit: 0 }, { debit: 0, credit: 1000 }, { debit: 0, credit: 500 }]);
    expect(r).toMatchObject({ ok: true, totalDebit: 1500, totalCredit: 1500, issues: [] });
  });

  it.each([
    ["one line", [{ debit: 100, credit: 0 }], "TOO_FEW_LINES"],
    ["unbalanced", [{ debit: 100, credit: 0 }, { debit: 0, credit: 99 }], "UNBALANCED"],
    ["both sides on a line", [{ debit: 100, credit: 100 }, { debit: 0, credit: 0 }], "LINE_BOTH_SIDES"],
    ["a zero line", [{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }, { debit: 0, credit: 0 }], "LINE_NO_AMOUNT"],
    ["negative amount", [{ debit: -100, credit: 0 }, { debit: 0, credit: -100 }], "NEGATIVE_AMOUNT"],
    ["fractional minor units", [{ debit: 10.5, credit: 0 }, { debit: 0, credit: 10.5 }], "NOT_INTEGER"],
  ])("rejects %s", (_label, lines, code) => {
    const r = checkJournal(lines);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain(code);
  });

  it("a reversal mirrors every line and nets the original to zero", () => {
    const lines = [{ accountId: "a", debit: 700, credit: 0 }, { accountId: "b", debit: 0, credit: 700 }];
    const rev = reverseLines(lines);
    expect(rev).toEqual([{ accountId: "a", debit: 0, credit: 700 }, { accountId: "b", debit: 700, credit: 0 }]);
    expect(trialBalance([...lines, ...rev]).rows.every((r) => r.netDebit === 0 && r.netCredit === 0)).toBe(true);
  });

  it("trial balance nets per account and stays balanced over balanced journals", () => {
    const tb = trialBalance([
      { accountId: "cash", debit: 1000, credit: 0 },
      { accountId: "capital", debit: 0, credit: 1000 },
      { accountId: "cash", debit: 0, credit: 300 },
      { accountId: "rent", debit: 300, credit: 0 },
    ]);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(1000);
    expect(tb.rows.find((r) => r.accountId === "cash")).toMatchObject({ netDebit: 700, netCredit: 0 });
  });

  it("signed balance follows the account's normal side", () => {
    expect(signedBalance(1000, 300, "DEBIT")).toBe(700);
    expect(signedBalance(1000, 300, "CREDIT")).toBe(-700);
    expect(defaultNormalBalance("ASSET")).toBe("DEBIT");
    expect(defaultNormalBalance("REVENUE")).toBe("CREDIT");
    expect(defaultNormalBalance("COGS")).toBe("DEBIT");
  });

  it("the fingerprint ignores line order but not amounts, accounts, date or brand", () => {
    const base = { entryDate: "2026-08-01", currency: "BDT", lines: [{ accountId: "a", debit: 5, credit: 0 }, { accountId: "b", debit: 0, credit: 5 }] };
    const fp = journalFingerprint(base);
    expect(journalFingerprint({ ...base, lines: [...base.lines].reverse() })).toBe(fp);
    expect(journalFingerprint({ ...base, entryDate: "2026-08-02" })).not.toBe(fp);
    expect(journalFingerprint({ ...base, lines: [{ accountId: "a", debit: 6, credit: 0 }, { accountId: "b", debit: 0, credit: 6 }] })).not.toBe(fp);
    expect(journalFingerprint({ ...base, lines: base.lines.map((l) => ({ ...l, brandId: "x" })) })).not.toBe(fp);
  });
});

describe("chart of accounts template", () => {
  it("is structurally valid and maps every mapping key exactly once", () => {
    expect(validateChartTemplate(DEFAULT_CHART_OF_ACCOUNTS)).toEqual([]);
    const mapped = DEFAULT_CHART_OF_ACCOUNTS.flatMap((a) => (a.mapping ? [a.mapping] : []));
    expect([...mapped].sort()).toEqual([...ACCOUNT_MAPPING_KEYS].sort());
  });

  it("the validator catches broken templates (self-test)", () => {
    const broken = [...DEFAULT_CHART_OF_ACCOUNTS, { code: "1610", name: "dup", type: "ASSET" as const, parent: "9999" }];
    const problems = validateChartTemplate(broken);
    expect(problems.some((p) => p.includes("duplicate code 1610"))).toBe(true);
    expect(problems.some((p) => p.includes("parent 9999 missing"))).toBe(true);
  });
});

describe("financial periods", () => {
  it("months and fiscal years (Bangladesh: July start)", () => {
    expect(monthPeriod("2026-02-14")).toEqual({ startDate: "2026-02-01", endDate: "2026-02-28" });
    expect(monthPeriod("2028-02-03").endDate).toBe("2028-02-29");
    expect(fiscalYearOf("2026-06-30", 7)).toBe(2025);
    expect(fiscalYearOf("2026-07-01", 7)).toBe(2026);
    expect(fiscalYearOf("2026-07-01", 1)).toBe(2026);
    expect(fiscalYearLabel(2026, 7)).toBe("2026-27");
    expect(() => monthPeriod("2026-02-30")).toThrow(RangeError);
  });
});

describe("financial event contract", () => {
  const envelope = {
    contract: "finance.event",
    contractVersion: 1,
    businessKey: "main",
    brandKey: "asifzone",
    source: { installId: "asifzone", system: "commerce", entityType: "Order", entityId: "ord_1" },
    event: { type: "order.realised", version: 1, key: "order:ord_1:realised", occurredAt: "2026-08-01T10:00:00+06:00" },
    financialDate: "2026-08-01",
    currency: "BDT",
    payload: { amount: 1000 },
  };

  it("carries business, brand, source installation, source entity, event, version, financial date and currency", () => {
    expect(financialEventEnvelopeSchema.safeParse(envelope).success).toBe(true);
    for (const drop of ["businessKey", "brandKey", "source", "event", "financialDate", "currency"] as const) {
      const { [drop]: _omit, ...rest } = envelope;
      expect(financialEventEnvelopeSchema.safeParse(rest).success, drop).toBe(false);
    }
    expect(financialEventEnvelopeSchema.safeParse({ ...envelope, financialDate: "2026-02-30" }).success).toBe(false);
    expect(financialEventEnvelopeSchema.safeParse({ ...envelope, contractVersion: 2 }).success).toBe(false);
  });

  it("the journal's idempotency key is derived from the event identity", () => {
    expect(eventJournalKey("asifzone", "order:ord_1:realised")).toBe(eventJournalKey("asifzone", "order:ord_1:realised"));
    expect(eventJournalKey("asifzone", "k")).not.toBe(eventJournalKey("nasihamart", "k"));
  });
});

describe("opening inventory input", () => {
  const item = { sku: "S-1", name: "Shirt", quantity: 3, valuationMethod: "NONE", valuationDate: "2026-07-01" };
  it("a MISSING cost can't carry an invented unit cost or value", () => {
    expect(openingInventoryItemsSchema.safeParse({ items: [{ ...item, valuationStatus: "MISSING" }] }).success).toBe(true);
    expect(openingInventoryItemsSchema.safeParse({ items: [{ ...item, valuationStatus: "MISSING", unitCost: 100 }] }).success).toBe(false);
    expect(openingInventoryItemsSchema.safeParse({ items: [{ ...item, valuationStatus: "MISSING", valuationAmount: 300 }] }).success).toBe(false);
  });
  it("a KNOWN or ESTIMATED cost needs a value", () => {
    expect(openingInventoryItemsSchema.safeParse({ items: [{ ...item, valuationStatus: "ESTIMATED" }] }).success).toBe(false);
    expect(openingInventoryItemsSchema.safeParse({ items: [{ ...item, valuationStatus: "KNOWN", unitCost: 250 }] }).success).toBe(true);
  });
});
