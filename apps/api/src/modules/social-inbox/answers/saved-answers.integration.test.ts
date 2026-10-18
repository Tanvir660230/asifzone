import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../config/prisma";
import { overrideIntegrationsForTests } from "../../../config/integration-overrides";
import { processOutboxEvent } from "../../../domain/outbox/processor";
import { asOwner } from "../../../test-fixtures";
import type { AiModel } from "../../../domain/ai/chat.service";
import { assistConversation } from "../assist/assist.service";
import { invalidateAnswerLibrary } from "./saved-answers.service";

// The answer library (owner 2026-10-18): replies teach it; repeated, consistent replies become a suggestion; once a
// person approves it, the same question — however it is typed — is answered without an AI call.

const RUN = Date.now().toString(36);
const conversationIds: string[] = [];
let restore: () => void;

/** A model that must never be called. */
const noAi: AiModel = {
  create: async () => {
    throw new Error("the AI was called");
  },
};

beforeAll(async () => {
  restore = overrideIntegrationsForTests({ INBOX_AI_AUTOREPLY: "factual" });
  // This suite owns the library in the test database.
  await prisma.savedAnswer.deleteMany({ where: { createdAt: { gte: new Date(0) } } });
  await prisma.answerExample.deleteMany({ where: { createdAt: { gte: new Date(0) } } });
  invalidateAnswerLibrary();
});
afterAll(async () => {
  restore();
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.savedAnswer.deleteMany({ where: { createdAt: { gte: new Date(0) } } });
  await prisma.answerExample.deleteMany({ where: { createdAt: { gte: new Date(0) } } });
  await prisma.$disconnect();
});

async function thread(question: string) {
  const c = await prisma.conversation.create({
    data: {
      channel: "WHATSAPP",
      externalThreadId: `lib-${RUN}-${conversationIds.length}`,
      subject: "WhatsApp chat",
      contactName: "Rahim Uddin",
      phone: "01812345678",
      lastInboundAt: new Date(),
      messages: { create: { direction: "IN", channel: "WHATSAPP", body: question, author: "CUSTOMER", createdAt: new Date(Date.now() - 1000) } },
    },
    include: { messages: true },
  });
  conversationIds.push(c.id);
  return { id: c.id, questionId: c.messages[0]!.id };
}

/** Staff answer a question through the Inbox; the learning job then runs. */
async function staffAnswers(question: string, answer: string) {
  const t = await thread(question);
  const res = await (await asOwner()).post(`/api/v1/admin/conversations/${t.id}/replies`, { channel: "WHATSAPP", body: answer });
  expect(res.status).toBe(201);
  const job = await prisma.outboxEvent.findUniqueOrThrow({ where: { consumer_eventKey: { consumer: "answer-learning", eventKey: res.body.id } } });
  await processOutboxEvent(job.id);
  return t;
}

const list = async () => (await (await asOwner()).get("/api/v1/admin/saved-answers")).body;

describe("learning from replies", () => {
  it("the same question answered the same way three times becomes a suggestion", async () => {
    await staffAnswers("Delivery charge koto?", "Dhakay 60 taka, Dhakar baire 120 taka");
    await staffAnswers("delivary charj koto vai", "Dhakar moddhe 60 taka, baire 120 taka");
    expect((await list()).suggested).toHaveLength(0);
    await staffAnswers("ডেলিভারি চার্জ কত?", "Dhakay 60 taka ar baire 120 taka");
    const { suggested } = await list();
    expect(suggested).toHaveLength(1);
    expect(suggested[0]).toMatchObject({ status: "SUGGESTED", answer: "Dhakay 60 taka ar baire 120 taka", exampleCount: 3 });
    expect(suggested[0].examples).toEqual(expect.arrayContaining(["Delivery charge koto?", "ডেলিভারি চার্জ কত?"]));
  });

  it("product-specific answers (different every time) never become one", async () => {
    await staffAnswers("eta dam koto", "1450 taka");
    await staffAnswers("eta dam koto?", "L size 2200 taka, M nei");
    await staffAnswers("dam koto eta", "Black ta 990, white ta stock out");
    expect((await list()).suggested.map((s: { title: string }) => s.title)).not.toContain("eta dam koto");
  });

  it("a follow-up reply teaches nothing (only the first answer to a question counts)", async () => {
    const t = await staffAnswers("cod ache?", "Ji ache");
    const res = await (await asOwner()).post(`/api/v1/admin/conversations/${t.id}/replies`, { channel: "WHATSAPP", body: "Ar kichu janben?" });
    const job = await prisma.outboxEvent.findUniqueOrThrow({ where: { consumer_eventKey: { consumer: "answer-learning", eventKey: res.body.id } } });
    expect(await processOutboxEvent(job.id)).toMatchObject({ result: "skipped" });
  });
});

describe("answering from the library", () => {
  let answerId: string;

  it("approving with live placeholders; an unknown placeholder is refused", async () => {
    const owner = await asOwner();
    answerId = (await list()).suggested[0].id;
    const bad = await owner.patch(`/api/v1/admin/saved-answers/${answerId}`, { status: "APPROVED", answer: "Charge {shipping}" });
    expect([bad.status, bad.body.details?.code]).toEqual([400, "UNKNOWN_PLACEHOLDER"]);
    const ok = await owner.patch(`/api/v1/admin/saved-answers/${answerId}`, { status: "APPROVED", answer: "{delivery_charges}. {cod}.", autoSend: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "APPROVED", autoSend: true });
  });

  it("the same question, typed another way, is answered on its own — with today's fees, without the AI", async () => {
    const t = await thread("Delivery charge kto bhaiya?");
    expect(await assistConversation(t.questionId, noAi)).toBe("auto");
    const out = await prisma.conversationMessage.findFirstOrThrow({ where: { conversationId: t.id, direction: "OUT" } });
    expect(out.savedAnswerId).toBe(answerId);
    expect(out.body).toMatch(/\d+ taka/);
    expect(out.body).toMatch(/Cash on delivery/);
    expect(await prisma.outboxEvent.count({ where: { consumer: "answer-learning", eventKey: out.id } })).toBe(0); // it doesn't learn from itself
    expect((await prisma.savedAnswer.findUniqueOrThrow({ where: { id: answerId } })).hits).toBe(1);
  });

  it("works with no Claude key at all", async () => {
    const t = await thread("ডেলিভারি চার্জ কত");
    expect(await assistConversation(t.questionId, null)).toBe("auto");
    const other = await thread("Exchange policy ki?");
    expect(await assistConversation(other.questionId, null)).toBe("no-model");
  });

  it("with auto-send off it drafts; sent unchanged = a use, rewritten = a correction", async () => {
    await (await asOwner()).patch(`/api/v1/admin/saved-answers/${answerId}`, { autoSend: false });
    const t = await thread("delivery charge koto");
    expect(await assistConversation(t.questionId, noAi)).toBe("draft");
    const detail = await (await asOwner()).get(`/api/v1/admin/conversations/${t.id}`);
    expect(detail.body.draft).toMatchObject({ intent: "saved", fromLibrary: true });
    const sent = await (await asOwner()).post(`/api/v1/admin/conversations/${t.id}/replies`, { channel: "WHATSAPP", body: detail.body.draft.body });
    expect(sent.body.fromLibrary).toBe(true);
    expect((await prisma.savedAnswer.findUniqueOrThrow({ where: { id: answerId } })).hits).toBe(3);

    const t2 = await thread("delivery charge koto apu");
    await assistConversation(t2.questionId, noAi);
    await (await asOwner()).post(`/api/v1/admin/conversations/${t2.id}/replies`, { channel: "WHATSAPP", body: "Apnar area ta bolen, eid er somoy charge alada" });
    expect((await prisma.savedAnswer.findUniqueOrThrow({ where: { id: answerId } })).corrections).toBe(1);
  });

  it("enough corrections pause auto-send by themselves", async () => {
    await (await asOwner()).patch(`/api/v1/admin/saved-answers/${answerId}`, { autoSend: true });
    for (let i = 0; i < 3; i++) {
      const t = await thread("delivery charge koto");
      // Staff answered first this time (the draft path): make a draft from the library, then rewrite it.
      await prisma.conversationDraft.create({ data: { conversationId: t.id, body: "Dhaka: 60 taka", intent: "saved", basedOnMessageId: t.questionId, savedAnswerId: answerId } });
      await (await asOwner()).post(`/api/v1/admin/conversations/${t.id}/replies`, { channel: "WHATSAPP", body: `Eid offer e free delivery cholche ${i}` });
    }
    const a = (await list()).approved.find((x: { id: string }) => x.id === answerId);
    expect(a).toMatchObject({ autoSend: false, autoPausedAt: expect.any(String) });
  });

  it("the list counts replies sent without the AI", async () => {
    expect((await list()).answeredWithoutAi).toBeGreaterThanOrEqual(3);
  });

  it("an answer can be written by hand, with other ways of asking", async () => {
    const res = await (await asOwner()).post("/api/v1/admin/saved-answers", {
      title: "Apnader shop kothay?",
      answer: "Amader online shop: {website}",
      examples: ["dokan kothay", "showroom ache?"],
      autoSend: true,
    });
    expect(res.status).toBe(201);
    const t = await thread("dokan ta kothay bhai");
    expect(await assistConversation(t.questionId, noAi)).toBe("auto");
    const out = await prisma.conversationMessage.findFirstOrThrow({ where: { conversationId: t.id, direction: "OUT" } });
    expect(out.body).toMatch(/^Amader online shop: http/);
  });
});
