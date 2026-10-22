import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Meta's side of Embedded Signup, recorded instead of called.
const calls = vi.hoisted(() => [] as string[]);
const fail = vi.hoisted(() => ({ step: "" }));
vi.mock("../../providers/social/meta-graph", async (importOriginal) => {
  const step = (name: string) => {
    calls.push(name);
    if (fail.step === name) throw Object.assign(new Error(`Meta refused ${name}`), { name: "MetaApiError", retryable: false });
  };
  return {
    ...(await importOriginal<object>()),
    exchangeSignupCode: vi.fn(async (code: string) => (step(`exchange:${code}`), "EAAG-business-token-VALUE-9z9z")),
    businessPhoneNumbers: vi.fn(async (waba: string) => (step(`numbers:${waba}`), [{ id: "1065400000001", display: "+880 1711-000000" }])),
    subscribeAppToWaba: vi.fn(async (waba: string) => step(`subscribe:${waba}`)),
    registerPhoneNumber: vi.fn(async (id: string, _t: string, pin: string) => step(`register:${id}:${/^\d{6}$/.test(pin) ? "pin6" : "badpin"}`)),
    syncBusinessApp: vi.fn(async (id: string, _t: string, type: string) => step(`sync:${id}:${type}`)),
  };
});

import { INTEGRATION_KEYS } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { asOwner } from "../../test-fixtures";
import { loadIntegrationOverrides } from "./integrations.service";

// Settings › Integrations › Connect WhatsApp: the server half of Meta's Embedded Signup.

async function reset() {
  await prisma.integrationSetting.deleteMany({ where: { key: { in: INTEGRATION_KEYS } } });
  await loadIntegrationOverrides();
}

beforeEach(async () => {
  calls.length = 0;
  fail.step = "";
  await reset();
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

const connect = async (body: object) => (await asOwner()).post("/api/settings/integrations/whatsapp/connect", body);

describe("Connect WhatsApp", () => {
  it("current number (coexistence): token, number, webhooks, then contacts and history sync — no registration", async () => {
    const res = await connect({ code: "c1", wabaId: "2000001", coexistence: true });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["exchange:c1", "numbers:2000001", "subscribe:2000001", "sync:1065400000001:smb_app_state_sync", "sync:1065400000001:history"]);
    expect(res.body).toMatchObject({ phoneNumber: "+880 1711-000000", warnings: [] });
    expect(JSON.stringify(res.body)).not.toContain("EAAG-business-token-VALUE-9z9z");
    expect(env.whatsapp.phoneNumberId).toBe("1065400000001");
    expect(env.whatsapp.accessToken).toBe("EAAG-business-token-VALUE-9z9z");
    const wa = res.body.view.integrations.find((i: { id: string }) => i.id === "whatsapp");
    expect(wa.configured).toBe(true);
    expect(wa.fields.find((f: { key: string }) => f.key === "WHATSAPP_WABA_ID")).toMatchObject({ value: "2000001" });
  });

  it("a refused history sync is a warning, not a failure — the number is still connected", async () => {
    fail.step = "sync:1065400000001:history";
    const res = await connect({ code: "c2", wabaId: "2000001", coexistence: true });
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([expect.stringContaining("chat history")]);
    expect(env.whatsapp.phoneNumberId).toBe("1065400000001");
  });

  it("a new number is registered with a 6-digit PIN that is kept (secret)", async () => {
    const res = await connect({ code: "c3", wabaId: "2000002", phoneNumberId: "1065400000001", coexistence: false });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["exchange:c3", "numbers:2000002", "subscribe:2000002", "register:1065400000001:pin6"]);
    const pin = res.body.view.integrations.find((i: { id: string }) => i.id === "whatsapp").fields.find((f: { key: string }) => f.key === "WHATSAPP_PIN");
    expect(pin).toMatchObject({ source: "dashboard", value: null });
  });

  it("an expired code saves nothing and says what to do", async () => {
    fail.step = "exchange:old";
    const res = await connect({ code: "old", wabaId: "2000001", coexistence: true });
    expect([res.status, res.body.details?.code]).toEqual([400, "WHATSAPP_CONNECT_FAILED"]);
    expect(res.body.error).toContain("30 seconds");
    expect(env.whatsapp.phoneNumberId).toBe("");
  });

  it("a failed webhook subscription saves nothing", async () => {
    fail.step = "subscribe:2000001";
    const res = await connect({ code: "c4", wabaId: "2000001", coexistence: true });
    expect(res.status).toBe(400);
    expect(env.whatsapp.accessToken).toBe("");
  });

  it("rejects malformed ids", async () => {
    expect((await connect({ code: "c5", wabaId: "../me", coexistence: true })).status).toBe(400);
  });
});
