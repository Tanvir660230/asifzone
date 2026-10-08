import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Capture what the providers are asked to send (the real adapters would only dev-log under vitest).
const sentSms = vi.hoisted(() => [] as Array<{ to: string; body: string }>);
const sentMail = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string; idempotencyKey?: string }>);
vi.mock("../../providers/sms/bulksmsbd", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendSms: vi.fn(async (m: { to: string; body: string }) => void sentSms.push(m)),
}));
vi.mock("../../providers/email/resend", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendMail: vi.fn(async (m: { to: string; subject: string; html: string; idempotencyKey?: string }) => void sentMail.push(m)),
}));

import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { asOwner, ownerId } from "../../test-fixtures";
import { processOutboxEvent } from "../../domain/outbox/processor";

// Admin V2 Inbox R2 (DR-4, owner 2026-10-08): website messages are conversations; staff reply by email or SMS from the
// Store Console, through the outbox. Delivery state is read from the outbox row, never written by the consumer.

const RUN = Date.now().toString(36);
const PHONE = "01712399" + String(Date.now()).slice(-3);
let customerId: string;
const conversationIds: string[] = [];

beforeAll(async () => {
  customerId = (await prisma.customer.create({ data: { name: "Inbox Customer", phone: PHONE, phoneVerifiedAt: new Date() } })).id;
});

afterAll(async () => {
  await prisma.outboxEvent.deleteMany({ where: { consumer: "conversation-reply", aggregateId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();
});

async function contact(body: Record<string, unknown>) {
  const res = await request(app).post("/api/feedback").send(body);
  expect(res.status).toBe(201);
  const conversation = await prisma.conversation.findFirstOrThrow({ where: { subject: body.subject as string }, include: { messages: true } });
  conversationIds.push(conversation.id);
  return conversation;
}

describe("Inbox R2 — conversations", () => {
  it("a contact-form message opens a web conversation, linked to the customer who verified that phone", async () => {
    const c = await contact({ name: "Rahim", phone: PHONE, email: `rahim-${RUN}@example.com`, subject: `Size question ${RUN}`, message: "Is the M size in stock?" });
    expect(c).toMatchObject({ channel: "WEB_FORM", status: "OPEN", customerId, contactName: "Rahim" });
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ direction: "IN", channel: "WEB_FORM", body: "Is the M size in stock?" });
  });

  it("never links to a customer whose phone isn't verified (anyone can type any number)", async () => {
    const phone = "01812399" + String(Date.now()).slice(-3);
    const unverified = await prisma.customer.create({ data: { name: "Unverified", phone } });
    try {
      const c = await contact({ name: "Someone", phone, subject: `Unverified ${RUN}`, message: "Hi" });
      expect(c.customerId).toBeNull();
    } finally {
      await prisma.conversation.deleteMany({ where: { subject: `Unverified ${RUN}` } });
      conversationIds.pop();
      await prisma.customer.delete({ where: { id: unverified.id } });
    }
  });

  it("lists and opens conversations for staff", async () => {
    const agent = await asOwner();
    const list = await agent.get(`/api/v1/admin/conversations?status=open&search=${RUN}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { subject: string }) => c.subject)).toContain(`Size question ${RUN}`);
    const id = list.body.items[0].id;
    const detail = await agent.get(`/api/v1/admin/conversations/${id}`);
    expect(detail.body.messages).toHaveLength(1);
    expect(detail.body.customer).toMatchObject({ id: customerId });
  });

  it("an email reply is queued through the outbox, marks the conversation handled, and is delivered once", async () => {
    const agent = await asOwner();
    const id = conversationIds[0]!;
    const res = await agent.post(`/api/v1/admin/conversations/${id}/replies`, { channel: "EMAIL", body: "Yes — M is in stock.\nThank you!" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ direction: "OUT", channel: "EMAIL", delivery: "sending" });

    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { consumer_eventKey: { consumer: "conversation-reply", eventKey: res.body.id } } });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id } })).status).toBe("HANDLED");

    expect(await processOutboxEvent(event.id)).toMatchObject({ outcome: "processed", result: "sent" });
    const mail = sentMail.find((m) => m.idempotencyKey === event.id)!;
    expect(mail).toMatchObject({ to: `rahim-${RUN}@example.com`, subject: `Re: Size question ${RUN}` });
    expect(mail.html).toContain("Yes — M is in stock.");

    const detail = await agent.get(`/api/v1/admin/conversations/${id}`);
    expect(detail.body.messages.at(-1)).toMatchObject({ direction: "OUT", delivery: "sent", by: expect.any(String) });
  });

  it("an SMS reply goes to the phone; a failed send shows as failed with its error", async () => {
    const agent = await asOwner();
    const id = conversationIds[0]!;
    const res = await agent.post(`/api/v1/admin/conversations/${id}/replies`, { channel: "SMS", body: "Your size is ready." });
    expect(res.status).toBe(201);
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { consumer_eventKey: { consumer: "conversation-reply", eventKey: res.body.id } } });
    await processOutboxEvent(event.id);
    expect(sentSms.find((m) => m.body.startsWith("Your size is ready."))).toMatchObject({ to: PHONE });

    await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: "FAILED", lastError: "insufficient balance" } });
    const detail = await agent.get(`/api/v1/admin/conversations/${id}`);
    expect(detail.body.messages.find((m: { id: string }) => m.id === res.body.id)).toMatchObject({ delivery: "failed", deliveryError: "insufficient balance" });
  });

  it("refuses a reply on a channel the customer can't be reached on", async () => {
    const c = await contact({ name: "No Phone", email: `nophone-${RUN}@example.com`, subject: `Email only ${RUN}`, message: "Hello" });
    const agent = await asOwner();
    expect((await agent.post(`/api/v1/admin/conversations/${c.id}/replies`, { channel: "SMS", body: "Hi" })).status).toBe(400);
    expect((await agent.post(`/api/v1/admin/conversations/${c.id}/replies`, { channel: "EMAIL", body: "" })).status).toBe(400);
  });

  it("assigns a conversation to the admin who takes it, filters by it, and unassigns", async () => {
    const agent = await asOwner();
    const id = conversationIds[0]!;
    const assigned = await agent.patch(`/api/v1/admin/conversations/${id}`, { assignedToMe: true });
    expect(assigned.status).toBe(200);
    expect(assigned.body.assignedTo).toMatchObject({ id: await ownerId() });
    const mine = await agent.get(`/api/v1/admin/conversations?status=all&mine=true&search=${RUN}`);
    expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(mine.body.items[0].assignedTo).toMatchObject({ id: await ownerId() });
    expect((await agent.get(`/api/v1/admin/conversations/${id}`)).body.assignedTo).toMatchObject({ id: await ownerId() });
    expect((await agent.patch(`/api/v1/admin/conversations/${id}`, { assignedToMe: false })).body.assignedTo).toBeNull();
    expect((await agent.patch(`/api/v1/admin/conversations/${id}`, {})).status).toBe(400);
  });

  it("reopens, filters by status and deletes", async () => {
    const agent = await asOwner();
    const id = conversationIds[0]!;
    expect((await agent.patch(`/api/v1/admin/conversations/${id}`, { status: "OPEN" })).body.status).toBe("OPEN");
    const handled = await agent.get(`/api/v1/admin/conversations?status=handled&search=${RUN}`);
    expect(handled.body.items.map((c: { id: string }) => c.id)).not.toContain(id);
    expect((await agent.delete(`/api/v1/admin/conversations/${conversationIds[1]}`)).status).toBe(204);
    expect(await prisma.conversation.findUnique({ where: { id: conversationIds[1]! } })).toBeNull();
  });
});
