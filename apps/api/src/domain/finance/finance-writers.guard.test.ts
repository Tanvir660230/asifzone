import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Financial Core Phase 1 (docs/FINANCE_PHASE_1.md §4.1) architecture guards: one writer for journals, one writer for the
// financial audit trail, finance tables written only by the finance domain, and no commerce/UI code posting directly.

const SRC = join(__dirname, "..", "..");
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const code = (file: string) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l))
    .join("\n");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") && !/^test-(fixtures|routes|guard|setup)\.ts$/.test(name) ? [path] : [];
  });
}
const ALL = sourceFiles(SRC);

const WRITE = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";
const prismaWrite = (model: string) => new RegExp(`\\b${model}\\s*\\.\\s*${WRITE}\\b`);
const sqlWrite = (table: string) => new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE)\\s+"${table}"`, "i");
const writers = (model: string, table: string) => ALL.filter((f) => prismaWrite(model).test(code(f)) || sqlWrite(table).test(code(f))).map(rel).sort();

describe("financial core — architecture guards", () => {
  it("only journal.service.ts writes JournalEntry / JournalLine (the central posting service)", () => {
    expect(writers("journalEntry", "JournalEntry")).toEqual(["domain/finance/journal.service.ts"]);
    expect(writers("journalLine", "JournalLine")).toEqual(["domain/finance/journal.service.ts"]);
  });

  it("only finance-audit.ts writes the financial audit trail", () => {
    expect(writers("financeAuditEntry", "FinanceAuditEntry")).toEqual(["domain/finance/finance-audit.ts"]);
  });

  it("finance tables are written only inside domain/finance", () => {
    const MODELS: Array<[string, string]> = [
      ["financeBusiness", "FinanceBusiness"], ["financeBrand", "FinanceBrand"], ["ledgerAccount", "LedgerAccount"], ["accountMapping", "AccountMapping"],
      ["financialAccount", "FinancialAccount"], ["financialPeriod", "FinancialPeriod"], ["financeSequence", "FinanceSequence"], ["financialEvent", "FinancialEvent"],
      ["openingBalanceBatch", "OpeningBalanceBatch"], ["openingBalanceLine", "OpeningBalanceLine"], ["openingInventoryItem", "OpeningInventoryItem"], ["reconciliationRun", "ReconciliationRun"],
    ];
    const offenders = MODELS.flatMap(([m, t]) => writers(m, t).filter((f) => !f.startsWith("domain/finance/")).map((f) => `${f}: ${t}`));
    expect(offenders).toEqual([]);
  });

  it("code outside the finance domain reaches the ledger only through events (recordFinancialEvent) or the finance API", () => {
    const POSTING = /\b(postJournalInTx|createDraftJournal|postDraftJournal|reverseJournal|correctJournal|postOpeningBalances)\b/;
    const offenders = ALL.filter((f) => !rel(f).startsWith("domain/finance/") && rel(f) !== "modules/finance/finance.routes.ts" && POSTING.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("finance code opens transactions only through financeTransaction (commit-time checks must surface as errors)", () => {
    const offenders = ALL.filter((f) => rel(f).startsWith("domain/finance/") && rel(f) !== "domain/finance/finance-tx.ts" && /\$transaction\(/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("finance services never turn the database's immutability off (maintenance purge is test-only)", () => {
    const offenders = ALL.filter((f) => /finance\.maintenance_purge/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the guards detect what they forbid (self-test)", () => {
    expect(prismaWrite("journalEntry").test("await tx.journalEntry.update({ where })")).toBe(true);
    expect(prismaWrite("journalEntry").test("await tx.journalEntry.findMany({ where })")).toBe(false);
    expect(sqlWrite("JournalLine").test('UPDATE "JournalLine" SET debit = 1')).toBe(true);
    expect(sqlWrite("JournalLine").test('TRUNCATE "JournalLine"')).toBe(true);
  });
});
