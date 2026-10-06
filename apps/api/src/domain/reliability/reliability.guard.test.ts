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
    for (const f of ["providers/sms/bulksmsbd.ts", "providers/email/resend.ts", "providers/events/meta-capi.ts"]) {
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
    expect(read(API, "providers/sms/bulksmsbd.ts")).toMatch(/signal: AbortSignal\.timeout\(SMS_TIMEOUT_MS\)/);
    expect(read(API, "providers/email/resend.ts")).toMatch(/Promise\.race\(\[/);
    expect(read(API, "providers/events/meta-capi.ts")).toMatch(/AbortSignal\.timeout/);
    const steadfast = read(API, "providers/courier/steadfast.ts");
    // One raw fetch (inside steadfastFetch, which applies the timeout) — every endpoint goes through it.
    expect(steadfast.match(/\bawait fetch\(/g)).toHaveLength(1);
    expect(steadfast).toMatch(/signal: AbortSignal\.timeout\(STEADFAST_TIMEOUT_MS\)/);
  });

  it("courier bookings claim the order before calling Steadfast", () => {
    const code = read(API, "modules/courier/courier.service.ts");
    const single = code.slice(code.indexOf("export async function bookOrderWithSteadfast"), code.indexOf("export interface BulkCourierBookResult"));
    expect(single.indexOf("claimCourierBooking(")).toBeGreaterThan(-1);
    expect(single.indexOf("courier.createShipment(")).toBeGreaterThan(-1);
    expect(single.indexOf("claimCourierBooking(")).toBeLessThan(single.indexOf("courier.createShipment("));
    const bulk = code.slice(code.indexOf("export async function bookOrdersWithSteadfastBulk"));
    expect(bulk.indexOf("courier.createShipments(")).toBeGreaterThan(-1);
    expect(bulk.indexOf("claimCourierBooking(")).toBeLessThan(bulk.indexOf("courier.createShipments("));
  });

  it("an exchange replacement is conditional on the original units actually being released", () => {
    expect(read(API, "modules/return-requests/return-request.service.ts")).toMatch(/if \(returnedUnits !== originalItem\.quantity\)/);
  });

  it("every web money-creating call sends an Idempotency-Key", () => {
    expect(read(WEB, "app/(storefront)/checkout/page.tsx")).toMatch(/createOrder\(payload, idempotencyKeyFor\("checkout", payload\)\)/);
    expect(read(WEB, "app/admin/(shell)/orders/new/page.tsx")).toMatch(/createManualOrder\(payload, idempotencyKeyFor\("manual-order", payload\)\)/);
    // The order detail's refund / payment commands (one hook, used by the drawer and the full page).
    const detail = read(WEB, "components/admin/orders/detail/use-order-detail-commands.ts");
    expect(detail).toMatch(/createRefund\(orderId, input, idempotencyKeyFor\(`refund:\$\{orderId\}`, input\)\)/);
    expect(detail).toMatch(/recordPayment\(orderId, input, idempotencyKeyFor\(`payment:\$\{orderId\}`, input\)\)/);
    expect(read(WEB, "lib/api-client.ts")).toMatch(/"Idempotency-Key": idempotencyKey/);
  });
});
