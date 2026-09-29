import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// INV-4 (docs/INVENTORY_INVARIANTS.md): inventory.service.ts is the only application code that may change
// ProductVariant.stock or write StockMovement rows. This scans the API source so a new direct write fails CI.

const SRC = join(__dirname, "..", "..");
const ALLOWED = new Set([join("modules", "inventory", "inventory.service.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "test-fixtures.ts" ? [path] : [];
  });
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["stock increment/decrement", /\bstock\s*:\s*\{\s*(increment|decrement)\b/],
  ["stockMovement write", /\bstockMovement\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/],
  ["raw SQL update of stock", /UPDATE\s+"ProductVariant"\s+SET[^;`]*\bstock\b/i],
  // A `stock:` key inside a productVariant.update/updateMany/upsert call's data.
  ["variant update writing stock", /productVariant\s*\.\s*(update|updateMany|upsert)\s*\(\s*\{[^;]*?data\s*:\s*\{[^}]*\bstock\s*:/s],
];

describe("inventory single-writer guard", () => {
  it("no file other than inventory.service.ts mutates stock or the stock ledger", () => {
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
    const sample = `await tx.productVariant.update({ where: { id }, data: { stock: { decrement: 2 } } });`;
    expect(FORBIDDEN.some(([, p]) => p.test(sample))).toBe(true);
    expect(FORBIDDEN.some(([, p]) => p.test(`await tx.stockMovement.create({ data })`))).toBe(true);
  });
});
