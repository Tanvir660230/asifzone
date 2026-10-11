import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Manufacturing architecture guards (docs/MANUFACTURING.md §1, blueprint I-7): manufacturing tables are written only by
// domain/manufacturing, and manufacturing never moves stock, values it or posts journals itself — quantity goes through
// inventory.service, value through costing.service, the ledger through financial events.

const SRC = join(__dirname, "..", "..");
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const code = (file: string) => readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l)).join("\n");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") && !/^test-(fixtures|routes|guard|setup)\.ts$/.test(name) ? [path] : [];
  });
}
const ALL = sourceFiles(SRC);
const WRITE = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";

describe("manufacturing — architecture guards", () => {
  it("manufacturing tables are written only inside domain/manufacturing", () => {
    const MODELS: Array<[string, string]> = [
      ["billOfMaterials", "BillOfMaterials"], ["billOfMaterialsLine", "BillOfMaterialsLine"], ["productionOrder", "ProductionOrder"],
      ["productionOrderLine", "ProductionOrderLine"], ["productionMaterialLine", "ProductionMaterialLine"],
      ["productionCostCategory", "ProductionCostCategory"], ["productionPlannedCost", "ProductionPlannedCost"],
    ];
    const offenders = MODELS.flatMap(([m, t]) =>
      ALL.filter((f) => new RegExp(`\b${m}\s*\.\s*${WRITE}\b`).test(code(f)) || new RegExp(`(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"${t}"`, "i").test(code(f)))
        .map(rel)
        .filter((f) => !f.startsWith("domain/manufacturing/"))
        .map((f) => `${f}: ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  it("manufacturing never writes stock movements, valuation or journals directly", () => {
    const FORBIDDEN = new RegExp(`\b(stockMovement|inventoryValuationEntry|inventoryCostState|journalEntry|journalLine)\s*\.\s*${WRITE}\b|finance_persist_valuations|\b(postJournalInTx|applyCostOperation|recordValuationsInTx)\b`);
    const offenders = ALL.filter((f) => rel(f).startsWith("domain/manufacturing/") && FORBIDDEN.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});
