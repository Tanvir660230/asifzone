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
      // Phase 2 (docs/FINANCE_PHASE_2.md)
      ["treasuryMovement", "TreasuryMovement"], ["bankTransaction", "BankTransaction"], ["bankTransactionMatch", "BankTransactionMatch"],
      ["statementImport", "StatementImport"], ["bankReconciliation", "BankReconciliation"],
      // Phase 3 (docs/FINANCE_PHASE_3.md)
      ["financeException", "FinanceException"], ["clearingSettlement", "ClearingSettlement"], ["clearingSettlementLine", "ClearingSettlementLine"],
      ["financeSyncState", "FinanceSyncState"],
      // Phase 4 (docs/FINANCE_PHASE_4.md)
      ["supplier", "Supplier"], ["taxCode", "TaxCode"], ["inventoryValuationEntry", "InventoryValuationEntry"], ["inventoryCostState", "InventoryCostState"],
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

  it("Phase 2: a money account's balance is never stored — there is no balance column to drift from the ledger", () => {
    const schema = readFileSync(join(SRC, "..", "prisma", "schema.prisma"), "utf8");
    for (const model of ["FinancialAccount", "LedgerAccount", "FinanceBrand", "FinanceBusiness"]) {
      const body = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(schema)?.[1] ?? "";
      expect(body.length, model).toBeGreaterThan(0);
      expect(body.split("\n").filter((l) => /^\s+\w*[bB]alance\w*\s+(Decimal|Int|Float|BigInt)/.test(l)), model).toEqual([]);
    }
  });

  it("Phase 2: money moves only as treasury movements posted by journal.service — no money code writes journals itself", () => {
    const treasury = code(join(SRC, "domain", "finance", "treasury.service.ts"));
    expect(treasury).toMatch(/postJournalInTx\(/);
    expect(treasury).not.toMatch(/journal(Entry|Line)\s*\.\s*(create|update|delete)/);
  });

  it("Phase 3: the commerce projector and settlements only read commerce — they never write a commerce table", () => {
    const COMMERCE = /\b(order|orderItem|orderStatusHistory|payment|paymentSession|refund|returnRequest|customerCreditEntry|stockMovement|productVariant|product|customer)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    const offenders = ["commerce-accounting.service.ts", "settlements.service.ts", "commerce-setup.service.ts", "commerce-posting-rules.ts", "finance-exceptions.service.ts"]
      .filter((f) => COMMERCE.test(code(join(SRC, "domain", "finance", f))));
    expect(offenders).toEqual([]);
  });

  it("Phase 3: commerce posting rules name mapping keys, never an account id", () => {
    const rules = code(join(SRC, "domain", "finance", "commerce-posting-rules.ts"));
    expect(rules).not.toMatch(/accountId\s*:/);
  });

  it("Phase 4: only costing.service.ts writes the valuation ledger — there is one costing engine", () => {
    expect(writers("inventoryValuationEntry", "InventoryValuationEntry")).toEqual(["domain/finance/costing.service.ts"]);
    expect(writers("inventoryCostState", "InventoryCostState")).toEqual(["domain/finance/costing.service.ts"]);
  });

  it("Phase 4: no stored supplier balance — a supplier is owed what the AP ledger says", () => {
    const schema = readFileSync(join(SRC, "..", "prisma", "schema.prisma"), "utf8");
    const body = /^model Supplier \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
    expect(body.length).toBeGreaterThan(0);
    expect(body.split("\n").filter((l) => /^\s+\w*([bB]alance|[oO]utstanding|[pP]ayable)\w*\s+(Decimal|Int|Float|BigInt)/.test(l))).toEqual([]);
  });

  it("the guards detect what they forbid (self-test)", () => {
    expect(prismaWrite("journalEntry").test("await tx.journalEntry.update({ where })")).toBe(true);
    expect(prismaWrite("journalEntry").test("await tx.journalEntry.findMany({ where })")).toBe(false);
    expect(sqlWrite("JournalLine").test('UPDATE "JournalLine" SET debit = 1')).toBe(true);
    expect(sqlWrite("JournalLine").test('TRUNCATE "JournalLine"')).toBe(true);
  });
});
