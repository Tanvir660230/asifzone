import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { permissionsForRole } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { asOwner, assertInventoryInvariants, cleanupFixtures, createStockedProduct, ownerId, trackOrder } from "../../test-fixtures";
import { createManualOrder } from "../../modules/orders/order.service";
import { adjustVariantStock } from "../../modules/inventory/inventory.service";
import type { AdminIdentity } from "../auth/authorization";
import { runAssistant, type AiModel, type ModelMessage } from "./chat.service";
import { cancelProposal, executeProposal, proposeAction } from "./proposals.service";
import { aiTool, maskPhone, toolsFor } from "./tools";

// Blueprint V2 §T / DR-23: read tools answer; every change is a proposal that runs only on an explicit confirm.

let owner: AdminIdentity;
let sku: string;
let variantId: string;
let orderNumber: string;
let orderId: string;

beforeAll(async () => {
  owner = { adminId: await ownerId(), role: "OWNER", permissions: permissionsForRole("OWNER") };
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 900 });
  variantId = variants[0]!.id;
  sku = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).sku;
  const order = await createManualOrder(
    {
      items: [{ variantId, quantity: 1 }],
      customerName: "Vitest AI",
      customerPhone: "01712345690",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 1",
      paymentMethod: "COD",
    } as never,
    owner.adminId,
  );
  trackOrder(order.id);
  orderNumber = order.orderNumber;
  orderId = order.id;
});

afterAll(async () => {
  await prisma.aiProposal.deleteMany({ where: { adminId: owner.adminId } });
  await cleanupFixtures();
  await prisma.$disconnect();
});

const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;

describe("tools", () => {
  it("offers each admin only what they may do (execute tools need ai.execute)", () => {
    expect(toolsFor(owner).map((t) => t.name)).toEqual(["get_metrics", "find_orders", "get_order", "stock_levels", "cancel_order", "adjust_stock"]);
    const staff: AdminIdentity = { adminId: owner.adminId, role: "STAFF", permissions: permissionsForRole("STAFF") };
    expect(toolsFor(staff).every((t) => t.kind === "read")).toBe(true);
    const ordersOnly: AdminIdentity = { adminId: owner.adminId, role: "STAFF", permissions: ["orders.read"] };
    expect(toolsFor(ordersOnly).map((t) => t.name)).toEqual(["find_orders", "get_order"]);
  });

  it("masks phones in what the model sees", async () => {
    expect(maskPhone("01712345690")).toBe("017•••••690");
    const tool = aiTool("get_order")!;
    if (tool.kind !== "read") throw new Error("read tool expected");
    const card = await tool.run(owner, tool.schema.parse({ orderNumber }));
    expect(JSON.stringify(card.rows)).not.toContain("01712345690");
    expect(card.href).toBe(`/admin/orders/${orderId}`);
  });
});

describe("proposals", () => {
  it("a stock adjustment changes nothing until confirmed, then runs once through the inventory service", async () => {
    const before = await stock();
    const p = await proposeAction(owner, "adjust_stock", { sku, change: 3, reason: "RESTOCK" });
    expect(p.status).toBe("PENDING");
    expect(p.effects[0]).toBe(`Stock ${before} → ${before + 3}`);
    expect(await stock()).toBe(before);
    const done = await executeProposal(owner, p.id);
    expect(done.status).toBe("EXECUTED");
    expect(await stock()).toBe(before + 3);
    await executeProposal(owner, p.id); // a second confirm is harmless
    expect(await stock()).toBe(before + 3);
    await assertInventoryInvariants(variantId);
  });

  it("refuses a proposal whose facts changed since the preview", async () => {
    const p = await proposeAction(owner, "adjust_stock", { sku, change: -1, reason: "ADJUSTMENT" });
    await adjustVariantStock(variantId, 1, "RESTOCK", owner.adminId, "someone else restocked meanwhile");
    const before = await stock();
    await expect(executeProposal(owner, p.id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await stock()).toBe(before);
  });

  it("cancelling an order through a proposal uses the order command, reason on the timeline", async () => {
    const p = await proposeAction(owner, "cancel_order", { orderNumber, reason: "Customer asked on the phone" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PENDING");
    await executeProposal(owner, p.id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { statusHistory: true } });
    expect(order.status).toBe("CANCELLED");
    expect(order.statusHistory.some((h) => h.note === "Customer asked on the phone")).toBe(true);
    // A cancelled order can't be proposed for cancelling again.
    await expect(proposeAction(owner, "cancel_order", { orderNumber, reason: "again" })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("only the admin who asked confirms; ai.execute is required; expired and cancelled proposals don't run", async () => {
    const p = await proposeAction(owner, "adjust_stock", { sku, change: 1, reason: "RESTOCK" });
    const other: AdminIdentity = { adminId: "someone-else", role: "OWNER", permissions: permissionsForRole("OWNER") };
    await expect(executeProposal(other, p.id)).rejects.toMatchObject({ statusCode: 404 });
    const noExecute: AdminIdentity = { ...owner, permissions: owner.permissions.filter((x) => x !== "ai.execute") };
    await expect(proposeAction(noExecute, "adjust_stock", { sku, change: 1, reason: "RESTOCK" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(executeProposal(noExecute, p.id)).rejects.toMatchObject({ statusCode: 403 });

    await prisma.aiProposal.update({ where: { id: p.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(executeProposal(owner, p.id)).rejects.toMatchObject({ statusCode: 409 });

    const q = await proposeAction(owner, "adjust_stock", { sku, change: 1, reason: "RESTOCK" });
    expect((await cancelProposal(owner, q.id)).status).toBe("CANCELLED");
    await expect(executeProposal(owner, q.id)).rejects.toMatchObject({ statusCode: 409 });

    // recordAudit is fire-and-forget — wait for the rows instead of racing them.
    let actions: string[] = [];
    for (let i = 0; i < 40 && !(actions.includes("ai.propose") && actions.includes("ai.cancel")); i++) {
      if (i) await new Promise((r) => setTimeout(r, 50));
      actions = (await prisma.auditLog.findMany({ where: { entityType: "ai", entityId: { in: [p.id, q.id] } }, select: { action: true } })).map((a) => a.action);
    }
    expect(actions).toEqual(expect.arrayContaining(["ai.propose", "ai.cancel"]));
  });
});

describe("assistant loop", () => {
  it("runs read tools, turns a change into a proposal, and never executes it", async () => {
    const before = await stock();
    const seen: ModelMessage[][] = [];
    const model: AiModel = {
      async create({ messages, tools }) {
        seen.push(messages);
        expect(tools.map((t) => t.name)).toContain("adjust_stock");
        if (seen.length === 1) {
          return {
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Let me check." },
              { type: "tool_use", id: "t1", name: "stock_levels", input: { search: sku, limit: 5 } },
              { type: "tool_use", id: "t2", name: "adjust_stock", input: { sku, change: 2, reason: "RESTOCK" } },
              { type: "tool_use", id: "t3", name: "drop_tables", input: {} },
            ],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "I've prepared a restock of 2 for you to confirm." }] };
      },
    };
    const res = await runAssistant(owner, { messages: [{ role: "user", content: `Restock 2 of ${sku}` }] }, model, { storeName: "Test", today: "2026-10-08" });
    expect(res.reply).toBe("I've prepared a restock of 2 for you to confirm.");
    expect(res.cards.map((c) => c.tool)).toEqual(["stock_levels"]);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0]!.status).toBe("PENDING");
    expect(await stock()).toBe(before);
    // The model got the tool results back: data for the read, "waiting" for the proposal, an error for the unknown tool.
    const results = seen[1]!.at(-1)!.content as Array<{ tool_use_id: string; content: string; is_error?: boolean }>;
    expect(results.find((r) => r.tool_use_id === "t2")!.content).toContain("waitingForConfirmation");
    expect(results.find((r) => r.tool_use_id === "t3")!.is_error).toBe(true);
  });

  it("the chat endpoint says when AI isn't configured", async () => {
    const agent = await asOwner();
    const res = await agent.post("/api/ai/chat", { messages: [{ role: "user", content: "How were sales today?" }] });
    expect(res.status).toBe(503);
  });
});
