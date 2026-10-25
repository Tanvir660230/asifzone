import { describe, it, expect } from "vitest";
import { ADMIN_ROLES, PERMISSIONS, permissionsForRole } from "@clothing-brand/shared";

// Admin audit phase 2 (owner, 2026-10-25): a MANAGER runs the store and the books day to day — orders, stock, products,
// customers, marketing, finance entries — but never staff accounts, settings, partner / payroll money, closing a month,
// big approvals, permanent deletes, repairs or confirming AI changes. The Claude staff account moves to it.

const NEVER = [
  "users.manage", "settings.manage", "finance.sensitive", "finance.configure", "finance.period_close", "finance.approve_high_value",
  "ai.execute", "orders.delete", "catalog.purge", "promotions.purge", "ops.repair", "inventory.approve",
] as const;

describe("MANAGER role", () => {
  it("is a role", () => {
    expect(ADMIN_ROLES).toContain("MANAGER");
  });

  it("holds every permission except the owner's own", () => {
    const manager = new Set(permissionsForRole("MANAGER"));
    for (const p of NEVER) expect(manager.has(p), p).toBe(false);
    expect([...PERMISSIONS].filter((p) => !manager.has(p)).sort()).toEqual([...NEVER].sort());
  });

  it("can do the everyday work STAFF can, plus the books", () => {
    const manager = new Set(permissionsForRole("MANAGER"));
    for (const p of permissionsForRole("STAFF")) expect(manager.has(p), p).toBe(true);
    for (const p of ["finance.read", "finance.transact", "finance.post", "finance.reconcile", "ap.manage", "costing.read"] as const) expect(manager.has(p), p).toBe(true);
  });
});
