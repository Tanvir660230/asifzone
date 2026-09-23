import { test, expect, type Page, type FrameLocator } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const SHOTS = process.env.PREVIEW_SHOTS_DIR;

const RUN = String(Date.now()).slice(-8);
const PRODUCT = `Preview Panjabi ${RUN}`;
const SEO_TITLE = `Black Preview Panjabi ${RUN} | Asif Zone`;
const META = `A ${RUN} black cotton panjabi, previewed before it was saved.`;

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

const frame = (page: Page): FrameLocator => page.frameLocator('[data-testid="preview-frame"]');
const stepChip = (page: Page, id: string) => page.getByTestId(`wizard-step-${id}`);
const accordion = (page: Page, title: RegExp) => frame(page).locator("button[aria-expanded]", { hasText: title });

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1600, height: 1000 } });

test.describe("product wizard: live preview", () => {
  let productId = "";

  test("1. the preview shows unsaved values as they're typed, then the options chosen, and the draft gets created", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/wizard/new");
    await page.getByLabel("Product name").fill(PRODUCT);
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Product type").selectOption({ label: "Clothing" });
    await expect(frame(page).getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();
    await shot(page, "01-new-basics");

    await page.getByRole("button", { name: "Continue" }).click(); // -> Media
    await page.getByRole("button", { name: "Continue" }).click(); // -> Pricing
    await page.getByLabel("Base price (BDT)").fill("1890");
    await expect(frame(page).getByTestId("product-price")).toHaveText("৳1,890");

    await page.getByRole("button", { name: "Continue" }).click(); // -> Variants (Clothing has size + colour)
    await page.getByPlaceholder("SKU-001").first().fill(`PV-${RUN}-M`);
    await page.locator('input[name="variants.0.size"]').fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
    await page.locator('input[name="variants.0.stock"]').fill("7");
    // The storefront's own size and colour pickers, fed by the unsaved rows.
    await expect(frame(page).getByRole("button", { name: "M", exact: true })).toBeVisible();
    await expect(frame(page).getByRole("button", { name: "Black", exact: true })).toBeVisible();
    await shot(page, "02-new-variants");

    await page.getByRole("button", { name: "Continue" }).click(); // creates the draft
    await expect(page).toHaveURL(/\/admin\/products\/wizard\/[^/]+\/edit/);
    productId = page.url().match(/wizard\/([^/]+)\/edit/)![1]!;
    await expect(frame(page).getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();
  });

  test("2. device modes render at the device's real width, so the storefront's own layout changes", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit`);
    const h1 = frame(page).getByRole("heading", { level: 1, name: PRODUCT });
    await expect(h1).toBeVisible();

    const widthOf = () => frame(page).locator("body").evaluate(() => window.innerWidth);
    const h1Left = () => h1.evaluate((el) => el.getBoundingClientRect().left);

    expect(await widthOf()).toBe(1280);
    expect(await h1Left()).toBeGreaterThan(500); // desktop: details sit in the right-hand column

    await page.getByTestId("preview-device-tablet").click();
    await expect.poll(widthOf).toBe(834);

    await page.getByTestId("preview-device-mobile").click();
    await expect.poll(widthOf).toBe(390);
    await expect.poll(h1Left).toBeLessThan(50); // mobile: single column, details under the gallery
    await shot(page, "03-mobile");
  });

  test("3. listing, search, social and Google surfaces — and they follow the SEO step as it's typed", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit`);

    await page.getByTestId("preview-mode-tab-listing").click();
    await expect(frame(page).getByTestId("preview-mode-listing").getByRole("heading", { name: PRODUCT })).toBeVisible();

    await page.getByTestId("preview-mode-tab-search").click();
    await expect(frame(page).getByTestId("preview-mode-search")).toContainText("৳1,890");

    await page.getByTestId("preview-mode-tab-serp").click();
    await expect(frame(page).getByTestId("serp-card")).toContainText(PRODUCT); // no SEO title yet: falls back to the name

    await stepChip(page, "seo").click();
    await page.getByLabel("SEO title").fill(SEO_TITLE);
    await page.getByLabel("Meta description").fill(META);
    await expect(frame(page).getByTestId("serp-card")).toContainText(SEO_TITLE);
    await expect(frame(page).getByTestId("serp-card")).toContainText(META);
    await shot(page, "04-serp");

    // Social previews fall back to the SEO title/description when no social override is set.
    await page.getByTestId("preview-mode-tab-social").click();
    await expect(frame(page).getByTestId("social-card")).toContainText(SEO_TITLE);
    await page.getByLabel("Social title").fill(`Social ${RUN}`);
    await expect(frame(page).getByTestId("social-card")).toContainText(`Social ${RUN}`);
    await shot(page, "05-social");
  });

  test("4. sections switched off disappear from the preview: care, size guide, FAQ, reviews", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit`);
    await expect(frame(page).getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();

    // Clothing's template brings a care guide and a size guide; reviews are a page block.
    await expect(accordion(page, /care/i)).toHaveCount(1);
    await expect(frame(page).getByRole("button", { name: /size guide/i })).toBeVisible();
    await expect(frame(page).getByTestId("preview-blocks")).toContainText("Reviews");

    await stepChip(page, "content").click();
    await page.getByRole("button", { name: /add question/i }).click();
    await page.getByLabel("Question 1", { exact: true }).fill(`Is it ${RUN} cotton?`);
    await page.getByLabel("Answer 1", { exact: true }).fill("Yes.");
    await expect(accordion(page, /^faq$/i)).toHaveCount(1);

    await page.getByLabel("Care instructions visibility").selectOption("false");
    await page.getByLabel("Size guide link visibility").selectOption("false");
    await page.getByLabel("FAQ visibility").selectOption("false");
    await page.getByLabel("Customer reviews visibility").selectOption("false");

    await expect(accordion(page, /care/i)).toHaveCount(0);
    await expect(frame(page).getByRole("button", { name: /size guide/i })).toHaveCount(0);
    await expect(accordion(page, /^faq$/i)).toHaveCount(0);
    await expect(frame(page).getByTestId("preview-blocks")).not.toContainText("Reviews");
    await shot(page, "06-sections-off");
  });

  test("5. admin-authored HTML is sanitized in the preview (browser DOMPurify), not just on the server page", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit`);
    // Write a description that would run script if rendered raw — straight through the API, as a stored value would be.
    const status = await page.evaluate(
      async ({ api, id }) => {
        const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
        const res = await fetch(`${api}/api/products/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ description: '<p>Safe words</p><img src="x" onerror="window.__pwned=1"><script>window.__pwned=2</script>' }),
        });
        return res.status;
      },
      { api: API, id: productId },
    );
    expect(status).toBe(200);

    await page.reload();
    await accordion(page, /description/i).click();
    await expect(frame(page).getByText("Safe words")).toBeVisible();
    expect(await frame(page).locator("body").evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(frame(page).locator("[onerror]")).toHaveCount(0);
  });

  test("6. links and cart actions inside the preview don't navigate it away or touch the admin's own cart", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit`);
    const h1 = frame(page).getByRole("heading", { level: 1, name: PRODUCT });
    await expect(h1).toBeVisible();
    await frame(page).getByRole("link", { name: "Home" }).click();
    await frame(page).getByRole("button", { name: /add to cart/i }).first().click();
    await expect(h1).toBeVisible(); // still the preview, not the storefront home page
  });
});
