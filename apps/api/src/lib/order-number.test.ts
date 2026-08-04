import { describe, it, expect } from "vitest";
import { generateOrderNumber } from "./order-number";

describe("generateOrderNumber", () => {
  it("matches the ORD-YYYYMMDD-XXXX format", () => {
    expect(generateOrderNumber()).toMatch(/^ORD-\d{8}-[A-Z0-9]{4}$/);
  });

  it("embeds today's date", () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    expect(generateOrderNumber()).toContain(`ORD-${today}-`);
  });

  it("produces distinct values across calls", () => {
    const numbers = new Set(Array.from({ length: 20 }, () => generateOrderNumber()));
    expect(numbers.size).toBeGreaterThan(1);
  });
});
