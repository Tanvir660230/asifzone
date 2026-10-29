import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { ORDER_QUEUE_FILTERS, recordConfirmationAttemptSchema, suggestedRetryAt, nextDayAt } from "@clothing-brand/shared";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { signAccessToken } from "../../lib/jwt";
import { asOwner, cleanupFixtures, createStockedProduct, ownerId, placeOrder } from "../../test-fixtures";
import { getOrderStats, holdOrderForFollowUp, listOrders, updateOrderDetails } from "./order.service";
import { claimNextConfirmation, decideConfirmation, getConfirmationState, recordConfirmationAttempt } from "./confirmation.service";

// Order Operations plan, phase 3 — customer confirmation calls. Acceptance: "confirm tomorrow" is never a confirmation;
// every call is an append-only attempt on the timeline; the 4th unanswered call (or 72 h, or a wrong number) escalates
// and never cancels; two operators taking the next call get different orders; no new order status.

const CSRF = "vitest-csrf";
let owner: string;
let staff: string;
let staffB: string;

function agent(adminId: string, role: "OWNER" | "STAFF") {
  const cookie = [`access_token=${signAccessToken({ adminId, role })}`, `csrf_token=${CSRF}`];
  const auth = (r: request.Test) => r.set("Cookie", cookie).set("X-CSRF-Token", CSRF);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body: object = {}) => auth(request(app).post(url)).send(body),
    patch: (url: string, body: object) => auth(request(app).patch(url)).send(body),
  };
}

beforeAll(async () => {
  owner = await ownerId();
  const hash = await bcrypt.hash("x", 4);
  const tag = Date.now().toString(36);
  staff = (await prisma.adminUser.create({ data: { name: "Caller A", email: `p3-a-${tag}@example.com`, passwordHash: hash, role: "STAFF" } })).id;
  staffB = (await prisma.adminUser.create({ data: { name: "Caller B", email: `p3-b-${tag}@example.com`, passwordHash: hash, role: "STAFF" } })).id;
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.order.updateMany({ where: { confirmationClaimedById: { in: [staff, staffB] } }, data: { confirmationClaimedById: null, confirmationClaimedAt: null } });
  await prisma.adminUser.deleteMany({ where: { id: { in: [staff, staffB] } } });
  await prisma.$disconnect();
});

async function pendingOrder() {
  const { variants } = await createStockedProduct({ stocks: [5], basePrice: 500 });
  return placeOrder([{ variantId: variants[0]!.id, quantity: 1 }]);
}
/** Is this order in that queue? (Searched by its number, so other suites' orders never crowd the page.) */
async function inQueue(q: keyof typeof ORDER_QUEUE_FILTERS, orderId: string) {
  const { orderNumber } = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNumber: true } });
  return (await listOrders({ ...ORDER_QUEUE_FILTERS[q], search: orderNumber, page: 1, pageSize: 25 } as never)).items.some((o) => o.id === orderId);
}
const statusOf = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

describe("recording calls", () => {
  it("'I'll confirm tomorrow' sets a callback and never confirms; a callback time is required", async () => {
    const order = await pendingOrder();
    expect(recordConfirmationAttemptSchema.safeParse({ outcome: "WILL_CONFIRM_LATER" }).success).toBe(false);
    const res = await agent(staff, "STAFF").post(`/api/orders/${order.id}/confirmation-attempts`, { outcome: "WILL_CONFIRM_LATER" });
    expect(res.status).toBe(400);

    const tomorrow = new Date(Date.now() + 20 * 3_600_000);
    const ok = await agent(staff, "STAFF").post(`/api/orders/${order.id}/confirmation-attempts`, { outcome: "WILL_CONFIRM_LATER", callbackAt: tomorrow.toISOString(), note: "after office" });
    expect(ok.status).toBe(201);
    expect(await statusOf(order.id)).toBe("PENDING");
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.followUpAt?.getTime()).toBe(tomorrow.getTime());
    expect(row.callAttempts).toBe(1);
    expect(ok.body.attempts[0]).toMatchObject({ outcome: "WILL_CONFIRM_LATER", note: "after office", admin: { id: staff } });
    // On the timeline, as a note on the unchanged status.
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "desc" }, take: 1 });
    expect(history[0]).toMatchObject({ status: "PENDING", changedByAdminId: staff });
    expect(history[0]!.note).toContain("Will confirm later");
  });

  it("attempts are append-only in the database", async () => {
    const order = await pendingOrder();
    await recordConfirmationAttempt(order.id, staff, { outcome: "BUSY" }, { canCancel: false });
    const attempt = await prisma.orderConfirmationAttempt.findFirstOrThrow({ where: { orderId: order.id } });
    await expect(prisma.orderConfirmationAttempt.update({ where: { id: attempt.id }, data: { outcome: "CONFIRMED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.orderConfirmationAttempt.delete({ where: { id: attempt.id } })).rejects.toThrow(/append-only/);
  });

  it("CONFIRMED goes through the state machine; DECLINED cancels only with a reason and the cancel permission", async () => {
    const yes = await pendingOrder();
    await recordConfirmationAttempt(yes.id, staff, { outcome: "CONFIRMED" }, { canCancel: false });
    expect(await statusOf(yes.id)).toBe("CONFIRMED");
    expect((await prisma.orderStatusHistory.findFirst({ where: { orderId: yes.id, status: "CONFIRMED" } }))?.note).toBe("Confirmed on call");
    await expect(recordConfirmationAttempt(yes.id, staff, { outcome: "NO_ANSWER" }, { canCancel: false })).rejects.toMatchObject({ statusCode: 409 });

    const no = await pendingOrder();
    expect(recordConfirmationAttemptSchema.safeParse({ outcome: "DECLINED" }).success).toBe(false);
    await expect(recordConfirmationAttempt(no.id, staff, { outcome: "DECLINED", note: "changed mind" }, { canCancel: false })).rejects.toMatchObject({ statusCode: 403 });
    await recordConfirmationAttempt(no.id, staff, { outcome: "DECLINED", note: "changed mind" }, { canCancel: true });
    expect(await statusOf(no.id)).toBe("CANCELLED");
  });
});

describe("retries and escalation", () => {
  it("suggests +2 h after the 1st and 2nd unanswered call, then the next day 10:00 store time", () => {
    const now = new Date("2026-10-29T06:00:00Z"); // 12:00 in Dhaka
    expect(suggestedRetryAt(1, now, "Asia/Dhaka").toISOString()).toBe("2026-10-29T08:00:00.000Z");
    expect(suggestedRetryAt(2, now, "Asia/Dhaka").toISOString()).toBe("2026-10-29T08:00:00.000Z");
    expect(suggestedRetryAt(3, now, "Asia/Dhaka").toISOString()).toBe("2026-10-30T04:00:00.000Z");
    // Late at night (23:30 Dhaka = 17:30Z) the next day is the store's tomorrow, not UTC's.
    expect(nextDayAt(new Date("2026-10-29T17:30:00Z"), "Asia/Dhaka", 10).toISOString()).toBe("2026-10-30T04:00:00.000Z");
  });

  it("the 4th unanswered call escalates, stops automatic callbacks and never cancels", async () => {
    const order = await pendingOrder();
    for (const outcome of ["NO_ANSWER", "SWITCHED_OFF", "BUSY"] as const) {
      const s = await recordConfirmationAttempt(order.id, staff, { outcome }, { canCancel: true });
      expect(s.escalatedAt).toBeNull();
      expect(s.callbackAt).not.toBeNull();
    }
    const s = await recordConfirmationAttempt(order.id, staff, { outcome: "NO_ANSWER" }, { canCancel: true });
    expect(s).toMatchObject({ unreached: 4, limit: 4, escalationReason: "UNREACHED_LIMIT", callbackAt: null });
    expect(await statusOf(order.id)).toBe("PENDING");
    expect(await inQueue("confirmEscalated", order.id)).toBe(true);
    expect(await inQueue("callNow", order.id)).toBe(false);
    expect(await inQueue("needsAction", order.id)).toBe(true);
  });

  it("a wrong number escalates at once; an order unconfirmed for 72 h is escalated", async () => {
    const wrong = await pendingOrder();
    const s = await recordConfirmationAttempt(wrong.id, staff, { outcome: "WRONG_NUMBER" }, { canCancel: true });
    expect(s.escalationReason).toBe("WRONG_NUMBER");

    const old = await pendingOrder();
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 73 * 3_600_000) } });
    expect((await getConfirmationState(old.id)).staleEscalated).toBe(true);
    expect(await inQueue("confirmEscalated", wrong.id)).toBe(true);
    expect(await inQueue("confirmEscalated", old.id)).toBe(true);
    expect(await inQueue("callNow", old.id)).toBe(false);
    expect(await statusOf(old.id)).toBe("PENDING");
  });

  it("only an owner/manager decides: one more try lifts it and allows one more unanswered call; a new phone resets the count", async () => {
    const order = await pendingOrder();
    for (let i = 0; i < 4; i++) await recordConfirmationAttempt(order.id, staff, { outcome: "NO_ANSWER" }, { canCancel: true });

    const staffTry = await agent(staff, "STAFF").patch(`/api/orders/${order.id}/confirmation`, { action: "retry", reason: "customer texted" });
    expect(staffTry.status).toBe(403);
    const ownerTry = await (await asOwner()).patch(`/api/orders/${order.id}/confirmation`, { action: "retry", reason: "customer texted" });
    expect(ownerTry.status).toBe(200);
    expect(ownerTry.body).toMatchObject({ escalatedAt: null, limit: 5, unreached: 4 });
    const again = await recordConfirmationAttempt(order.id, staff, { outcome: "NO_ANSWER" }, { canCancel: true });
    expect(again.escalationReason).toBe("UNREACHED_LIMIT");

    await updateOrderDetails(order.id, { customerPhone: "01811111111" }, owner);
    const reset = await getConfirmationState(order.id);
    expect(reset).toMatchObject({ unreached: 0, escalatedAt: null });
    expect(reset.attempts).toHaveLength(5); // history kept
  });
});

describe("operators", () => {
  it("two operators taking the next call at once get different orders; a claimed order refuses another operator's call", async () => {
    await pendingOrder();
    await pendingOrder();
    const [a, b] = await Promise.all([claimNextConfirmation(staff), claimNextConfirmation(staffB)]);
    expect(a && b).toBeTruthy();
    expect(a!.orderId).not.toBe(b!.orderId);
    // Asking again returns the claim already held.
    expect((await claimNextConfirmation(staff))!.orderId).toBe(a!.orderId);

    await expect(recordConfirmationAttempt(a!.orderId, staffB, { outcome: "BUSY" }, { canCancel: true })).rejects.toMatchObject({ statusCode: 409 });
    const s = await recordConfirmationAttempt(a!.orderId, staff, { outcome: "BUSY" }, { canCancel: true });
    expect(s.claimedBy).toBeNull(); // released by the call
    await recordConfirmationAttempt(b!.orderId, staffB, { outcome: "BUSY" }, { canCancel: true });
  });

  it("an assigned order is offered to its operator first", async () => {
    const order = await pendingOrder();
    await decideConfirmation(order.id, owner, { action: "assign", assigneeId: staffB }, { canDecideEscalations: true });
    const next = await claimNextConfirmation(staffB);
    expect(next!.orderId).toBe(order.id);
    await recordConfirmationAttempt(order.id, staffB, { outcome: "CONFIRMED" }, { canCancel: true });
  });
});

describe("compatibility and queues", () => {
  it("the old Hold still works and appears in the call history", async () => {
    const order = await pendingOrder();
    const at = new Date(Date.now() + 3 * 3_600_000);
    await holdOrderForFollowUp(order.id, { followUpAt: at, note: "evening" }, owner);
    const s = await getConfirmationState(order.id);
    expect(s.attempts[0]).toMatchObject({ outcome: "CALLBACK_REQUESTED", note: "evening" });
    expect(s.callbackAt).toBe(at.toISOString());
  });

  it("each queue's badge equals its list; no new order status", async () => {
    const stats = await getOrderStats();
    for (const q of ["callNow", "callLater", "confirmEscalated", "needsAction"] as const) {
      const list = await listOrders({ ...ORDER_QUEUE_FILTERS[q], page: 1, pageSize: 1 } as never);
      expect(stats.queueCounts[q], q).toBe(list.total);
    }
    const statuses = await prisma.$queryRaw<Array<{ v: string }>>`SELECT unnest(enum_range(NULL::"OrderStatus"))::text AS v`;
    expect(statuses.map((s) => s.v)).not.toContain("ESCALATED");
  });
});
