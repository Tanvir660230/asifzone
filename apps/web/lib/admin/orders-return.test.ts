import { beforeEach, describe, expect, it } from "vitest";
import { ordersListHref, rememberOrdersListUrl, safeOrdersListHref } from "./orders-return";

// Order Operations plan, phase 2: leaving the Orders list and coming back lands on the same page and filters.

// The unit suite runs in node: a Map stands in for the tab's sessionStorage.
const store = new Map<string, string>();
globalThis.sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  clear: () => store.clear(),
} as unknown as Storage;

describe("orders list return URL", () => {
  beforeEach(() => sessionStorage.clear());

  it("returns to the list exactly as it was left, minus the open drawer", () => {
    rememberOrdersListUrl("/admin/orders?page=5&size=50&f.status=CONFIRMED&sort=-total&q=rahim&open=ord_1");
    expect(ordersListHref()).toBe("/admin/orders?page=5&size=50&f.status=CONFIRMED&sort=-total&q=rahim");
  });

  it("falls back to the bare list with nothing stored, and never leaves the Orders list", () => {
    expect(ordersListHref()).toBe("/admin/orders");
    expect(safeOrdersListHref("https://evil.example/admin/orders")).toBe("/admin/orders");
    expect(safeOrdersListHref("/admin/orders/print-labels")).toBe("/admin/orders");
    expect(safeOrdersListHref("//evil.example")).toBe("/admin/orders");
    // Order history is a list too: an order opened from it goes back there.
    expect(safeOrdersListHref("/admin/orders/history?q=0171")).toBe("/admin/orders/history?q=0171");
    expect(safeOrdersListHref("/admin/orders/historyx")).toBe("/admin/orders");
    sessionStorage.setItem("admin:orders-list-url", "/admin/customers?page=2");
    expect(ordersListHref()).toBe("/admin/orders");
  });
});
