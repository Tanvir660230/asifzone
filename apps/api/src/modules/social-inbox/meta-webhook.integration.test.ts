import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../config/prisma";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import * as fx from "./meta-webhook.fixtures";

// Social Inbox: Meta's webhook stores WhatsApp / Messenger / Instagram / comment messages in the Inbox — signed calls
// only, each message once, and each customer message hands the AI an outbox job.

const RUN = Date.now().toString(36);
const SECRET = `test-app-secret-${RUN}`;
const VERIFY = `verify-${RUN}`;
// Unique per run so the test DB can keep earlier runs' rows.
const WA_ID = `88017${String(Date.now()).slice(-8)}`;
const PSID = `70${Date.now()}`;
const uid = (s: string) => `${s}.${RUN}`;

let restore: () => void;

beforeAll(() => {
  restore = overrideIntegrationsForTests({
    META_APP_SECRET: SECRET,
    META_WEBHOOK_VERIFY_TOKEN: VERIFY,
    META_PAGE_ID: fx.PAGE_ID,
    META_IG_ACCOUNT_ID: fx.IG_ACCOUNT_ID,
  });
});

afterAll(async () => {
  restore();
  const threads = await prisma.conversation.findMany({ where: { externalThreadId: { contains: RUN } }, select: { id: true } });
  const ids = [WA_ID, PSID].map(String);
  const more = await prisma.conversation.findMany({ where: { externalThreadId: { in: ids } }, select: { id: true } });
  const all = [...threads, ...more].map((t) => t.id);
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: all } } });
  await prisma.conversation.deleteMany({ where: { id: { in: all } } });
  await prisma.$disconnect();
});

function post(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return request(app).post("/api/v1/webhooks/meta").set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(raw);
}

const thread = (channel: "WHATSAPP" | "MESSENGER" | "FB_COMMENT", externalThreadId: string) =>
  prisma.conversation.findUnique({
    where: { channel_externalThreadId: { channel, externalThreadId } },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
const assistJobs = (conversationId: string) => prisma.outboxEvent.count({ where: { consumer: "conversation-assist", aggregateId: conversationId } });

describe("Meta webhook — subscription handshake", () => {
  it("echoes the challenge for the right verify token", async () => {
    const res = await request(app).get("/api/v1/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("1158201444");
  });

  it("refuses a wrong token", async () => {
    const res = await request(app).get("/api/v1/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" });
    expect(res.status).toBe(403);
  });
});

describe("Meta webhook — signature", () => {
  it("an unsigned or wrongly signed call stores nothing", async () => {
    const body = fx.waText({ waId: WA_ID, id: uid("wamid.FORGED") });
    const unsigned = await request(app).post("/api/v1/webhooks/meta").send(body);
    expect(unsigned.status).toBe(401);
    expect((await post(body, "someone-elses-secret")).status).toBe(401);
    expect(await prisma.conversationMessage.findUnique({ where: { externalId: uid("wamid.FORGED") } })).toBeNull();
  });

  it("with no app secret configured, everything is refused", async () => {
    const undo = overrideIntegrationsForTests({ META_APP_SECRET: "" });
    try {
      expect((await post(fx.waText({ waId: WA_ID, id: uid("wamid.NOSECRET") }), "")).status).toBe(401);
    } finally {
      undo();
    }
  });
});

describe("Meta webhook — storing messages", () => {
  it("a WhatsApp message opens a conversation with the customer's name and phone, and queues the AI", async () => {
    const res = await post(fx.waText({ waId: WA_ID, id: uid("wamid.A1"), body: "Dam koto?" }));
    expect(res.status).toBe(200);
    const c = (await thread("WHATSAPP", WA_ID))!;
    expect(c).toMatchObject({ status: "OPEN", contactName: "Rahim Uddin", phone: `0${WA_ID.slice(3)}`, subject: "WhatsApp chat" });
    expect(c.lastInboundAt).not.toBeNull();
    expect(c.messages).toHaveLength(1);
    expect(c.messages[0]).toMatchObject({ direction: "IN", author: "CUSTOMER", body: "Dam koto?" });
    expect(await assistJobs(c.id)).toBe(1);
  });

  it("the same webhook delivered twice is stored once, with one AI job", async () => {
    const body = fx.waText({ waId: WA_ID, id: uid("wamid.DUP"), body: "Size M ache?" });
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const c = (await thread("WHATSAPP", WA_ID))!;
    expect(c.messages.filter((m) => m.externalId === uid("wamid.DUP"))).toHaveLength(1);
    expect(await assistJobs(c.id)).toBe(2); // A1 + DUP
  });

  it("a reply sent from the phone app is a PHONE echo: no AI job, thread handled, draft cleared", async () => {
    const c = (await thread("WHATSAPP", WA_ID))!;
    await prisma.conversationDraft.create({ data: { conversationId: c.id, body: "draft", intent: "price", basedOnMessageId: c.messages.at(-1)!.id } });
    const echo = fx.waEcho({ id: uid("wamid.ECHO") });
    (echo.entry[0]!.changes[0]!.value as unknown as { message_echoes: Array<{ to: string }> }).message_echoes[0]!.to = WA_ID;
    expect((await post(echo)).status).toBe(200);
    const after = (await thread("WHATSAPP", WA_ID))!;
    expect(after.status).toBe("HANDLED");
    expect(after.messages.at(-1)).toMatchObject({ direction: "OUT", author: "PHONE", adminId: null });
    expect(await assistJobs(c.id)).toBe(2);
    expect(await prisma.conversationDraft.findUnique({ where: { conversationId: c.id } })).toBeNull();
  });

  it("the customer writing again reopens the handled thread", async () => {
    await post(fx.waText({ waId: WA_ID, id: uid("wamid.A2"), body: "Ok order korbo" }));
    const c = (await thread("WHATSAPP", WA_ID))!;
    expect(c.status).toBe("OPEN");
    expect(c.messages).toHaveLength(4);
  });

  it("a Messenger message starts with a placeholder name", async () => {
    await post(fx.messengerText({ psid: PSID, mid: uid("m_A1") }));
    expect(await thread("MESSENGER", PSID)).toMatchObject({ contactName: "Messenger customer", phone: null, status: "OPEN" });
  });

  it("a post comment is a FB_COMMENT thread on its post; a reply under it joins the thread", async () => {
    const commentId = uid("888000111_top");
    await post(fx.feedComment({ commentId }));
    await post(fx.feedComment({ commentId: uid("888000111_reply"), parentId: commentId, message: "inbox plz" }));
    const c = (await thread("FB_COMMENT", `${commentId}|5001002003004005`))!;
    expect(c).toMatchObject({ postId: `${fx.PAGE_ID}_888000111`, contactName: "Karim Ahmed", subject: "Comment on a post" });
    expect(c.messages.map((m) => m.body)).toEqual(["price?", "inbox plz"]);
  });

  it("if storing fails, Meta gets a 500 (so it redelivers) and the redelivery is stored once", async () => {
    const body = fx.waText({ waId: WA_ID, id: uid("wamid.DBDOWN"), body: "Ache?" });
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("connection pool timeout"));
    try {
      expect((await post(body)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await post(body)).status).toBe(200);
    expect(await prisma.conversationMessage.count({ where: { externalId: uid("wamid.DBDOWN") } })).toBe(1);
  });

  it("WhatsApp history sync: old chats are stored once, as handled threads, without waking the AI", async () => {
    const customer = `88019${String(Date.now()).slice(-8)}`;
    const body = fx.waHistory({ customer, prefix: uid("wamid.H") });
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200); // Meta redelivers a chunk
    const c = (await thread("WHATSAPP", customer))!;
    expect(c.status).toBe("HANDLED");
    expect(c.messages.map((m) => [m.direction, m.author, m.body])).toEqual([
      ["IN", "CUSTOMER", "Panjabi ta ki ache?"],
      ["OUT", "PHONE", "Ji ache, 1450 taka"],
      ["IN", "CUSTOMER", "[Media]"],
    ]);
    expect(await assistJobs(c.id)).toBe(0);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: c.id } });
    await prisma.conversation.delete({ where: { id: c.id } });
  });

  it("history for a thread that is open keeps it open", async () => {
    const before = (await thread("WHATSAPP", WA_ID))!;
    await post(fx.waHistory({ customer: WA_ID, prefix: uid("wamid.H2") }));
    const after = (await thread("WHATSAPP", WA_ID))!;
    expect(after.status).toBe(before.status);
    expect(after.messages.length).toBe(before.messages.length + 3);
  });

  it("receipts and statuses are acknowledged and ignored", async () => {
    const before = await prisma.conversationMessage.count();
    expect((await post(fx.messengerDeliveryAndRead())).status).toBe(200);
    expect((await post(fx.waStatus())).status).toBe(200);
    expect(await prisma.conversationMessage.count()).toBe(before);
  });
});
