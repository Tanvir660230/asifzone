import { test, expect, type Page } from "@playwright/test";

// Site health › Site speed: a storefront visit sends its Core Web Vitals in one beacon, and samples show up in
// Admin › System health per kind of page. E2E_API_URL must point at the API the web app talks to.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const NAV = { timeout: 30_000 };
// The API skips automated browsers; samples posted here stand in for a real customer's phone.
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
}

test("a storefront visit sends its speed in one beacon when the visitor leaves", async ({ page }) => {
  // Playwright can't read a sendBeacon Blob body from the request, so the page keeps a copy of what it sends.
  await page.addInitScript(() => {
    const sent: Array<Promise<string>> = [];
    (window as unknown as { __vitals: typeof sent }).__vitals = sent;
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (String(url).endsWith("/api/v1/vitals") && data instanceof Blob) sent.push(data.text());
      return original(url, data);
    };
  });
  await page.goto("/", NAV);
  await page.waitForLoadState("load");
  await page.waitForTimeout(1500); // FCP/TTFB are reported shortly after load
  const beacon = page.waitForRequest((r) => r.url().endsWith("/api/v1/vitals") && r.method() === "POST", NAV);
  // Switching apps / locking the phone: the tab becomes hidden, which is when the queue is sent.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await beacon;
  const sentBodies = await page.evaluate(() => Promise.all((window as unknown as { __vitals: Array<Promise<string>> }).__vitals));
  expect(sentBodies).toHaveLength(1);
  const body = JSON.parse(sentBodies[0]!) as { samples: Array<{ metric: string; pageKind: string; device: string }> };
  expect(body.samples.length).toBeGreaterThan(0);
  expect(body.samples.every((s) => s.pageKind === "home" && ["mobile", "desktop"].includes(s.device))).toBe(true);
  expect(body.samples.map((s) => s.metric)).toEqual(expect.arrayContaining(["TTFB"]));
});

test("Site speed shows real-visitor numbers per kind of page", async ({ page, request }) => {
  const samples = [
    { metric: "LCP", value: 2100, pageKind: "account", device: "mobile" },
    { metric: "INP", value: 650, pageKind: "account", device: "mobile" },
    { metric: "CLS", value: 0.02, pageKind: "account", device: "mobile" },
  ];
  const sent = await request.post(`${API}/api/v1/vitals`, { data: { samples }, headers: { "User-Agent": PHONE_UA } });
  expect(sent.status()).toBe(204);

  await login(page);
  await page.goto("/admin/system-health#speed");
  const row = page.getByTestId("speed-row").filter({ hasText: "Customer account" });
  await expect(row).toBeVisible(NAV);
  await expect(row).toContainText("Slow"); // INP 650 ms is past Google's 500 ms "poor" line (p75 over every sample)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
