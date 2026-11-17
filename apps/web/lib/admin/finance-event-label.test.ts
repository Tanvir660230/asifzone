import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FINANCE_EVENT_LABEL, financeEventLabel } from "./finance-event-label";

// Every accounting event the API can post (apps/api/src/domain/finance/*-posting-rules.ts) has a name in the owner's
// words, so Books › Sales accounting and an order's money section never show "finance.courier.charge_estimated".
const RULES_DIR = join(import.meta.dirname, "..", "..", "..", "api", "src", "domain", "finance");

function postedEventTypes(): string[] {
  const types = new Set<string>();
  for (const file of readdirSync(RULES_DIR).filter((f) => f.endsWith("-posting-rules.ts"))) {
    for (const m of readFileSync(join(RULES_DIR, file), "utf8").matchAll(/"((?:commerce|finance)\.[a-z_]+\.[a-z_]+)"/g)) if (m[1]) types.add(m[1]);
  }
  return [...types].sort();
}

describe("financeEventLabel", () => {
  it("names every event the posting rules can produce", () => {
    const types = postedEventTypes();
    expect(types.length).toBeGreaterThan(10);
    expect(types.filter((t) => !FINANCE_EVENT_LABEL[t])).toEqual([]);
  });

  it("uses the owner's words for a known event", () => {
    expect(financeEventLabel("finance.courier.charge_estimated")).toBe("Courier charge (estimate)");
    expect(financeEventLabel("commerce.order.recognised")).toBe("Sale and its cost recorded");
  });

  it("never shows a raw code for an event it doesn't know yet", () => {
    expect(financeEventLabel("finance.loan.interest_accrued")).toBe("Loan interest accrued");
    expect(financeEventLabel("odd")).toBe("Odd");
  });
});
