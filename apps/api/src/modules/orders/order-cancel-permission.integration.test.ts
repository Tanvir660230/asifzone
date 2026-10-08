import { describe, it, expect, afterAll, vi } from "vitest";

// DR-5: cancelling is its own permission (orders.cancel). Both fixed roles hold it today (owner 2026-10-08: Owner and
// Staff may cancel), so to prove it's enforced this file runs as an admin missing just that one permission.
vi.mock("../../domain/auth/authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../domain/auth/authorization")>();
  return { ...actual, can: (identity: Parameters<typeof actual.can>[0], permission: Parameters<typeof actual.can>[1]) => permission !== "orders.cancel" && actual.can(identity, permission) };
});

import { ROLE_PERMISSIONS } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, placeOrder } from "../../test-fixtures";
import { aiTool } from "../../domain/ai/tools";

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("orders.cancel (DR-5)", () => {
  it("is held by both roles — the owner's decision", () => {
    expect(ROLE_PERMISSIONS.OWNER).toContain("orders.cancel");
    expect(ROLE_PERMISSIONS.STAFF).toContain("orders.cancel");
  });

  it("the assistant's cancel tool needs it", () => {
    expect(aiTool("cancel_order")?.permission).toBe("orders.cancel");
  });

  it("without it, an admin can still move an order along but not cancel it (single or bulk)", async () => {
    const product = await createStockedProduct({ stocks: [5] });
    const order = await placeOrder([{ variantId: product.variants[0]!.id, quantity: 1 }]);
    const admin = await asOwner();

    const cancel = await admin.patch(`/api/orders/${order.id}/status`, { status: "CANCELLED", note: "Customer asked to cancel" });
    expect(cancel.status).toBe(403);
    const bulk = await admin.post("/api/orders/bulk/status", { ids: [order.id], status: "CANCELLED", note: "Customer asked to cancel" });
    expect(bulk.status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING");

    const confirm = await admin.patch(`/api/orders/${order.id}/status`, { status: "CONFIRMED" });
    expect(confirm.status).toBe(200);
  });
});
