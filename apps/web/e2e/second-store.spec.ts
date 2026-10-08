import { expect, test, type Page } from "@playwright/test";

// Phase 12 second-store proof, browser level (contract §20, acceptance 1–2): the same build renders a fictional second
// store — "Northwind Test Goods" — purely from its saved configuration. Identity is changed only through the admin
// settings API (as the admin UI does) and restored afterwards. Nothing here is a real store.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const STORE_B = {
  storeName: "Northwind Test Goods",
  tagline: "A fictional second store",
  legalName: "Northwind Test Goods Ltd.",
  addressLine: "12 Example Road",
  addressCity: "Chattogram",
  addressRegion: "Chattogram",
  addressPostalCode: "4000",
  addressCountry: "BD",
  legalJurisdiction: "Bangladesh",
  supportHours: "Sat–Thu, 10am–6pm",
  // No homepage search title/description of its own, so the homepage title is the store name.
  seoTitle: null,
  seoDescription: null,
};
const KEYS = Object.keys(STORE_B) as Array<keyof typeof STORE_B>;

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** A write from the logged-in OWNER's own session (credentials + CSRF), as the admin UI makes it. */
async function patchSettings(page: Page, body: Record<string, unknown>) {
  return page.evaluate(
    async ({ api, body }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
      const res = await fetch(`${api}/api/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      return res.status;
    },
    { api: API, body },
  );
}

test.describe("second store — one build, identity from configuration", () => {
  let original: Record<string, unknown> = {};

  test.beforeAll(async ({ request }) => {
    const { settings } = await (await request.get(`${API}/api/settings`)).json();
    original = Object.fromEntries(KEYS.map((k) => [k, settings[k] ?? null]));
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page);
    expect(await patchSettings(page, original)).toBe(200);
    await page.close();
  });

  test("the storefront renders Store B's name, address, hours, governing law and structured data", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "identity is global store state — exercised once");
    await login(page);
    expect(await patchSettings(page, STORE_B)).toBe(200);

    // Home: <title>, footer address (country derived from the ISO code), no other store's identity anywhere.
    await expect.poll(async () => (await page.goto("/"), page.title()), { timeout: 30_000 }).toContain(STORE_B.storeName);
    const footer = page.locator("footer");
    await expect(footer).toContainText("Chattogram, Bangladesh");
    await expect(footer).toContainText(`© ${new Date().getFullYear()} ${STORE_B.storeName}`);
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
    expect(ld).toContain(`"legalName":"${STORE_B.legalName}"`);
    expect(ld).toContain('"addressLocality":"Chattogram"');
    expect(await page.content()).not.toMatch(/asif\s*zone|asifzone\.com/i);

    // Contact page: full address and support hours from configuration.
    await page.goto("/contact");
    await expect(page.getByText("12 Example Road, Chattogram, Chattogram, 4000, Bangladesh")).toBeVisible();
    await expect(page.getByText(STORE_B.supportHours)).toBeVisible();

    // Terms: governing law from configuration.
    await page.goto("/terms");
    await expect(page.getByText("These terms are governed by the laws of Bangladesh.")).toBeVisible();
  });

  test("with no address or jurisdiction configured, nothing store-specific is invented", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "identity is global store state — exercised once");
    await login(page);
    expect(await patchSettings(page, { addressLine: null, addressCity: null, addressRegion: null, addressPostalCode: null, addressCountry: null, legalJurisdiction: null, supportHours: null })).toBe(200);
    await expect.poll(async () => (await page.goto("/terms"), await page.content()), { timeout: 30_000 }).toContain(
      `the country in which ${STORE_B.legalName} is registered`,
    );
    await page.goto("/contact");
    await expect(page.getByText("Address", { exact: true })).toHaveCount(0);
    await page.goto("/");
    await expect(page.locator("footer")).not.toContainText("Bangladesh");
  });
});
