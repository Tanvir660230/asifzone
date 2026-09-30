import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Phase 9 (docs/PHASE_9_AUDIT.md) architecture guards — focused on the boundaries this phase established.

const API = join(__dirname, "..", "..");
const WEB = join(API, "..", "..", "web");
const read = (base: string, file: string) =>
  readFileSync(join(base, file), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*|\/\*)/.test(l))
    .join("\n");

describe("reliability — architecture guards", () => {
  it("provider adapters gate on liveProvidersEnabled(), never on NODE_ENV alone", () => {
    for (const f of ["lib/sms.ts", "lib/mailer.ts", "lib/meta/capi.ts"]) {
      const code = read(API, f);
      expect(code, f).toMatch(/liveProvidersEnabled\(\)/);
      expect(code, f).not.toMatch(/NODE_ENV === "test"/);
    }
  });

  it("the test setup installs the network guard, and e2e refuses an API with live providers", () => {
    expect(read(API, "test-setup.ts")).toMatch(/installNetworkGuard\(\)/);
    expect(read(API, "server.ts")).toMatch(/installNetworkGuard\(/);
    expect(read(WEB, "playwright.config.ts")).toMatch(/globalSetup:\s*"\.\/e2e\/global-setup\.ts"/);
    expect(read(WEB, "e2e/global-setup.ts")).toMatch(/liveProviders !== false/);
  });

  it("every outbound provider call is bounded by a timeout inside the outbox lease", () => {
    expect(read(API, "lib/sms.ts")).toMatch(/signal: AbortSignal\.timeout\(SMS_TIMEOUT_MS\)/);
    expect(read(API, "lib/mailer.ts")).toMatch(/Promise\.race\(\[/);
    expect(read(API, "lib/meta/capi.ts")).toMatch(/AbortSignal\.timeout/);
    const steadfast = read(API, "lib/steadfast.ts");
    // One raw fetch (inside steadfastFetch, which applies the timeout) — every endpoint goes through it.
    expect(steadfast.match(/\bawait fetch\(/g)).toHaveLength(1);
    expect(steadfast).toMatch(/signal: AbortSignal\.timeout\(STEADFAST_TIMEOUT_MS\)/);
  });

  it("courier bookings claim the order before calling Steadfast", () => {
    const code = read(API, "modules/courier/courier.service.ts");
    const single = code.slice(code.indexOf("export async function bookOrderWithSteadfast"), code.indexOf("export interface BulkCourierBookResult"));
    expect(single.indexOf("claimCourierBooking(")).toBeGreaterThan(-1);
    expect(single.indexOf("claimCourierBooking(")).toBeLessThan(single.indexOf("createSteadfastConsignment("));
    const bulk = code.slice(code.indexOf("export async function bookOrdersWithSteadfastBulk"));
    expect(bulk.indexOf("claimCourierBooking(")).toBeLessThan(bulk.indexOf("createBulkSteadfastConsignments("));
  });

  it("an exchange replacement is conditional on the original units actually being released", () => {
    expect(read(API, "modules/return-requests/return-request.service.ts")).toMatch(/if \(returnedUnits !== originalItem\.quantity\)/);
  });

  it("every web money-creating call sends an Idempotency-Key", () => {
    expect(read(WEB, "app/(storefront)/checkout/page.tsx")).toMatch(/createOrder\(payload, idempotencyKeyFor\("checkout", payload\)\)/);
    expect(read(WEB, "app/admin/(shell)/orders/new/page.tsx")).toMatch(/createManualOrder\(payload, idempotencyKeyFor\("manual-order", payload\)\)/);
    const panel = read(WEB, "components/admin/order-detail-panel.tsx");
    expect(panel).toMatch(/createRefund\(id, input, idempotencyKeyFor\(`refund:\$\{id\}`, input\)\)/);
    expect(panel).toMatch(/recordPayment\(id, input, idempotencyKeyFor\(`payment:\$\{id\}`, input\)\)/);
    expect(read(WEB, "lib/api-client.ts")).toMatch(/"Idempotency-Key": idempotencyKey/);
  });
});
