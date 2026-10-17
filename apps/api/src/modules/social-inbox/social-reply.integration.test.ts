import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Record what would go to Meta instead of sending it.
const sent = vi.hoisted(() => [] as Array<{ path: string; body: Record<string, unknown> }>);
vi.mock("../../providers/social/meta-graph", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  postGraph: vi.fn(async (req: { path: string; body: Record<string, unknown> }) => {
    sent.push(req);
    return `sent_${sent.length}_${Date.now()}`;
  }),
}));

import { createHmac } from "node:crypto";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { asOwner } from "../../test-fixtures";
import { processOutboxEvent } from "../../domain/outbox/processor";
import * as fx from "./meta-webhook.fixtures";

// Social Inbox: staff answer WhatsApp / Messenger / comment threads from the Inbox, within Meta's reply windows.

const RUN = Date.now().toString(36);
const H = 3_600_000;
const conversationIds: string[] = [];
let restore: () => void;

beforeAll(() => {
  restore = overrideIntegrationsForTests({ META_APP_SECRET: `s-${RUN}`, META_PAGE_ID: fx.PAGE_ID, META_PAGE_ACCESS_TOKEN: "page-token", WHATSAPP_PHONE_NUMBER_ID: "555666", WHATSAPP_ACCESS_TOKEN: "wa-token" });
});
beforeEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  restore();
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.$disconnect();
});

async function thread(channel: "WHATSAPP" | "MESSENGER" | "INSTAGRAM" | "FB_COMMENT", lastInboundAgoMs: number) {
  const c = await prisma.conversation.create({
    data: {
      channel,
      externalThreadId: `${channel}-${RUN}-${conversationIds.length}`,
      subject: "chat",
      contactName: "Rahim",
      phone: channel === "WHATSAPP" ? "01812345678" : null,
      lastInboundAt: new Date(Date.now() - lastInboundAgoMs),
      messages: { create: { direction: "IN", channel, body: "Dam koto?", author: "CUSTOMER" } },
    },
  });
  conversationIds.push(c.id);
  return c;
}

async function reply(id: string, channel: string, body = "1450 taka") {
  const agent = await asOwner();
  return agent.post(`/api/v1/admin/conversations/${id}/replies`).send({ channel, body });
}

async function deliver(messageId: string) {
  const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { consumer_eventKey: { consumer: "conversation-reply", eventKey: messageId } } });
  return processOutboxEvent(event.id);
}

describe("replying on social channels", () => {
  it("WhatsApp within 24 hours: sent to the customer's WhatsApp number, Meta's id kept", async () => {
    const c = await thread("WHATSAPP", 1 * H);
    const res = await reply(c.id, "WHATSAPP");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ author: "STAFF", delivery: "sending" });
    expect(await deliver(res.body.id)).toMatchObject({ outcome: "processed", result: "sent" });
    expect(sent).toEqual([expect.objectContaining({ path: "/555666/messages", body: expect.objectContaining({ to: c.externalThreadId, text: { body: "1450 taka", preview_url: true } }) })]);
    const m = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(m.externalId).toMatch(/^sent_/);
  });

  it("WhatsApp after 24 hours is refused up front with WINDOW_CLOSED, nothing recorded", async () => {
    const c = await thread("WHATSAPP", 25 * H);
    const res = await reply(c.id, "WHATSAPP");
    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("WINDOW_CLOSED");
    expect(JSON.stringify(res.body)).toContain("24 hours");
    expect(await prisma.conversationMessage.count({ where: { conversationId: c.id, direction: "OUT" } })).toBe(0);
  });

  it("...but SMS still works on that thread", async () => {
    const c = await thread("WHATSAPP", 25 * H);
    expect((await reply(c.id, "SMS")).status).toBe(201);
  });

  it("Messenger after 24 hours goes out with the HUMAN_AGENT tag", async () => {
    const c = await thread("MESSENGER", 30 * H);
    const res = await reply(c.id, "MESSENGER");
    expect(res.status).toBe(201);
    await deliver(res.body.id);
    expect(sent[0]!.body).toMatchObject({ recipient: { id: c.externalThreadId }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });

  it("Instagram within 24 hours is a plain RESPONSE through the Page", async () => {
    const c = await thread("INSTAGRAM", 2 * H);
    const res = await reply(c.id, "INSTAGRAM");
    await deliver(res.body.id);
    expect(sent[0]).toMatchObject({ path: `/${fx.PAGE_ID}/messages`, body: { messaging_type: "RESPONSE" } });
  });

  it("a comment can be answered publicly or privately", async () => {
    const c = await thread("FB_COMMENT", 200 * H);
    const pub = await reply(c.id, "FB_COMMENT", "Inbox-e details pathiyechi");
    await deliver(pub.body.id);
    const priv = await reply(c.id, "MESSENGER", "Dam 1450 taka");
    await deliver(priv.body.id);
    expect(sent.map((s) => s.path)).toEqual([`/${c.externalThreadId}/comments`, `/${fx.PAGE_ID}/messages`]);
    expect(sent[1]!.body).toMatchObject({ recipient: { comment_id: c.externalThreadId } });
  });

  it("a channel that doesn't fit the thread is refused", async () => {
    const c = await thread("MESSENGER", 1 * H);
    const res = await reply(c.id, "WHATSAPP");
    expect(res.status).toBe(400);
    expect(res.body.details?.code).toBe("WRONG_CHANNEL");
  });

  it("replying removes the AI draft; the detail shows window and channels", async () => {
    const c = await thread("WHATSAPP", 1 * H);
    const inbound = await prisma.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id } });
    await prisma.conversationDraft.create({ data: { conversationId: c.id, body: "Ji 1450 taka", intent: "price", basedOnMessageId: inbound.id } });
    const agent = await asOwner();
    const detail = await agent.get(`/api/v1/admin/conversations/${c.id}`);
    expect(detail.body).toMatchObject({ draft: { body: "Ji 1450 taka", intent: "price" }, replyWindow: { open: true }, replyChannels: ["WHATSAPP", "SMS"] });
    await reply(c.id, "WHATSAPP");
    expect(await prisma.conversationDraft.findUnique({ where: { conversationId: c.id } })).toBeNull();
  });

  it("staff can discard a draft", async () => {
    const c = await thread("MESSENGER", 1 * H);
    const inbound = await prisma.conversationMessage.findFirstOrThrow({ where: { conversationId: c.id } });
    await prisma.conversationDraft.create({ data: { conversationId: c.id, body: "x", intent: "other", basedOnMessageId: inbound.id } });
    const agent = await asOwner();
    expect((await agent.delete(`/api/v1/admin/conversations/${c.id}/draft`)).status).toBe(204);
    expect(await prisma.conversationDraft.findUnique({ where: { conversationId: c.id } })).toBeNull();
  });

  it("the webhook echo of our own sent reply is not stored a second time", async () => {
    const c = await thread("WHATSAPP", 1 * H);
    const res = await reply(c.id, "WHATSAPP");
    await deliver(res.body.id);
    const { externalId } = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: res.body.id } });
    const echo = fx.waEcho({ id: externalId!, body: "1450 taka" });
    (echo.entry[0]!.changes[0]!.value as unknown as { message_echoes: Array<{ to: string }> }).message_echoes[0]!.to = c.externalThreadId!;
    const raw = JSON.stringify(echo);
    const sig = `sha256=${createHmac("sha256", `s-${RUN}`).update(raw).digest("hex")}`;
    expect((await request(app).post("/api/v1/webhooks/meta").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw)).status).toBe(200);
    expect(await prisma.conversationMessage.count({ where: { conversationId: c.id, direction: "OUT" } })).toBe(1);
  });

  it("a reply whose window closed while queued fails with a clear error instead of reaching Meta", async () => {
    const c = await thread("WHATSAPP", 1 * H);
    const res = await reply(c.id, "WHATSAPP");
    await prisma.conversation.update({ where: { id: c.id }, data: { lastInboundAt: new Date(Date.now() - 25 * H) } });
    await deliver(res.body.id);
    expect(sent).toHaveLength(0);
    const agent = await asOwner();
    const detail = await agent.get(`/api/v1/admin/conversations/${c.id}`);
    expect(detail.body.messages.at(-1)).toMatchObject({ delivery: "failed", deliveryError: expect.stringContaining("reply window closed") });
  });
});
