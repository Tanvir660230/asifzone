import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// M-1 / M-4 (docs/METRICS_REGISTRY.md §8): business numbers come from the metrics engine only, and every time window goes
// through the business-time mechanism. This scans the code that used to hold ~40 private definitions
// (PHASE_5_METRICS_AUDIT §1) so a new ad-hoc revenue query, sale predicate or skewed window fails CI.

const SRC = join(__dirname, "..", "..");
const SCANNED = [
  "modules/analytics/analytics.service.ts",
  "modules/analytics/sales-analytics.service.ts",
  "modules/bi/bi.service.ts",
  "modules/customers/customer.service.ts",
  "modules/products/product.service.ts",
  "modules/payments/payments-overview.service.ts",
  "domain/metrics/metrics.service.ts",
  "domain/metrics/facts.repository.ts",
  "domain/metrics/consistency.service.ts",
];

/** Code only: comment lines are dropped so documentation may name the old patterns. */
function code(file: string): string {
  return readFileSync(join(SRC, file), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join("\n");
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ["revenue as SUM(total)", /SUM\(\s*(o\.)?total\s*\)/i],
  ["revenue as _sum.total", /_sum:\s*\{\s*total\s*:/],
  ["ad-hoc sale predicate (status != CANCELLED)", /status\s*!=\s*'CANCELLED'/],
  ["ad-hoc sale predicate (not CANCELLED)", /status:\s*\{\s*not:\s*"CANCELLED"\s*\}/],
  ["ad-hoc sale predicate (notIn CANCELLED/REFUNDED)", /notIn:\s*\[\s*"CANCELLED"/],
  ["raw NOW() window", /NOW\(\)/],
  // A timestamp column ("createdAt", "settledAt", …) compared with a bound value that isn't wrapped in utcInstant.
  ["bound instant compared without utcInstant", /"\w*At"\s*[<>]=?\s*\$\{(?!utcInstant\()/],
  ["hard-coded store timezone", /'Asia\/Dhaka'/],
  ["current tax rate applied to history", /taxIncludedIn\(/],
];

describe("metrics SSOT guard", () => {
  it("no scanned file reintroduces a private metric definition or a skewed time window", () => {
    const offenders: string[] = [];
    for (const file of SCANNED) {
      const text = code(file);
      for (const [label, pattern] of FORBIDDEN) if (pattern.test(text)) offenders.push(`${file}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the guard detects each pattern (self-test)", () => {
    const hits = (s: string) => FORBIDDEN.filter(([, p]) => p.test(s)).map(([l]) => l);
    expect(hits(`SELECT SUM(o.total) FROM "Order" o WHERE o.status != 'CANCELLED'`)).toHaveLength(2);
    expect(hits('WHERE "createdAt" >= NOW() - INTERVAL \'7 days\'')).toEqual(["raw NOW() window"]);
    expect(hits('WHERE "createdAt" >= ${since}')).toEqual(["bound instant compared without utcInstant"]);
    expect(hits('AND word_similarity(${query}, name) > ${THRESHOLD}')).toEqual([]);
    expect(hits('WHERE "createdAt" >= ${utcInstant(since)}')).toEqual([]);
    expect(hits(`prisma.order.aggregate({ where: { status: { not: "CANCELLED" } }, _sum: { total: true } })`)).toHaveLength(2);
  });
});
