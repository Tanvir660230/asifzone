import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../orders/order.service";
import { recordRefund } from "../../domain/payments/payment-ledger.service";
import { listPaymentTransactions, listRefunds } from "./payment-ledger-lists.service";

// Finance › Transactions / Refunds (Blueprint V2 §M): read-only lists over the ledger rows.

let admin: string;
let orderNumber: string;
beforeAll(async () => {
  admin = await ownerId();
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 1000 });
  const order = await createManualOrder(
    {
      items: [{ variantId: variants[0]!.id, quantity: 1 }],
      customerName: "Vitest Ledger List",
      customerPhone: "01712345673",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
      markPaid: true,
    } as never,
    admin,
  );
  trackOrder(order.id);
  orderNumber = order.orderNumber;
  await recordRefund(order.id, { amount: 200, reason: "goodwill", method: "bKash" }, admin);
});
afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("ledger lists", () => {
  it("transactions find the order's payment by order number, with who recorded it", async () => {
    const { items, total } = await listPaymentTransactions({ search: orderNumber, page: 1, pageSize: 20 });
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ provider: "MANUAL", status: "SUCCEEDED", amount: 1060, order: { orderNumber } });
    expect(items[0]!.recordedBy).toBeTruthy();
  });

  it("refunds list the refund with its reason and method", async () => {
    const { items } = await listRefunds({ search: orderNumber, page: 1, pageSize: 20 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount: 200, reason: "goodwill", method: "bKash", order: { orderNumber } });
  });

  it("filters by provider and status", async () => {
    const cod = await listPaymentTransactions({ search: orderNumber, provider: "COD", page: 1, pageSize: 20 });
    expect(cod.total).toBe(0);
    const requested = await listRefunds({ search: orderNumber, status: "REQUESTED", page: 1, pageSize: 20 });
    expect(requested.items.every((r) => r.status === "REQUESTED")).toBe(true);
  });

  it("serves both lists over HTTP to an admin with payments.read", async () => {
    const agent = await asOwner();
    const tx = await agent.get(`/api/payment-admin/transactions?search=${orderNumber}`);
    const rf = await agent.get(`/api/payment-admin/refunds?search=${orderNumber}`);
    expect([tx.status, rf.status]).toEqual([200, 200]);
    expect(tx.body.items[0].order.orderNumber).toBe(orderNumber);
  });
});
