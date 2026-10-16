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

  it("handles a thrown non-Error", () => {
    const c: CapturedError = { error: "plain string", errorClass: "unexpected", correlationId: null, operation: null };
    expect(fingerprintError(c)).toMatch(/^[0-9a-f]{40}$/);
  });
});
