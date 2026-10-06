import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// CR-1 (docs/ORDER_ADJUSTMENTS.md §4): customer-credit.service.ts is the only application code that writes
// CustomerCreditEntry rows — the store balance can't be changed by any other path (there is no balance column to set).

const SRC = join(__dirname, "..", "..");
const ALLOWED = new Set([join("domain", "credit", "customer-credit.service.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "test-fixtures.ts" ? [path] : [];
  });
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["credit entry write", /\bcustomerCreditEntry\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/],
  ["raw SQL write of CustomerCreditEntry", /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"CustomerCreditEntry"/i],
];

describe("store-credit ledger single-writer guard", () => {
  it("no file other than customer-credit.service.ts writes CustomerCreditEntry", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel) || ALLOWED.has(rel.split(sep).join("/"))) continue;
      const text = readFileSync(file, "utf8");
      for (const [label, pattern] of FORBIDDEN) if (pattern.test(text)) offenders.push(`${rel}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself detects a direct write (self-test)", () => {
    const hit = (sample: string) => FORBIDDEN.some(([, p]) => p.test(sample));
    expect(hit("await tx.customerCreditEntry.create({ data })")).toBe(true);
    expect(hit('UPDATE "CustomerCreditEntry" SET amount = 1')).toBe(true);
    expect(hit("await tx.customerCreditEntry.findUnique({ where })")).toBe(false);
  });
});
