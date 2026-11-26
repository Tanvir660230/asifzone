import { describe, expect, it } from "vitest";
import { formatCourierError } from "./courier-errors";

describe("formatCourierError", () => {
  it("explains a network failure and keeps the raw message", () => {
    const out = formatCourierError("  fetch failed: ETIMEDOUT  ");
    expect(out.summary).toMatch(/couldn't reach/i);
    expect(out.raw).toBe("fetch failed: ETIMEDOUT");
  });

  it("points rejected credentials at Settings", () => {
    expect(formatCourierError("HTTP 401 Unauthorized").action).toMatch(/Settings/);
  });

  it("recognises rate limits, phone and address problems", () => {
    expect(formatCourierError("429 Too Many Requests").summary).toMatch(/rate limit/i);
    expect(formatCourierError("recipient_phone is invalid").summary).toMatch(/phone/i);
    expect(formatCourierError("recipient_address is required").summary).toMatch(/address/i);
  });

  it("falls back to a generic message for anything else", () => {
    const out = formatCourierError("something odd");
    expect(out.summary).toBe("Courier sync failed");
    expect(out.raw).toBe("something odd");
  });
});
