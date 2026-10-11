import { describe, it, expect } from "vitest";
import { statementColumnMappingSchema, financialAccountMetadataSchema, bankTransactionCreateSchema } from "@clothing-brand/shared";
import { parseStatement, parseStatementAmount, parseStatementDate } from "./statement-parser";

// Financial Core Phase 2 (docs/FINANCE_PHASE_2.md §5): the CSV statement reader is driven by a column mapping, never by one
// bank's layout, and gives every row a stable dedupe key.

const OPTS = { dateFormat: "DD/MM/YYYY" as const, amountConvention: "POSITIVE_IS_MONEY_IN" as const, hasHeader: true, skipRows: 0 };
const MAP = { date: "Txn Date", description: "Narration", reference: "Ref", debit: "Withdrawal", credit: "Deposit", balance: "Balance" };

describe("statement dates and amounts", () => {
  it.each([
    ["2026-08-05", "YYYY-MM-DD", "2026-08-05"],
    ["05/08/2026", "DD/MM/YYYY", "2026-08-05"],
    ["08/05/2026", "MM/DD/YYYY", "2026-08-05"],
    ["05-08-2026", "DD-MM-YYYY", "2026-08-05"],
    ["05.08.2026", "DD.MM.YYYY", "2026-08-05"],
    ["05-Aug-2026", "DD-MMM-YYYY", "2026-08-05"],
    ["5 Aug 26", "DD MMM YYYY", "2026-08-05"],
  ] as const)("%s as %s", (raw, format, expected) => {
    expect(parseStatementDate(raw, format)).toBe(expected);
  });

  it("refuses impossible or mis-formatted dates", () => {
    expect(parseStatementDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseStatementDate("2026-08-05", "DD/MM/YYYY")).toBeNull();
    expect(parseStatementDate("hello", "YYYY-MM-DD")).toBeNull();
  });

  it.each([
    ["1,234.50", "1234.50"],
    ["৳ 1,234.50", "1234.50"],
    ["BDT 20", "20"],
    ["(500.00)", "-500.00"],
    ["-500", "-500"],
    ["500.00 Dr", "-500.00"],
    ["500.00 CR", "500.00"],
    ["", null],
    ["0.00", "0"],
  ])("%s → %s", (raw, expected) => {
    expect(parseStatementAmount(raw)).toBe(expected);
  });

  it("refuses text that isn't an amount", () => {
    expect(() => parseStatementAmount("12abc")).toThrow(/isn't an amount/);
  });
});

describe("statement parsing", () => {
  const csv = [
    "ACME BANK LTD — Statement",
    "Txn Date,Narration,Ref,Withdrawal,Deposit,Balance",
    "01/08/2026,Opening transfer,T1,,\"10,000.00\",\"60,000.00\"",
    "05/08/2026,Cash withdrawal,C1,4000,,56000",
    "05/08/2026,Bank charge,,150,,55850",
    "05/08/2026,Bank charge,,150,,55850",
    "06/08/2026,Bad row,,,,",
    "31/02/2026,Bad date,,10,,1",
    "",
    "Total,,,,,",
  ].join("\n");

  it("reads rows through the mapping, skipping a letterhead and footer, and reports bad rows instead of guessing", () => {
    const r = parseStatement(csv, MAP, { ...OPTS, skipRows: 1 }, "BDT");
    expect(r.rows.map((x) => [x.line, x.transactionDate, x.debit, x.credit, x.balance])).toEqual([
      [3, "2026-08-01", 0, 1_000_000, 6_000_000],
      [4, "2026-08-05", 400_000, 0, 5_600_000],
      [5, "2026-08-05", 15_000, 0, 5_585_000],
      [6, "2026-08-05", 15_000, 0, 5_585_000],
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([7, 8]);
  });

  it("gives identical rows different, stable dedupe keys (occurrence), and the same keys on a re-read", () => {
    const a = parseStatement(csv, MAP, { ...OPTS, skipRows: 1 }, "BDT").rows;
    const b = parseStatement(csv, MAP, { ...OPTS, skipRows: 1 }, "BDT").rows;
    expect(a.map((r) => r.dedupeKey)).toEqual(b.map((r) => r.dedupeKey));
    expect(new Set(a.map((r) => r.dedupeKey)).size).toBe(4);
    expect(a[2]!.dedupeKey.replace(/:\d+$/, "")).toBe(a[3]!.dedupeKey.replace(/:\d+$/, ""));
  });

  it("a single signed amount column, either convention, and the bank's own transaction id as the key", () => {
    const signed = "Date;Details;Amount;Id\n2026-08-01;Settlement;2500;SSL-1\n2026-08-02;Refund;-300;SSL-2\n";
    const map = { date: "Date", description: "Details", amount: "Amount", externalId: "Id" };
    const inFirst = parseStatement(signed, map, { ...OPTS, dateFormat: "YYYY-MM-DD" }, "BDT").rows;
    expect(inFirst.map((r) => [r.credit, r.debit, r.dedupeKey])).toEqual([[250_000, 0, "ext:SSL-1"], [0, 30_000, "ext:SSL-2"]]);
    const outFirst = parseStatement(signed, map, { ...OPTS, dateFormat: "YYYY-MM-DD", amountConvention: "POSITIVE_IS_MONEY_OUT" }, "BDT").rows;
    expect(outFirst.map((r) => [r.credit, r.debit])).toEqual([[0, 250_000], [30_000, 0]]);
  });

  it("columns by position when the file has no header; a mapping that names a missing column is refused", () => {
    const r = parseStatement("05/08/2026,Fee,,75\n", { date: "1", description: "2", credit: "3", debit: "4" }, { ...OPTS, hasHeader: false }, "BDT");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ debit: 7_500, credit: 0, description: "Fee" });
    const bad = parseStatement(csv, { ...MAP, balance: "Running" }, { ...OPTS, skipRows: 1 }, "BDT");
    expect(bad.rows).toEqual([]);
    expect(bad.errors[0]!.message).toMatch(/Running/);
  });

  it("the mapping must name an amount column or both debit and credit — not a mix", () => {
    expect(statementColumnMappingSchema.safeParse({ date: "d", amount: "a" }).success).toBe(true);
    expect(statementColumnMappingSchema.safeParse({ date: "d", debit: "x", credit: "y" }).success).toBe(true);
    expect(statementColumnMappingSchema.safeParse({ date: "d", debit: "x" }).success).toBe(false);
    expect(statementColumnMappingSchema.safeParse({ date: "d", amount: "a", debit: "x", credit: "y" }).success).toBe(false);
  });
});

describe("treasury input rules", () => {
  it("account metadata never holds credentials", () => {
    expect(financialAccountMetadataSchema.safeParse({ routingNumber: "123", merchantId: "M-1" }).success).toBe(true);
    for (const key of ["password", "PIN", "apiKey", "api_key", "secret", "otp", "token", "cvv", "credentials"]) {
      expect(financialAccountMetadataSchema.safeParse({ [key]: "x" }).success, key).toBe(false);
    }
  });

  it("a statement line is either money in or money out", () => {
    const base = { financialAccountId: "fa", transactionDate: "2026-08-01", description: "x" };
    expect(bankTransactionCreateSchema.safeParse({ ...base, debit: 10 }).success).toBe(true);
    expect(bankTransactionCreateSchema.safeParse({ ...base, debit: 10, credit: 5 }).success).toBe(false);
    expect(bankTransactionCreateSchema.safeParse({ ...base }).success).toBe(false);
  });
});
