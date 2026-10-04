import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// PL-4 (docs/PAYMENT_LEDGER.md §2): payment-ledger.service.ts is the only application code that writes Payment rows,
// Refund rows or Order.paymentStatus. This scans the API source so a new direct write fails CI.

const SRC = join(__dirname, "..", "..");
const ALLOWED = new Set([join("domain", "payments", "payment-ledger.service.ts")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "test-fixtures.ts" ? [path] : [];
  });
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["payment write", /\bpayment\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/],
  ["refund write", /\brefund\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/],
  ["raw SQL write of Payment/Refund", /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"(Payment|Refund)"/i],
  ["raw SQL update of paymentStatus", /UPDATE\s+"Order"\s+SET[^;`]*"paymentStatus"/i],
  // A `paymentStatus:` key inside an order create/update call's data (filters in `where:` are reads and allowed).
  ["order write setting paymentStatus", /order\s*\.\s*(create|update|updateMany|upsert)\s*\(\s*\{[^;]*?data\s*:\s*\{[^}]*\bpaymentStatus\s*:/s],
];

describe("payment ledger single-writer guard", () => {
  it("no file other than payment-ledger.service.ts writes Payment, Refund or Order.paymentStatus", () => {
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
    expect(hit(`await prisma.order.update({ where: { id }, data: { paymentStatus: "PAID" } });`)).toBe(true);
    expect(hit(`await tx.refund.create({ data })`)).toBe(true);
    expect(hit(`await prisma.payment.create({ data })`)).toBe(true);
    expect(hit('UPDATE "Order" SET "paymentStatus" = \'PAID\'')).toBe(true);
    // A read filter is not a write.
    expect(hit(`prisma.order.count({ where: { paymentStatus: "PAID" } })`)).toBe(false);
  });
});
