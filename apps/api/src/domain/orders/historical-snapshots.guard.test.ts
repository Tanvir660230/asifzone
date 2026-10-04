import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Phase 6 (docs/PHASE_6_AUDIT.md): the order-line snapshots have ONE writer (domain/orders/line-snapshots.ts, called from
// the two transactions that write order lines), and no historical-metrics code reads today's catalog cost or attribution.

const SRC = join(__dirname, "..", "..");
const SNAPSHOT_COLUMNS = /\b(unitCostSnapshot|productIdSnapshot|categoryIdSnapshot|categoryNameSnapshot|brandSnapshot)\s*:/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

/** Code only: comment lines are dropped so documentation may name the columns. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join("\n");
}

describe("historical order-line snapshots — guard", () => {
  it("only line-snapshots.ts assigns the snapshot columns; the fact loader only selects them", () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      // The writer; the loader maps DB rows onto the engine's LineFact; the fixture builds in-memory facts for tests.
      .filter((f) => !["domain/orders/line-snapshots.ts", "domain/metrics/facts.repository.ts", "lib/metrics-facts.fixture.ts"].includes(f))
      .filter((f) => {
        const text = code(join(SRC, f));
        if (!SNAPSHOT_COLUMNS.test(text)) return false;
        // The loader's `select: { unitCostSnapshot: true, … }` is a read, not a write.
        const stripped = text.replace(/\b(unitCostSnapshot|productIdSnapshot|categoryIdSnapshot|categoryNameSnapshot|brandSnapshot)\s*:\s*true\b/g, "");
        // config/prisma.ts omits the cost column (`omit: { orderItem: { unitCostSnapshot: true } }`) — also not a write.
        return SNAPSHOT_COLUMNS.test(stripped);
      });
    expect(offenders).toEqual([]);
  });

  it("the order-fact loader never reads today's cost, category or brand for history", () => {
    const loader = code(join(SRC, "domain/metrics/facts.repository.ts"));
    const orderFacts = loader.slice(loader.indexOf("export async function loadOrderFacts"), loader.indexOf("export async function loadPositionFacts"));
    expect(orderFacts).not.toMatch(/costPrice|category\s*:\s*\{|brand\s*:\s*true|categoryId\s*:\s*true/);
  });
});
