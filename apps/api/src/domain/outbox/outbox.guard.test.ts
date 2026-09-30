import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { OUTBOX_CONSUMERS } from "./consumers";

// Phase 8 (docs/PHASE_8_AUDIT.md) architecture guards: intents are written only by the outbox writer, inside a
// transaction; business-transaction modules never call a provider directly; consumers never write business truth; event
// names are versioned; every consumer states its idempotency boundary.

const SRC = join(__dirname, "..", "..");
const rel = (f: string) => relative(SRC, f).replace(/\\/g, "/");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

function code(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l))
    .join("\n");
}

const ALL = files(SRC);

describe("outbox — architecture guards", () => {
  it("only domain/outbox/outbox.ts creates outbox rows, and every call passes the transaction client", () => {
    const creators = ALL.filter((f) => /outboxEvent\.(create|createMany|upsert)\(/.test(code(f))).map(rel);
    expect(creators).toEqual(["domain/outbox/outbox.ts"]);
    const calls = ALL.flatMap((f) => [...code(f).matchAll(/(?<!function )recordOutboxEvents\(([^,]+),/g)].map((m) => `${rel(f)}: ${m[1]!.trim()}`));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c, c).toMatch(/: (tx|tx as AppTransactionClient)$/);
  });

  it("business-transaction modules never call an SMS/email/Meta provider or deliverer directly", () => {
    const BUSINESS = ["modules/orders/order.service.ts", "modules/payments/payment.service.ts", "domain/payments/payment-ledger.service.ts", "modules/return-requests/return-request.service.ts", "modules/inventory/inventory.service.ts"];
    const SENDERS = /\b(sendSms|sendMail|deliverCustomerOrderSms|deliverAdminOrderAlertSms|deliverPaymentConfirmationEmail|sendMetaEvent|processMetaPurchase|enqueueMetaPurchase|sendCustomerOrderSms|sendAdminOrderAlertSms|sendPaymentConfirmationEmail)\b/;
    const offenders = BUSINESS.filter((f) => SENDERS.test(code(join(SRC, f))));
    expect(offenders).toEqual([]);
  });

  it("only the outbox consumers call the order-side-effect deliverers", () => {
    const DELIVERERS = /\b(deliverCustomerOrderSms|deliverAdminOrderAlertSms|deliverPaymentConfirmationEmail|processMetaPurchase)\(/;
    const callers = ALL.filter((f) => DELIVERERS.test(code(f))).map(rel).sort();
    // lib files define them; jobs/meta-capi-worker only drains jobs queued before Phase 8.
    expect(callers).toEqual(["domain/outbox/consumers.ts", "jobs/meta-capi-worker.ts", "lib/meta/purchase.ts", "lib/order-mailer.ts", "lib/order-sms.ts"].sort());
  });

  it("outbox code never writes business truth (only OutboxEvent rows)", () => {
    const WRITE = /\b(prisma|tx)\.(?!outboxEvent\b)\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    const offenders = ALL.filter((f) => rel(f).startsWith("domain/outbox/") || rel(f) === "jobs/outbox-worker.ts").filter((f) => WRITE.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no new direct queue publishing outside jobs/ (existing campaign enqueue is the one documented exception)", () => {
    const offenders = ALL.filter((f) => !rel(f).startsWith("jobs/") && /\.add\(\s*["']\w+["']\s*,/.test(code(f)) && /new Queue\(/.test(code(f))).map(rel);
    expect(offenders).toEqual(["modules/campaigns/campaign.service.ts"]);
  });

  it("event names are versioned and every consumer states its idempotency boundary", () => {
    const entries = Object.entries(OUTBOX_CONSUMERS) as Array<[string, { eventTypes: readonly string[]; idempotency: string }]>;
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const [name, c] of entries) {
      expect(c.idempotency.length, `${name} idempotency`).toBeGreaterThan(20);
      expect(new Set(c.eventTypes).size, `${name} duplicate event types`).toBe(c.eventTypes.length);
      for (const t of c.eventTypes) expect(t, `${name}: ${t}`).toMatch(/^[a-z_]+\.[a-z_]+\.v\d+$/);
    }
  });
});
