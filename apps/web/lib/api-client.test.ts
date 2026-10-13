import { afterEach, describe, expect, it, vi } from "vitest";

// Which session a 401 refreshes. Admin screens — and the storefront previews framed under /admin — hold only the admin
// session; a shopper endpoint answering 401 there just means no shopper is signed in. Refreshing the ADMIN session for it
// rotated the admin's CSRF cookie mid-edit (a concurrent PATCH then 403'd) and could trip refresh-token reuse.

vi.mock("./runtime-config", () => ({ apiBaseUrl: () => "http://api.test" }));

function stubBrowser(pathname: string, statusFor: (url: string) => number) {
  const calls: string[] = [];
  vi.stubGlobal("window", { location: { pathname } });
  vi.stubGlobal("document", { cookie: "csrf_token=abc" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      const status = statusFor(url);
      return new Response(status === 204 ? null : JSON.stringify(status === 200 ? { ok: true } : { error: "Login required" }), { status });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("apiFetch session refresh", () => {
  it("never refreshes the admin session for a shopper endpoint's 401 on an admin screen", async () => {
    const calls = stubBrowser("/admin/product-preview-frame", (url) => (url.endsWith("/api/customers/me") ? 401 : 200));
    const { apiFetch } = await import("./api-client");
    await expect(apiFetch("/api/customers/me")).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual(["GET /api/customers/me"]);
  });

  it("still refreshes the admin session when an admin endpoint's access token expired", async () => {
    let expired = true;
    const calls = stubBrowser("/admin/products", (url) => {
      if (url.endsWith("/api/auth/refresh")) return (expired = false), 200;
      return expired ? 401 : 200;
    });
    const { apiFetch } = await import("./api-client");
    await expect(apiFetch("/api/products")).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["GET /api/products", "POST /api/auth/refresh", "GET /api/products"]);
  });

  it("refreshes the shopper session on the storefront", async () => {
    let expired = true;
    const calls = stubBrowser("/account", (url) => {
      if (url.endsWith("/api/customers/refresh")) return (expired = false), 200;
      return expired ? 401 : 200;
    });
    const { apiFetch } = await import("./api-client");
    await expect(apiFetch("/api/customers/me")).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["GET /api/customers/me", "POST /api/customers/refresh", "GET /api/customers/me"]);
  });
});
