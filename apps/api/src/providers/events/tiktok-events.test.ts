import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const live = vi.hoisted(() => ({ on: true }));
vi.mock("../../lib/provider-guard", () => ({ liveProvidersEnabled: () => live.on }));

import { overrideIntegrationsForTests } from "../../config/integration-overrides";
import { env } from "../../config/env";
import { TikTokApiError } from "../errors";
import { isTikTokEventsEnabled, sendTikTokEvent, type TikTokServerEvent } from "./tiktok-events";

const EVENT: TikTokServerEvent = {
  event: "Purchase",
  event_time: 1_792_000_000,
  event_id: "purchase_AZ-1042",
  user: { email: "a".repeat(64), phone: "b".repeat(64), ip: "203.0.113.9", user_agent: "Mozilla/5.0" },
  page: { url: "https://asifzone.com/order-confirmation/AZ-1042" },
  properties: { currency: "BDT", value: 2490, order_id: "AZ-1042", content_type: "product", contents: [{ content_id: "var_1", quantity: 1, price: 2490 }] },
};

let restore: () => void;
const fetchMock = vi.fn();

beforeEach(() => {
  live.on = true;
  restore = overrideIntegrationsForTests({ TIKTOK_PIXEL_ID: "CPIXEL123", TIKTOK_ACCESS_TOKEN: "secret-token", TIKTOK_TEST_EVENT_CODE: "TEST123" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("isTikTokEventsEnabled", () => {
  it("needs the pixel id and the access token", () => {
    expect(isTikTokEventsEnabled()).toBe(true);
    const r = overrideIntegrationsForTests({ TIKTOK_ACCESS_TOKEN: "" });
    expect(isTikTokEventsEnabled()).toBe(false);
    r();
  });

  it("outside production, only with a test event code", () => {
    expect(env.nodeEnv).not.toBe("production");
    const r = overrideIntegrationsForTests({ TIKTOK_TEST_EVENT_CODE: "" });
    expect(isTikTokEventsEnabled()).toBe(false);
    r();
  });

  it("never with live providers off", () => {
    live.on = false;
    expect(isTikTokEventsEnabled()).toBe(false);
  });
});

describe("sendTikTokEvent", () => {
  it("posts one web event for the pixel, with the token only in the header", async () => {
    fetchMock.mockResolvedValue(reply(200, { code: 0, message: "OK" }));
    await sendTikTokEvent(EVENT);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect((init.headers as Record<string, string>)["Access-Token"]).toBe("secret-token");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ event_source: "web", event_source_id: "CPIXEL123", data: [EVENT], test_event_code: "TEST123" });
    expect(init.body as string).not.toContain("secret-token");
  });

  it("treats a TikTok error code on HTTP 200 as a permanent failure", async () => {
    fetchMock.mockResolvedValue(reply(200, { code: 40001, message: "Invalid access token", request_id: "req-1" }));
    const err = await sendTikTokEvent(EVENT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TikTokApiError);
    expect((err as TikTokApiError).retryable).toBe(false);
    expect((err as Error).message).toContain("40001");
    expect((err as Error).message).toContain("req-1");
  });

  it("retries rate limits and server errors", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { code: 40100, message: "Too many requests" }));
    expect(((await sendTikTokEvent(EVENT).catch((e: unknown) => e)) as TikTokApiError).retryable).toBe(true);
    fetchMock.mockResolvedValueOnce(reply(503, {}));
    expect(((await sendTikTokEvent(EVENT).catch((e: unknown) => e)) as TikTokApiError).retryable).toBe(true);
    fetchMock.mockResolvedValueOnce(reply(429, {}));
    expect(((await sendTikTokEvent(EVENT).catch((e: unknown) => e)) as TikTokApiError).retryable).toBe(true);
  });

  it("retries a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const err = (await sendTikTokEvent(EVENT).catch((e: unknown) => e)) as TikTokApiError;
    expect(err.retryable).toBe(true);
  });

  it("never puts customer data in the error message", async () => {
    fetchMock.mockResolvedValue(reply(400, { code: 40002, message: "Invalid parameter" }));
    const err = (await sendTikTokEvent(EVENT).catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain("a".repeat(64));
    expect(err.message).not.toContain("203.0.113.9");
  });
});
