import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permissionsForRole, type ReceiveParcelInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cleanupFixtures, createStockedProduct, ownerId, placeOrder, stockOf, trackOrder } from "../../test-fixtures";
import { changeOrderStatus, updateOrderStatus } from "../orders/order.service";
import { createOrderIssue } from "../return-requests/order-issue.service";
import { createDoorSwap } from "../return-requests/door-swap.service";
import { getParcelView, receiveParcel } from "./parcel-receive.service";
import { bulkReceiveParcels } from "./parcel-bulk-receive.service";

// A problem the customer reported on the call (torn, stain…) shows on the scanner when that parcel comes back, keeps the
// parcel out of "receive all as good", and is closed by the scan with what the receiver found.

let owner: string;
let viewer: { adminId: string; permissions: ReturnType<typeof permissionsForRole> };
let seq = 0;
beforeAll(async () => {
  owner = await ownerId();
  viewer = { adminId: owner, permissions: permissionsForRole("OWNER") };
});
afterAll(async () => {
  await cleanupFixtures();
});

async function shipped() {
  const { variants } = await createStockedProduct({ stocks: [20, 20], basePrice: 1390 });
  const order = await placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
  await changeOrderStatus(order.id, { status: "CONFIRMED", note: null }, owner);
  await prisma.order.update({ where: { id: order.id }, data: { courierConsignmentId: `8${Date.now().toString().slice(-8)}${seq++ % 10}`, courierBookedAt: new Date() } });
  await changeOrderStatus(order.id, { status: "PACKED", note: null }, owner);
  await changeOrderStatus(order.id, { status: "SHIPPED", note: null }, owner);
  const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
  return { order, item, variantIds: variants.map((v) => v.id) };
}

const line = (orderItemId: string, good: number, damaged: number) => ({ orderItemId, kept: 0, good, damaged, missing: 0, wrong: 0, other: 0 });

describe("customer-reported problems on the scanner", () => {
  it("shows the reported tear, keeps the parcel out of bulk 'all good', and the scan closes it as damaged", async () => {
    const { order, item, variantIds } = await shipped();
    await createOrderIssue(order.id, { orderItemId: item.id, kind: "TORN", channel: "CALL", note: "Left sleeve torn, refused at the door" }, { adminId: owner });

    const card = await getParcelView(order.id, viewer);
    expect(card.reportedIssues).toHaveLength(1);
    expect(card.reportedIssues[0]).toMatchObject({ kindLabel: "Torn", note: "Left sleeve torn, refused at the door", orderNumber: order.orderNumber });

    const bulk = await bulkReceiveParcels({ orderIds: [order.id], condition: "GOOD", dryRun: true }, viewer, "bulk:preview");
    expect(bulk.rows[0]).toMatchObject({ action: "SKIP", reason: "The customer reported a problem (torn) — check it on its own." });

    const stock = await stockOf(variantIds[0]!);
    await receiveParcel({ orderId: order.id, version: card.version, outcome: "FULL_RETURN", lines: [line(item.id, 0, 1)] } as ReceiveParcelInput, viewer, `ri-${Date.now()}`);
    expect(await stockOf(variantIds[0]!)).toBe(stock); // damaged: written off, not back on the shelf
    const issue = await prisma.orderIssue.findFirstOrThrow({ where: { orderId: order.id } });
    expect([Boolean(issue.resolvedAt), issue.resolution]).toEqual([true, "Scanned back: 1 damaged"]);
    expect((await getParcelView(order.id, viewer)).reportedIssues).toHaveLength(0);
  });

  it("a door-swap parcel shows the problem reported on the original order", async () => {
    const { order, item, variantIds } = await shipped();
    await updateOrderStatus(order.id, { status: "DELIVERED" }, owner);
    const issue = await createOrderIssue(order.id, { orderItemId: item.id, kind: "STAIN", channel: "WHATSAPP", note: "Stain on the front" }, { adminId: owner });
    const r = await createDoorSwap(order.id, { orderItemId: item.id, requestedVariantId: variantIds[1]!, reason: "DEFECT", issueId: issue.id }, owner, null);
    trackOrder(r.exchangeOrder!.id);
    const card = await getParcelView(r.exchangeOrder!.id, viewer);
    expect(card.reportedIssues.map((i) => [i.kindLabel, i.orderNumber])).toEqual([["Stain / dirty", order.orderNumber]]);
  });
});
