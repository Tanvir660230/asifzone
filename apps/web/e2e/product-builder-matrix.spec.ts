import { test, expect, type Page } from "@playwright/test";

/**
 * The Product Builder brief's test matrix, end to end through the step-by-step builder. Scenarios already covered by
 * the other builder specs are noted where they live (admin-product-wizard, -preview, -resilience).
 */

const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const STAFF = { email: process.env.E2E_STAFF_EMAIL ?? "claude-e2e-staff@example.com", password: process.env.E2E_STAFF_PASSWORD ?? "ClaudeE2eStaff123!" };
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

const RUN = String(Date.now()).slice(-8);
const SIMPLE_TEMPLATE = `Matrix simple template ${RUN}`;
const SIMPLE_TYPE = `Matrix Simple ${RUN}`;
const PERFUME = `Matrix Perfume ${RUN}`;
const CAP = `Matrix Cap ${RUN}`;
const ATTAR = `Matrix Attar ${RUN}`;
const PANJABI = `Matrix Panjabi ${RUN}`;
const STAFF_PRODUCT = `Matrix Staff Product ${RUN}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function login(page: Page, who = OWNER) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

const cookieHeader = async (page: Page) => (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
async function apiProduct(page: Page, id: string) {
  return (await (await page.request.get(`${API}/api/products/${id}`, { headers: { Cookie: await cookieHeader(page) } })).json()).product;
}
/** A write from the logged-in admin's own session (credentials + CSRF), as the admin UI would make it. */
async function adminFetch(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ api, method, path, body }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
      const res = await fetch(`${api}${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return res.status;
    },
    { api: API, method, path, body },
  );
}

const chip = (page: Page, id: string) => page.getByTestId(`wizard-step-${id}`);
const idFromUrl = (page: Page) => page.url().match(/wizard\/([^/?]+)\/edit/)![1]!;

async function startNew(page: Page, name: string, type: string) {
  await page.goto("/admin/products/wizard/new");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Product type").selectOption({ label: type });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1600, height: 1000 } });

test.describe("Product Builder — the brief's test matrix", () => {
  let perfumeId = "";
  let perfumeSlug = "";

  test("setup: a type with no options, and Care & Material switched off", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/templates");
    await page.getByRole("button", { name: /add template/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(SIMPLE_TEMPLATE);
    await page.getByLabel("Material visibility").selectOption("false");
    await page.getByLabel("Care instructions visibility").selectOption("false");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(SIMPLE_TEMPLATE).first()).toBeVisible();
    await page.goto("/admin/catalog/types");
    await page.getByRole("button", { name: /add product type/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(SIMPLE_TYPE);
    await page.getByLabel("Template").selectOption({ label: SIMPLE_TEMPLATE });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(SIMPLE_TYPE).first()).toBeVisible();
  });

  test("1, 7–12, 18 — a simple product (no colour, size, variants, care, material, size guide, FAQ or related) is created and published", async ({ page }) => {
    await login(page);
    await startNew(page, PERFUME, SIMPLE_TYPE);
    await page.getByRole("button", { name: "Continue" }).click(); // Media
    await page.locator('input[type="file"]').setInputFiles({ name: "perfume.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Continue" }).click(); // Pricing — where a simple product's SKU and stock live
    await page.getByLabel("Base price (BDT)").fill("2500");
    await page.getByLabel("SKU", { exact: true }).fill(`AZ-PERF-${RUN}`);
    await page.getByLabel("Stock", { exact: true }).fill("25");
    await page.getByRole("button", { name: "Continue" }).click(); // creates the draft, then uploads the staged photo

    await expect(page).toHaveURL(/\/wizard\/[^/]+\/edit\?step=media/);
    perfumeId = idFromUrl(page);
    await expect.poll(async () => (await apiProduct(page, perfumeId)).images.length).toBe(1);
    for (const id of ["variants", "care", "sizeGuide"]) await expect(chip(page, id)).toHaveCount(0);

    // Final Review lists only what applies — no size guide, material or care rows — and nothing required is missing.
    await chip(page, "review").click();
    await expect(page.getByTestId("review-summary")).toHaveText(/Everything required is complete/);
    for (const key of ["sizeGuide", "material", "care"]) await expect(page.getByTestId(`review-check-${key}`)).toHaveCount(0);

    await chip(page, "publish").click();
    await expect(page.getByTestId("publish-ready")).toContainText(PERFUME);
    await page.getByRole("button", { name: "Publish product" }).click();
    await expect(page.getByTestId("publish-live")).toContainText("Product published");

    const product = await apiProduct(page, perfumeId);
    expect(product.status).toBe("PUBLISHED");
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({ sku: `AZ-PERF-${RUN}`, stock: 25 });
    perfumeSlug = product.slug;

    // The storefront: price, stock, and no option pickers at all.
    await page.goto(`/product/${perfumeSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: PERFUME })).toBeVisible();
    await expect(page.getByTestId("product-price")).toHaveText("৳2,500");
    await expect(page.getByText(/^Size( — .*)?$/)).toHaveCount(0);
    await expect(page.getByText(/^Color( — .*)?$/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /size guide/i })).toHaveCount(0);
  });

  test("2, 6, 18 — colour only: no size anywhere; publishing is refused until there's an image, with a Fix that goes there", async ({ page }) => {
    await login(page);
    await startNew(page, CAP, "Accessory");
    await page.getByRole("button", { name: "Continue" }).click(); // Media (skipped)
    await page.getByRole("button", { name: "Continue" }).click(); // Pricing
    await page.getByLabel("Base price (BDT)").fill("450");
    await page.getByRole("button", { name: "Continue" }).click(); // Options & Variants — colour only
    await expect(page.locator('input[name="variants.0.size"]')).toHaveCount(0);
    await page.getByPlaceholder("SKU-001").first().fill(`AZ-CAP-${RUN}`);
    await page.locator('input[name="variants.0.color"]').fill("Brown");
    await page.locator('input[name="variants.0.stock"]').fill("4");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/wizard\/[^/]+\/edit/);
    const id = idFromUrl(page);

    await chip(page, "publish").click();
    await expect(page.getByTestId("publish-blocked")).toContainText("Upload at least one image");
    await page.getByTestId("publish-blocked").getByRole("button", { name: "Fix" }).click();
    await expect(chip(page, "media")).toHaveAttribute("aria-current", "step");

    await page.locator('input[type="file"]').setInputFiles({ name: "cap.png", mimeType: "image/png", buffer: PNG });
    await expect.poll(async () => (await apiProduct(page, id)).images.length).toBe(1);
    await chip(page, "publish").click();
    await page.getByRole("button", { name: "Publish product" }).click();
    await expect(page.getByTestId("publish-live")).toBeVisible();

    await page.goto(`/product/${(await apiProduct(page, id)).slug}`);
    await expect(page.getByRole("button", { name: "Brown", exact: true })).toBeVisible();
    await expect(page.getByText(/^Size( — .*)?$/)).toHaveCount(0);
  });

  test("3, 5 — size only (Volume): no colour anywhere, the Volume picker is the product's only option", async ({ page }) => {
    await login(page);
    await startNew(page, ATTAR, "Fragrance");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Base price (BDT)").fill("900");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator('input[name="variants.0.color"]')).toHaveCount(0);
    await page.getByPlaceholder("SKU-001").first().fill(`AZ-ATR-${RUN}`);
    await page.locator('input[name="variants.0.size"]').fill("50ml");
    await page.locator('input[name="variants.0.stock"]').fill("9");
    // The storefront's own picker, in the live preview beside the form.
    const frame = page.frameLocator('[data-testid="preview-frame"]');
    await expect(frame.getByText(/^Volume/)).toBeVisible();
    await expect(frame.getByRole("button", { name: "50ml", exact: true })).toBeVisible();
    await expect(frame.getByText(/^Color( — .*)?$/)).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/wizard\/[^/]+\/edit/);
    const product = await apiProduct(page, idFromUrl(page));
    expect(product.variants[0]).toMatchObject({ size: "50ml", color: "" });
  });

  test("13 — changing the product type says exactly what happens, and switching back restores what was entered", async ({ page }) => {
    await login(page);
    await startNew(page, PANJABI, "Clothing");
    await page.getByLabel("Fabric").fill("Linen");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Base price (BDT)").fill("1890");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("SKU-001").first().fill(`AZ-PNJ-${RUN}`);
    await page.locator('input[name="variants.0.size"]').fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/wizard\/[^/]+\/edit/);
    const id = idFromUrl(page);

    await chip(page, "basics").click();
    await page.getByLabel("Product type").selectOption({ label: "Fragrance" });
    const impact = page.getByTestId("type-change-impact");
    await expect(impact).toContainText("Kept but hidden: Fabric");
    await expect(impact).toContainText("Color is no longer an option for Fragrance");
    await expect(chip(page, "sizeGuide")).toHaveCount(0); // Fragrance has no size guide
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText("Saved", { timeout: 10_000 });
    expect((await apiProduct(page, id)).attributes.fabric).toBe("Linen"); // kept (just not asked for) while it's a Fragrance…

    await page.getByLabel("Product type").selectOption({ label: "Clothing" });
    await expect(impact).toHaveCount(0);
    await expect(page.getByLabel("Fabric")).toHaveValue("Linen");
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText("Saved", { timeout: 10_000 });
    await page.reload();
    await expect(page.getByLabel("Fabric")).toHaveValue("Linen"); // …and back, not lost
  });

  test("16 — a refresh keeps the draft and the step: before creation (local draft) and after (saved product)", async ({ page }) => {
    await login(page);
    await startNew(page, `Matrix Refresh ${RUN}`, SIMPLE_TYPE);
    await page.getByRole("button", { name: "Continue" }).click(); // Media
    await expect(chip(page, "media")).toHaveAttribute("aria-current", "step");
    await page.waitForTimeout(1200); // let the debounced local draft land
    await page.reload();
    await expect(page.getByTestId("resume-draft")).toContainText(`Matrix Refresh ${RUN}`);
    await page.getByTestId("resume-draft").getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Product name")).toHaveCount(0); // not on Basics…
    await expect(chip(page, "media")).toHaveAttribute("aria-current", "step"); // …back on Media
    await chip(page, "basics").click();
    await expect(page.getByLabel("Product name")).toHaveValue(`Matrix Refresh ${RUN}`);

    await page.goto(`/admin/products/wizard/${perfumeId}/edit`);
    await chip(page, "seo").click();
    await page.reload();
    await expect(chip(page, "seo")).toHaveAttribute("aria-current", "step");
  });

  test("17 — a published product's URL changes only when confirmed, and the old URL redirects to the new one", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${perfumeId}/edit?step=seo`);
    const newSlug = `${perfumeSlug}-renamed`;
    await page.getByLabel("URL slug").fill(newSlug);
    await expect(page.getByTestId("slug-change-notice")).toContainText(`/product/${perfumeSlug}`);
    await page.waitForTimeout(2000); // autosave has run by now…
    expect((await apiProduct(page, perfumeId)).slug).toBe(perfumeSlug); // …and did not touch the live URL

    await page.getByTestId("slug-change-notice").getByRole("button", { name: "Change URL" }).click();
    await expect.poll(async () => (await apiProduct(page, perfumeId)).slug).toBe(newSlug);
    await expect(page.getByTestId("slug-change-notice")).toHaveCount(0);

    const redirects = (await (await page.request.get(`${API}/api/redirects/active`)).json()) as { redirects?: { fromPath: string; toPath: string }[] } | { fromPath: string; toPath: string }[];
    const list = Array.isArray(redirects) ? redirects : (redirects.redirects ?? []);
    expect(list).toContainEqual(expect.objectContaining({ fromPath: `/product/${perfumeSlug}`, toPath: `/product/${newSlug}` }));

    await page.goto(`/product/${newSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: PERFUME })).toBeVisible(); // new URL works
    // Old URL: the storefront middleware re-reads the redirect list on a short cache — give it that long.
    await expect
      .poll(
        async () => {
          await page.goto(`/product/${perfumeSlug}`);
          return new URL(page.url()).pathname;
        },
        { timeout: 60_000, intervals: [2_000, 5_000] },
      )
      .toBe(`/product/${newSlug}`);
    perfumeSlug = newSlug;
  });

  test("19 — unpublishing takes it off the store", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${perfumeId}/edit?step=publish`);
    await expect(page.getByTestId("publish-live")).toBeVisible();
    await page.getByTestId("publish-live").getByRole("button", { name: "Unpublish" }).click();
    await expect.poll(async () => (await apiProduct(page, perfumeId)).status).toBe("UNPUBLISHED");
    expect((await page.request.get(`${API}/api/products/slug/${perfumeSlug}`)).status()).toBe(404);
  });

  test("22, 23 — STAFF can build and publish products; AI, CSV import and permanent delete stay OWNER-only on the server", async ({ page, browser }) => {
    // OWNER: the AI endpoint isn't refused on role (it may still say "not configured" in this environment).
    await login(page, OWNER);
    const ownerAi = await adminFetch(page, "POST", "/api/ai/generate", { type: "seo_title", productName: "x" });
    expect(ownerAi).not.toBe(403);

    const staffContext = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const staff = await staffContext.newPage();
    await login(staff, STAFF);
    await startNew(staff, STAFF_PRODUCT, SIMPLE_TYPE);
    await expect(staff.getByRole("button", { name: /generate with ai/i })).toHaveCount(0); // not offered to staff
    await staff.getByRole("button", { name: "Continue" }).click();
    await staff.locator('input[type="file"]').setInputFiles({ name: "staff.png", mimeType: "image/png", buffer: PNG });
    await staff.getByRole("button", { name: "Continue" }).click();
    await staff.getByLabel("Base price (BDT)").fill("300");
    await staff.getByLabel("Stock", { exact: true }).fill("3");
    await staff.getByRole("button", { name: "Continue" }).click();
    await expect(staff).toHaveURL(/\/wizard\/[^/]+\/edit/);
    const id = idFromUrl(staff);
    await expect.poll(async () => (await apiProduct(staff, id)).images.length).toBe(1);
    await chip(staff, "publish").click();
    await staff.getByRole("button", { name: "Publish product" }).click();
    await expect(staff.getByTestId("publish-live")).toBeVisible();

    // Enforced by the API itself, not just hidden in the UI.
    expect(await adminFetch(staff, "POST", "/api/ai/generate", { type: "seo_title", productName: "x" })).toBe(403);
    expect(await adminFetch(staff, "POST", "/api/products/import/validate", { csv: "name\nx" })).toBe(403);
    expect(await adminFetch(staff, "DELETE", `/api/products/${id}/permanent`)).toBe(403);
    await staffContext.close();
  });
});
