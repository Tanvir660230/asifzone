import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pages = vi.hoisted(() => ({ messenger: [] as unknown[], instagram: [] as unknown[], calls: [] as string[] }));
vi.mock("../../providers/social/meta-graph", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPageConversations: vi.fn(async (platform: "messenger" | "instagram") => (pages.calls.push(platform), pages[platform])),
}));

import { prisma } from "../../config/prisma";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { processOutboxEvent } from "../../domain/outbox/processor";
import { asOwner } from "../../test-fixtures";
import { conversationsToEvents } from "./history-import";

// Import past chats: recent Messenger / Instagram conversations copied into the Inbox once, without waking the AI.

const RUN = Date.now().toString(36);
const PAGE = "100200300400500";
const IG = "17841400000000001";
const PSID = `70${Date.now()}`;
const IGSID = `90${Date.now()}`;
let restore: () => void;

const convo = (customer: string, own: string, name: string, prefix: string) => ({
  id: `t_${prefix}`,
  updatedTime: new Date().toISOString(),
  participants: [
    { id: customer, name },
    { id: own, name: "Asif Zone" },
  ],
  messages: [
    { id: `${prefix}.3`, createdTime: "2026-10-10T10:02:00Z", fromId: own, text: "Ji 1450 taka", hasAttachment: false },
    { id: `${prefix}.2`, createdTime: "2026-10-10T10:01:00Z", fromId: customer, text: null, hasAttachment: true },
    { id: `${prefix}.1`, createdTime: "2026-10-10T10:00:00Z", fromId: customer, text: "Dam koto?", hasAttachment: false },
  ],
});

beforeAll(() => {
  restore = overrideIntegrationsForTests({ META_PAGE_ID: PAGE, META_PAGE_ACCESS_TOKEN: "page-token", META_IG_ACCOUNT_ID: IG });
  pages.messenger = [convo(PSID, PAGE, "Tanha Akter", `m_${RUN}`)];
  pages.instagram = [convo(IGSID, IG, "@sadia.style", `ig_${RUN}`)];
});
afterAll(async () => {
  restore();
  const threads = await prisma.conversation.findMany({ where: { externalThreadId: { in: [PSID, IGSID] } }, select: { id: true } });
  await prisma.conversation.deleteMany({ where: { id: { in: threads.map((t) => t.id) } } });
  await prisma.outboxEvent.deleteMany({ where: { consumer: "meta-history-import", aggregateId: "meta-history-import" } });
  await prisma.$disconnect();
});

describe("conversationsToEvents", () => {
  it("the customer is the participant who isn't the store; the store's messages are phone replies; attachments get a placeholder", () => {
    const events = conversationsToEvents("MESSENGER", [convo("7001", PAGE, "Rahim", "x") as never], [PAGE]);
    expect(events.map((e) => [e.direction, e.body, e.threadId, e.historical])).toEqual([
      ["OUT", "Ji 1450 taka", "7001", true],
      ["IN", "[Attachment]", "7001", true],
      ["IN", "Dam koto?", "7001", true],
    ]);
    expect(events.find((e) => e.direction === "IN")!.name).toBe("Rahim");
  });
});

describe("Import past chats", () => {
  it("the owner queues it; the job copies Messenger and Instagram chats in once, as handled threads with names", async () => {
    const owner = await asOwner();
    const res = await owner.post("/api/settings/integrations/meta/import-history", { days: 30 });
    expect(res.status).toBe(202);
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { consumer: "meta-history-import" }, orderBy: { createdAt: "desc" } });
    expect(await processOutboxEvent(event.id)).toMatchObject({ outcome: "processed", result: "sent" });
    expect(pages.calls).toEqual(["messenger", "instagram"]);

    const m = await prisma.conversation.findUniqueOrThrow({
      where: { channel_externalThreadId: { channel: "MESSENGER", externalThreadId: PSID } },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(m).toMatchObject({ contactName: "Tanha Akter", status: "HANDLED" });
    expect(m.messages.map((x) => [x.author, x.body])).toEqual([
      ["CUSTOMER", "Dam koto?"],
      ["CUSTOMER", "[Attachment]"],
      ["PHONE", "Ji 1450 taka"],
    ]);
    expect(await prisma.outboxEvent.count({ where: { consumer: "conversation-assist", aggregateId: m.id } })).toBe(0);
    expect(await prisma.conversation.findUnique({ where: { channel_externalThreadId: { channel: "INSTAGRAM", externalThreadId: IGSID } } })).toMatchObject({ contactName: "@sadia.style" });

    // Running it again adds nothing.
    await owner.post("/api/settings/integrations/meta/import-history", { days: 30 });
    const again = await prisma.outboxEvent.findFirstOrThrow({ where: { consumer: "meta-history-import" }, orderBy: { createdAt: "desc" } });
    await processOutboxEvent(again.id);
    expect(await prisma.conversationMessage.count({ where: { conversationId: m.id } })).toBe(3);
  });

  it("refuses without a Page connection, and more than 90 days", async () => {
    const owner = await asOwner();
    expect((await owner.post("/api/settings/integrations/meta/import-history", { days: 91 })).status).toBe(400);
    const undo = overrideIntegrationsForTests({ META_PAGE_ACCESS_TOKEN: "" });
    try {
      const res = await owner.post("/api/settings/integrations/meta/import-history", { days: 7 });
      expect([res.status, res.body.details?.code]).toEqual([400, "PAGE_NOT_CONNECTED"]);
    } finally {
      undo();
    }
  });
});
