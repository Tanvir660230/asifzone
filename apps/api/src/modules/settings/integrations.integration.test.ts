import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { INTEGRATION_KEYS } from "@clothing-brand/shared";
import { app } from "../../app";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { open, openIntegrationValue, seal, sealIntegrationValue } from "../../lib/secret-box";
import { asOwner } from "../../test-fixtures";
import { loadIntegrationOverrides } from "./integrations.service";

// Settings › Integrations: an OWNER manages third-party credentials from the dashboard. Dashboard values win over the
// environment, are sealed at rest, and never come back out of the API.

async function reset() {
  await prisma.integrationSetting.deleteMany({ where: { key: { in: INTEGRATION_KEYS } } });
  await loadIntegrationOverrides();
}

beforeEach(reset);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("integration secret box", () => {
  it("round-trips, is bound to its field, and refuses tampering", () => {
    const sealed = sealIntegrationValue("STEADFAST_API_KEY", "sf-key-123");
    expect(sealed).not.toContain("sf-key-123");
    expect(openIntegrationValue("STEADFAST_API_KEY", sealed)).toBe("sf-key-123");
    expect(openIntegrationValue("RESEND_API_KEY", sealed)).toBeNull();
    const [v, iv, tag, body] = sealed.split(".");
    const flipped = `${body![0] === "A" ? "B" : "A"}${body!.slice(1)}`;
    expect(openIntegrationValue("STEADFAST_API_KEY", [v, iv, tag, flipped].join("."))).toBeNull();
    // A payment-link seal is a different key: neither opens the other.
    expect(open(sealed)).toBeNull();
    expect(openIntegrationValue("STEADFAST_API_KEY", seal("sf-key-123"))).toBeNull();
  });
});

describe("Settings › Integrations", () => {
  it("saves credentials sealed, applies them at once, and never returns a secret", async () => {
    const owner = await asOwner();
    const secret = "steadfast-secret-VALUE-9f3a";
    const res = await owner.patch("/api/settings/integrations", { values: { STEADFAST_API_KEY: "steadfast-key-VALUE-77b1", STEADFAST_SECRET_KEY: secret } });
    expect(res.status).toBe(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("steadfast-key-VALUE-77b1");
    const steadfast = res.body.integrations.find((i: { id: string }) => i.id === "steadfast");
    expect(steadfast.configured).toBe(true);
    expect(steadfast.fields.find((f: { key: string }) => f.key === "STEADFAST_SECRET_KEY")).toMatchObject({ source: "dashboard", value: null, hint: "…9f3a" });

    // Effective immediately for the providers, sealed in the database.
    expect(env.steadfast.apiKey).toBe("steadfast-key-VALUE-77b1");
    expect(env.steadfast.secretKey).toBe(secret);
    const row = await prisma.integrationSetting.findUniqueOrThrow({ where: { key: "STEADFAST_SECRET_KEY" } });
    expect(row.value).not.toContain(secret);
    expect(row.updatedById).toBeTruthy();

    // Audited with the keys only.
    const audit = await prisma.auditLog.findFirst({ where: { action: "settings.integrations_update" }, orderBy: { createdAt: "desc" } });
    expect(audit?.metadata).toMatchObject({ keys: ["STEADFAST_API_KEY", "STEADFAST_SECRET_KEY"] });
    expect(JSON.stringify(audit?.metadata)).not.toContain(secret);
  });

  it("Social Inbox: Meta and WhatsApp credentials are saved, secrets never returned, and the webhook URL is given", async () => {
    const owner = await asOwner();
    const appSecret = "meta-app-secret-VALUE-1d2e";
    const waToken = "EAAG-whatsapp-token-VALUE-5c6d";
    const res = await owner.patch("/api/settings/integrations", {
      values: { META_APP_SECRET: appSecret, META_WEBHOOK_VERIFY_TOKEN: "verify-VALUE-0a0b", WHATSAPP_PHONE_NUMBER_ID: "106540352242922", WHATSAPP_ACCESS_TOKEN: waToken, INBOX_AI_AUTOREPLY: "factual" },
    });
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(appSecret);
    expect(raw).not.toContain(waToken);
    const byId = (id: string) => res.body.integrations.find((i: { id: string }) => i.id === id);
    expect(byId("meta-app").configured).toBe(true);
    expect(byId("whatsapp").configured).toBe(true);
    expect(byId("whatsapp").fields.find((f: { key: string }) => f.key === "WHATSAPP_PHONE_NUMBER_ID")).toMatchObject({ value: "106540352242922" });
    expect(byId("meta-messages").configured).toBe(false);
    expect(res.body.metaWebhookUrl).toBe(`${env.apiOrigin.replace(/\/+$/, "")}/api/v1/webhooks/meta`);
    expect(env.metaInbox.appSecret).toBe(appSecret);
    expect(env.inboxAi.autoReply).toBe("factual");
  });

  it("removing a dashboard value falls back to the environment variable", async () => {
    vi.stubEnv("BULKSMSBD_SENDER_ID", "FromServer");
    const owner = await asOwner();
    await owner.patch("/api/settings/integrations", { values: { BULKSMSBD_SENDER_ID: "FromDashboard" } });
    expect(env.bulkSmsBd.senderId).toBe("FromDashboard");

    const res = await owner.patch("/api/settings/integrations", { values: { BULKSMSBD_SENDER_ID: null } });
    expect(res.status).toBe(200);
    expect(env.bulkSmsBd.senderId).toBe("FromServer");
    const field = res.body.integrations.find((i: { id: string }) => i.id === "bulksmsbd").fields.find((f: { key: string }) => f.key === "BULKSMSBD_SENDER_ID");
    expect(field).toMatchObject({ source: "server", value: "FromServer" });
    expect(await prisma.integrationSetting.count()).toBe(0);
  });

  it("rejects unknown keys, unknown options and live payment mode outside production", async () => {
    const owner = await asOwner();
    expect((await owner.patch("/api/settings/integrations", { values: { DATABASE_URL: "postgres://x" } })).status).toBe(400);
    expect((await owner.patch("/api/settings/integrations", { values: { SSLCOMMERZ_IS_LIVE: "maybe" } })).status).toBe(400);
    expect((await owner.patch("/api/settings/integrations", { values: {} })).status).toBe(400);
    const live = await owner.patch("/api/settings/integrations", { values: { SSLCOMMERZ_IS_LIVE: "true" } });
    expect(live.status).toBe(400);
    expect(live.body.error).toMatch(/production/);
    expect(env.sslcommerz.isLive).toBe(false);
    expect((await owner.patch("/api/settings/integrations", { values: { SSLCOMMERZ_IS_LIVE: "false" } })).status).toBe(200);
  });

  it("is owner-only", async () => {
    expect((await request(app).get("/api/settings/integrations")).status).toBe(401);
    expect((await request(app).patch("/api/settings/integrations").send({ values: { CLARITY_ID: "x" } })).status).toBe(401);
  });

  it("serves only the public ids on the public settings endpoint", async () => {
    const owner = await asOwner();
    await owner.patch("/api/settings/integrations", { values: { META_PIXEL_ID: "1234567890", META_ACCESS_TOKEN: "EAAG-secret-token-xyz", CLARITY_ID: "clar1ty" } });
    const res = await request(app).get("/api/settings");
    expect(res.body.settings.integrationIds).toEqual({ metaPixelId: "1234567890", tiktokPixelId: "", clarityId: "clar1ty", googleClientId: "", vapidPublicKey: "" });
    expect(JSON.stringify(res.body)).not.toContain("EAAG-secret-token-xyz");
  });

  it("generates a web-push key pair, exposing only the public half", async () => {
    const owner = await asOwner();
    const res = await owner.post("/api/settings/integrations/webpush/generate-keys");
    expect(res.status).toBe(200);
    const fields = res.body.integrations.find((i: { id: string }) => i.id === "webpush").fields;
    const publicKey = fields.find((f: { key: string }) => f.key === "WEB_PUSH_PUBLIC_KEY");
    const privateKey = fields.find((f: { key: string }) => f.key === "WEB_PUSH_PRIVATE_KEY");
    expect(publicKey.value).toBe(env.webPush.publicKey);
    expect(publicKey.value.length).toBeGreaterThan(40);
    expect(privateKey).toMatchObject({ source: "dashboard", value: null });
    expect(JSON.stringify(res.body)).not.toContain(env.webPush.privateKey);
  });

  it("ignores a stored value that does not open, and flags it for re-entry", async () => {
    await prisma.integrationSetting.create({ data: { key: "RESEND_API_KEY", value: sealIntegrationValue("STEADFAST_API_KEY", "copied-row") } });
    await loadIntegrationOverrides();
    expect(env.resend.apiKey).not.toBe("copied-row");
    const res = await (await asOwner()).get("/api/settings/integrations");
    const field = res.body.integrations.find((i: { id: string }) => i.id === "resend").fields.find((f: { key: string }) => f.key === "RESEND_API_KEY");
    expect(field.unreadable).toBe(true);
    expect(field.source).not.toBe("dashboard");
  });
});
