import { describe, it, expect } from "vitest";
import type { CapturedError } from "./error-capture";
import { fingerprintError } from "./error-fingerprint";

function captured(message: string, stack: string, context?: Record<string, unknown>): CapturedError {
  const error = new Error(message);
  error.stack = `Error: ${message}\n${stack}`;
  return { error, errorClass: "unexpected", correlationId: null, operation: null, context };
}

const FRAME_A = "    at loadOrder (C:\\app\\apps\\api\\src\\modules\\orders\\order.service.ts:120:11)";
const FRAME_B = "    at loadCart (C:\\app\\apps\\api\\src\\modules\\cart\\cart.service.ts:40:3)";

describe("fingerprintError", () => {
  it("groups the same error whatever ids or quoted values its message carries", () => {
    expect(fingerprintError(captured("Order AZ-1042 not found", FRAME_A))).toBe(fingerprintError(captured("Order AZ-2210 not found", FRAME_A)));
    expect(fingerprintError(captured('Unknown slug "black-panjabi"', FRAME_A))).toBe(fingerprintError(captured('Unknown slug "red-saree"', FRAME_A)));
  });

  it("ignores line and column numbers, so a redeploy keeps the group", () => {
    const moved = FRAME_A.replace(":120:11", ":131:7");
    expect(fingerprintError(captured("boom", FRAME_A))).toBe(fingerprintError(captured("boom", moved)));
  });

  it("splits errors thrown from different places", () => {
    expect(fingerprintError(captured("boom", FRAME_A))).not.toBe(fingerprintError(captured("boom", FRAME_B)));
  });

  it("splits website errors from server errors", () => {
    expect(fingerprintError(captured("boom", FRAME_A, { source: "web" }))).not.toBe(fingerprintError(captured("boom", FRAME_A)));
  });

  it("finds the throw site in the compiled API that runs in production", () => {
    const distA = "    at loadOrder (/app/apps/api/dist/modules/orders/order.service.js:120:11)";
    const distB = "    at loadCart (/app/apps/api/dist/modules/cart/cart.service.js:40:3)";
    expect(fingerprintError(captured("boom", distA))).not.toBe(fingerprintError(captured("boom", distB)));
  });

  it("skips library frames and uses the store's own code", () => {
    const lib = "    at Object.query (/app/node_modules/.pnpm/@prisma+client/node_modules/@prisma/client/dist/index.js:1:1)";
    expect(fingerprintError(captured("boom", `${lib}\n${FRAME_A}`))).toBe(fingerprintError(captured("boom", FRAME_A)));
  });

  it("keeps a website error in one group across deploys", () => {
    const before = "    at Card (https://asifzone.com/_next/static/chunks/app/(storefront)/page-3f2a9c1d.js:1:2000)";
    const after = "    at Card (https://asifzone.com/_next/static/chunks/app/(storefront)/page-77b0e4aa.js:1:2310)";
    expect(fingerprintError(captured("boom", before, { source: "web" }))).toBe(fingerprintError(captured("boom", after, { source: "web" })));
    const chunkBefore = "    at a (https://asifzone.com/_next/static/chunks/8518-c42f59a71a9d04a1.js:1:1)";
    const chunkAfter = "    at a (https://asifzone.com/_next/static/chunks/9127-0edf7b45633dfc85.js:1:1)";
    expect(fingerprintError(captured("boom", chunkBefore, { source: "web" }))).toBe(fingerprintError(captured("boom", chunkAfter, { source: "web" })));
  });

  it("reads Firefox / Safari stacks, which have no header line", () => {
    const err = new Error("boom");
    err.stack = "renderCard@https://asifzone.com/_next/static/chunks/app/page-3f2a9c1d.js:1:20\nouter@https://asifzone.com/_next/static/chunks/main-aa11bb22.js:1:5";
    const other = new Error("boom");
    other.stack = "renderCard@https://asifzone.com/_next/static/chunks/main-aa11bb22.js:1:20\nouter@https://asifzone.com/_next/static/chunks/main-aa11bb22.js:1:5";
    const c = (e: Error): CapturedError => ({ error: e, errorClass: "unexpected", correlationId: null, operation: null, context: { source: "web" } });
    expect(fingerprintError(c(err))).not.toBe(fingerprintError(c(other)));
  });

  it("splits server-render failures by their digest", () => {
    const msg = "An error occurred in the Server Components render.";
    expect(fingerprintError(captured(msg, FRAME_A, { source: "web", digest: "111" }))).not.toBe(fingerprintError(captured(msg, FRAME_A, { source: "web", digest: "222" })));
  });

  it("handles a thrown non-Error", () => {
    const c: CapturedError = { error: "plain string", errorClass: "unexpected", correlationId: null, operation: null };
    expect(fingerprintError(c)).toMatch(/^[0-9a-f]{40}$/);
  });
});
