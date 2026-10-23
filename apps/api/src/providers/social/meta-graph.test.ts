import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";

// postGraph refuses to send under vitest (no live providers); these tests exercise the real transport with fetch stubbed.
vi.mock("../../lib/provider-guard", async (importOriginal) => ({ ...(await importOriginal<object>()), liveProvidersEnabled: () => true }));

import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { MetaApiError, ProviderNotConfiguredError } from "../errors";
import { commentReplyRequest, pageMessageRequest, postGraph, privateReplyRequest, whatsAppTextRequest } from "./meta-graph";

const PAGE_TOKEN = "EAAGpagetoken1234567890";
const WA_TOKEN = "EAAGwhatsapptoken0987654321";

beforeAll(() => {
  overrideIntegrationsForTests({ META_PAGE_ID: "100200300", META_PAGE_ACCESS_TOKEN: PAGE_TOKEN, WHATSAPP_PHONE_NUMBER_ID: "555666", WHATSAPP_ACCESS_TOKEN: WA_TOKEN });
});
afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, json: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(json), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Graph requests", () => {
  it("WhatsApp text goes to the phone number id", () => {
    expect(whatsAppTextRequest("8801812345678", "Dam 1450 taka")).toEqual({
      path: "/555666/messages",
      token: "whatsapp",
      body: { messaging_product: "whatsapp", recipient_type: "individual", to: "8801812345678", type: "text", text: { body: "Dam 1450 taka", preview_url: true } },
    });
  });

  it("a Page message is a RESPONSE, or a HUMAN_AGENT tagged message past 24 hours", () => {
    expect(pageMessageRequest("psid1", "hi", false).body).toEqual({ recipient: { id: "psid1" }, messaging_type: "RESPONSE", message: { text: "hi" } });
    expect(pageMessageRequest("psid1", "hi", true).body).toEqual({ recipient: { id: "psid1" }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message: { text: "hi" } });
    expect(pageMessageRequest("psid1", "hi", false).path).toBe("/100200300/messages");
  });

  it("a comment reply and a private reply", () => {
    expect(commentReplyRequest("c_1", "Inbox check korun")).toEqual({ path: "/c_1/comments", token: "page", body: { message: "Inbox check korun" } });
    expect(privateReplyRequest("c_1", "Dam 1450")).toEqual({ path: "/100200300/messages", token: "page", body: { recipient: { comment_id: "c_1" }, message: { text: "Dam 1450" } } });
  });
});

describe("postGraph", () => {
  it("sends the token as a Bearer header (never in the URL) and returns Meta's id", async () => {
    const fetch = stubFetch(200, { messaging_product: "whatsapp", contacts: [], messages: [{ id: "wamid.SENT1" }] });
    expect(await postGraph(whatsAppTextRequest("8801812345678", "hi"))).toBe("wamid.SENT1");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/555666/messages");
    expect(url).not.toContain(WA_TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${WA_TOKEN}`);
    expect(String(init.body)).not.toContain(WA_TOKEN);
  });

  it("reads message_id (Messenger) and id (comments)", async () => {
    stubFetch(200, { recipient_id: "psid1", message_id: "m_SENT" });
    expect(await postGraph(pageMessageRequest("psid1", "hi", false))).toBe("m_SENT");
    stubFetch(200, { id: "c_reply_1" });
    expect(await postGraph(commentReplyRequest("c_1", "hi"))).toBe("c_reply_1");
  });

  it("Meta's rejection is a permanent MetaApiError with Meta's message and no token", async () => {
    stubFetch(400, { error: { message: "This message is sent outside of allowed window.", code: 10, error_subcode: 2018278, fbtrace_id: "Abc" } });
    const err = await postGraph(pageMessageRequest("psid1", "hi", false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ retryable: false });
    expect((err as Error).message).toContain("outside of allowed window");
    expect((err as Error).message).not.toContain(PAGE_TOKEN);
  });

  it("5xx, 429 and is_transient are retryable", async () => {
    stubFetch(503, {});
    await expect(postGraph(commentReplyRequest("c_1", "x"))).rejects.toMatchObject({ retryable: true });
    stubFetch(429, { error: { message: "rate" } });
    await expect(postGraph(commentReplyRequest("c_1", "x"))).rejects.toMatchObject({ retryable: true });
    stubFetch(400, { error: { message: "temp", is_transient: true } });
    await expect(postGraph(commentReplyRequest("c_1", "x"))).rejects.toMatchObject({ retryable: true });
  });

  it("without a token it refuses before calling Meta", async () => {
    const undo = overrideIntegrationsForTests({ WHATSAPP_ACCESS_TOKEN: "" });
    const fetch = stubFetch(200, {});
    try {
      await expect(postGraph(whatsAppTextRequest("880", "x"))).rejects.toBeInstanceOf(ProviderNotConfiguredError);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      undo();
    }
  });
});
