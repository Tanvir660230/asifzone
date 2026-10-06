import { describe, expect, it } from "vitest";
import { readPublicRuntimeConfig, readServerRuntimeConfig } from "@clothing-brand/shared";

// Phase 1A: the web app's runtime configuration contract — one build, any installation's environment.

const ASIF = {
  NODE_ENV: "production",
  INSTALL_ID: "asifzone",
  SITE_URL: "https://asif.example/",
  PUBLIC_API_URL: "https://asif.example",
  API_INTERNAL_URL: "http://api:4000",
  META_PIXEL_ID: "111",
  TIKTOK_PIXEL_ID: "T111",
  CLARITY_ID: "c111",
  GOOGLE_CLIENT_ID: "g111.apps.googleusercontent.com",
  WEB_PUSH_PUBLIC_KEY: "vapid-public-111",
  REVALIDATE_SECRET: "secret-asif",
};
const CLIENT_B = {
  NODE_ENV: "production",
  INSTALL_ID: "client-b",
  SITE_URL: "https://shop.client-b.example",
  PUBLIC_API_URL: "https://shop.client-b.example",
  MEDIA_BASE_URL: "https://cdn.client-b.example/uploads/",
  META_PIXEL_ID: "222",
  STORE_THEME: "Nasihamart",
  REVALIDATE_SECRET: "secret-b",
};

describe("runtime configuration", () => {
  it("resolves each installation's own public configuration from the same code", () => {
    const a = readPublicRuntimeConfig(ASIF);
    const b = readPublicRuntimeConfig(CLIENT_B);
    expect(a).toEqual({
      siteUrl: "https://asif.example",
      apiUrl: "https://asif.example",
      mediaBaseUrl: "/uploads",
      metaPixelId: "111",
      tiktokPixelId: "T111",
      clarityId: "c111",
      googleClientId: "g111.apps.googleusercontent.com",
      vapidPublicKey: "vapid-public-111",
      theme: "default",
    });
    expect(b.siteUrl).toBe("https://shop.client-b.example");
    expect(b.mediaBaseUrl).toBe("https://cdn.client-b.example/uploads");
    expect(b.metaPixelId).toBe("222");
    expect(b.tiktokPixelId).toBe("");
    expect(b.theme).toBe("nasihamart");
  });

  it("never puts a server-only value in the public half", () => {
    const pub = readPublicRuntimeConfig(ASIF);
    const serialized = JSON.stringify(pub);
    expect(Object.keys(pub)).not.toContain("revalidateSecret");
    expect(Object.keys(pub)).not.toContain("installId");
    expect(Object.keys(pub)).not.toContain("apiInternalUrl");
    expect(serialized).not.toContain("secret-asif");
    expect(serialized).not.toContain("http://api:4000");
  });

  it("keeps server-only values on the server side", () => {
    const server = readServerRuntimeConfig(ASIF);
    expect(server.installId).toBe("asifzone");
    expect(server.apiInternalUrl).toBe("http://api:4000");
    expect(server.revalidateSecret).toBe("secret-asif");
    // Without an internal URL the server talks to the public one.
    expect(readServerRuntimeConfig(CLIENT_B).apiInternalUrl).toBe("https://shop.client-b.example");
    expect(() => readServerRuntimeConfig({ NODE_ENV: "production" })).toThrow(/INSTALL_ID/);
  });

  it("still accepts the pre-Phase-1 NEXT_PUBLIC_* names, the new names winning", () => {
    const legacy = readPublicRuntimeConfig({ NEXT_PUBLIC_SITE_URL: "https://old.example", NEXT_PUBLIC_META_PIXEL_ID: "999", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "v" });
    expect(legacy).toMatchObject({ siteUrl: "https://old.example", metaPixelId: "999", vapidPublicKey: "v" });
    expect(readPublicRuntimeConfig({ SITE_URL: "https://new.example", NEXT_PUBLIC_SITE_URL: "https://old.example" }).siteUrl).toBe("https://new.example");
  });

  it("falls back to local-development defaults", () => {
    expect(readPublicRuntimeConfig({})).toMatchObject({ siteUrl: "http://localhost:3000", apiUrl: "http://localhost:4000", mediaBaseUrl: "/uploads", metaPixelId: "" });
  });
});
