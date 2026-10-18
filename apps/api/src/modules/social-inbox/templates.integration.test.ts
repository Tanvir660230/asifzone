import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as Array<{ path: string; body: Record<string, unknown> }>);
const meta = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("../../providers/social/meta-graph", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchApprovedTemplates: vi.fn(async () => meta.templates),
  postGraph: vi.fn(async (req: { path: string; body: Record<string, unknown> }) => (sent.push(req), `wamid.tpl.${sent.length}.${Date.now()}`)),
}));

import { prisma } from "../../config/prisma";
import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { processOutboxEvent } from "../../domain/outbox/processor";
import { asOwner } from "../../test-fixtures";
import { clearTemplateCache, toWhatsAppTemplate } from "./templates.service";
import { whatsAppTemplateRequest } from "../../providers/social/meta-graph";

// WhatsApp after 24 hours: only an approved template may go out. Staff pick one in the Inbox and fill its blanks.

const RUN = Date.now().toString(36);
const H = 3_600_000;
const ids: string[] = [];
let restore: () => void;

const orderUpdate = {
  name: "order_update",
  language: "bn",
  category: "UTILITY",
  parameterFormat: "POSITIONAL",
  components: [
    { type: "HEADER", format: "TEXT", text: "Asif Zone" },
    { type: "BODY", text: "Assalamu alaikum {{1}}, apnar order {{2}} er bepare kotha bolte chai. Ekhane reply korun." },
    { type: "FOOTER", text: "asifzone.com" },
  ],
};
const named = { name: "follow_up", language: "en", category: "UTILITY", parameterFormat: "NAMED", components: [{ type: "BODY", text: "Hi {{customer_name}}, any questions?" }] };
const imageHeader = { name: "promo", language: "en", category: "MARKETING", parameterFormat: "POSITIONAL", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Sale!" }] };
const urlButton = {
  name: "track",
  language: "en",
  category: "UTILITY",
  parameterFormat: "POSITIONAL",
  components: [{ type: "BODY", text: "Track it" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.com/{{1}}" }] }],
};

beforeAll(() => {
  restore = overrideIntegrationsForTests({ WHATSAPP_PHONE_NUMBER_ID: "555666", WHATSAPP_ACCESS_TOKEN: "wa-token", WHATSAPP_WABA_ID: "2000001" });
  meta.templates = [orderUpdate, named, imageHeader, urlButton];
});
beforeEach(() => {
  sent.length = 0;
  clearTemplateCache();
});
afterAll(async () => {
  restore();
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

async function waThread(agoMs: number, channel: "WHATSAPP" | "MESSENGER" = "WHATSAPP") {
  const c = await prisma.conversation.create({
    data: {
      channel,
      externalThreadId: `${channel}-tpl-${RUN}-${ids.length}`,
      subject: "chat",
      contactName: "Rahim",
      phone: "01812345678",
      lastInboundAt: new Date(Date.now() - agoMs),
      messages: { create: { direction: "IN", channel, body: "Order kobe pabo?", author: "CUSTOMER", createdAt: new Date(Date.now() - agoMs) } },
    },
  });
  ids.push(c.id);
  return c;
}

describe("templates offered", () => {
  it("only templates the Inbox can fill from text: no media headers, no blanks in buttons", async () => {
    const res = await (await asOwner()).get("/api/v1/admin/conversations/whatsapp-templates");
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t: { name: string }) => t.name)).toEqual(["order_update", "follow_up"]);
    expect(res.body.templates[0]).toMatchObject({ params: ["1", "2"], named: false, header: "Asif Zone" });
    expect(res.body.templates[1]).toMatchObject({ params: ["customer_name"], named: true });
  });

  it("the send request names named placeholders and lists positional ones in order", () => {
    expect(whatsAppTemplateRequest("880181", { name: "follow_up", language: "en", params: ["Rahim"], paramNames: ["customer_name"] }).body).toMatchObject({
      type: "template",
      template: { name: "follow_up", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Rahim", parameter_name: "customer_name" }] }] },
    });
    expect(toWhatsAppTemplate(orderUpdate as never)!.params).toEqual(["1", "2"]);
  });
});

describe("replying with a template", () => {
  it("after 24 hours a template goes out on WhatsApp; the thread shows its filled-in text", async () => {
    const c = await waThread(30 * H);
    const res = await (await asOwner()).post(`/api/v1/admin/conversations/${c.id}/replies`, {
      channel: "WHATSAPP",
      template: { name: "order_update", language: "bn", params: ["Rahim bhai", "ORD-1001"] },
    });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe("Asif Zone\n\nAssalamu alaikum Rahim bhai, apnar order ORD-1001 er bepare kotha bolte chai. Ekhane reply korun.\n\nasifzone.com");
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { consumer_eventKey: { consumer: "conversation-reply", eventKey: res.body.id } } });
    expect(await processOutboxEvent(event.id)).toMatchObject({ result: "sent" });
    expect(sent[0]!.body).toMatchObject({
      to: c.externalThreadId,
      type: "template",
      template: { name: "order_update", language: { code: "bn" }, components: [{ type: "body", parameters: [{ type: "text", text: "Rahim bhai" }, { type: "text", text: "ORD-1001" }] }] },
    });
  });

  it("the wrong number of values, an unknown template, or a template on Messenger is refused", async () => {
    const owner = await asOwner();
    const c = await waThread(30 * H);
    const few = await owner.post(`/api/v1/admin/conversations/${c.id}/replies`, { channel: "WHATSAPP", template: { name: "order_update", language: "bn", params: ["Rahim"] } });
    expect([few.status, few.body.details?.code]).toEqual([400, "TEMPLATE_PARAMS"]);
    const unknown = await owner.post(`/api/v1/admin/conversations/${c.id}/replies`, { channel: "WHATSAPP", template: { name: "promo", language: "en", params: [] } });
    expect([unknown.status, unknown.body.details?.code]).toEqual([400, "TEMPLATE_UNKNOWN"]);
    const m = await waThread(1 * H, "MESSENGER");
    expect((await owner.post(`/api/v1/admin/conversations/${m.id}/replies`, { channel: "MESSENGER", template: { name: "follow_up", language: "en", params: ["x"] } })).status).toBe(400);
  });

  it("free text after 24 hours is still refused", async () => {
    const c = await waThread(30 * H);
    const res = await (await asOwner()).post(`/api/v1/admin/conversations/${c.id}/replies`, { channel: "WHATSAPP", body: "Hello" });
    expect(res.body.details?.code).toBe("WINDOW_CLOSED");
  });
});
