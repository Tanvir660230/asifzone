import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

const RUN = String(Date.now()).slice(-8);
const CARE_NAME = `Cotton care ${RUN}`;
const COTTON = `Cotton ${RUN}`;
const POLY = `Polyester ${RUN}`;
const PRODUCT = `Workflow Panjabi ${RUN}`;
const SEO_TITLE = `Black Panjabi ${RUN} | Asif Zone`;
const META = `A ${RUN} black cotton panjabi for every occasion.`;
const CANONICAL = `https://example.com/canonical/${RUN}`;

// 1x1 transparent PNG — a real image the server's sharp pipeline accepts.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test.describe("product workflow: draft → ready → published → unpublished", () => {
  let productSlug = "";
  let editUrl = "";

  test("1. set up a care guide and two materials", async ({ page }) => {
    await login(page);

    await page.goto("/admin/catalog/care-guides");
    await page.getByRole("button", { name: /add care guide/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(CARE_NAME);
    await page.getByLabel("Care steps (one per line)").fill("Machine wash cold\nDo not bleach\nIron on low heat");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: CARE_NAME })).toBeVisible();

    await page.goto("/admin/catalog/materials");
    for (const name of [COTTON, POLY]) {
      await page.getByRole("button", { name: /add material/i }).click();
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
  });

  test("2. a new product starts as a draft, and the panel says exactly what's missing", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    const panel = page.getByTestId("product-status-panel");
    await expect(panel.getByText("New product")).toBeVisible();
    // Nothing is filled in yet: the meter is low and the required list names what to do.
    await expect(panel).toContainText("required missing");

    await page.getByLabel("Product name").fill(PRODUCT);
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Short description").fill("A black cotton panjabi.");
    await page.getByRole("button", { name: "Pricing & Inventory" }).click();
    await page.getByLabel("Base price (BDT)").fill("1850");

    await page.getByRole("button", { name: "Variants", exact: true }).click();
    await page.getByPlaceholder("SKU-001").first().fill(`WF-${RUN}-M`);
    await page.getByPlaceholder(/e\.g\. S, M, L/).first().fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
    await page.locator('input[name="variants.0.stock"]').fill("12");

    // Care & Material: a shared care guide and a 80/20 composition.
    await page.getByRole("button", { name: "Care & Material" }).click();
    await page.getByLabel("Care guide").selectOption({ label: CARE_NAME });
    await expect(page.getByTestId("care-preview")).toContainText("Do not bleach");
    await page.getByRole("button", { name: /add material/i }).click();
    await page.getByLabel("Material 1", { exact: true }).selectOption({ label: COTTON });
    await page.getByLabel("Material 1 percentage").fill("80");
    await page.getByRole("button", { name: /add material/i }).click();
    await page.getByLabel("Material 2", { exact: true }).selectOption({ label: POLY });
    await page.getByLabel("Material 2 percentage").fill("20");
    await expect(page.getByTestId("material-total")).toContainText("Total 100%");

    // Over 100% is called out immediately, before any save.
    await page.getByLabel("Material 2 percentage").fill("35");
    await expect(page.getByTestId("material-total")).toContainText("over 100%");
    await page.getByLabel("Material 2 percentage").fill("20");

    // SEO: nothing is auto-filled into the fields, but the preview shows the defaults and the manual values.
    await page.getByRole("button", { name: "SEO", exact: true }).click();
    await page.getByLabel("SEO title").fill(SEO_TITLE);
    await page.getByLabel("Meta description").fill(META);
    await page.getByLabel("Focus keyword").fill(`black panjabi ${RUN}`);
    await page.getByLabel("Canonical URL").fill(CANONICAL);
    await expect(page.getByTestId("serp-preview")).toContainText(SEO_TITLE);
    await expect(page.getByTestId("serp-preview")).toContainText(META);
    await expect(page.getByTestId("keyword-checks")).toContainText("Keyword appears in the SEO title");

    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/, { timeout: 30_000 });
    editUrl = new URL(page.url()).pathname;
    await expect(page.getByTestId("product-status-panel")).toContainText("Draft");
  });

  test("3. publishing is blocked until there's an image; then ready → published", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    const panel = page.getByTestId("product-status-panel");
    await expect(panel).toContainText("Draft");

    // The gate: no image yet, so both workflow buttons are disabled and the reason is on the page.
    await expect(panel.getByRole("button", { name: "Publish" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Mark ready" })).toBeDisabled();
    await expect(panel).toContainText("Upload at least one image");

    // Upload a real image through the real uploader.
    await page.locator('input[type="file"]').first().setInputFiles({ name: "cap.png", mimeType: "image/png", buffer: PNG });
    await expect(panel.getByRole("button", { name: "Publish" })).toBeEnabled({ timeout: 30_000 });
    await expect(panel.getByTestId("completeness-score")).not.toHaveText("0%");

    await panel.getByRole("button", { name: "Mark ready" }).click();
    await expect(panel).toContainText("Ready", { timeout: 15_000 });
    await panel.getByRole("button", { name: "Publish" }).click();
    await expect(panel.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 15_000 });

    const link = page.getByRole("link", { name: /view on site/i });
    productSlug = (await link.getAttribute("href"))!.replace("/product/", "");
    expect(productSlug).toContain("workflow-panjabi");
  });

  test("4. history shows who did what, with the changes", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    await page.getByRole("button", { name: "History" }).click();
    const history = page.getByTestId("product-history");
    await expect(history).toContainText("Product created");
    await expect(history).toContainText("Published");
    await expect(history).toContainText("status:");
    await expect(history).toContainText("Claude E2E (temporary)");
  });

  test("5. the storefront shows the SEO, care and material data", async ({ page }) => {
    await page.goto(`/product/${productSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();

    // The site's title template appends the store name ("%s | Store"), so match the SEO title as the prefix.
    await expect.poll(() => page.title()).toContain(SEO_TITLE);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", CANONICAL);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", META);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", SEO_TITLE);

    await page.getByRole("button", { name: /^material$/i }).click();
    await expect(page.getByText(`80% ${COTTON}`)).toBeVisible();
    await expect(page.getByText(`20% ${POLY}`)).toBeVisible();
    await page.getByRole("button", { name: /care instructions/i }).click();
    await expect(page.getByText("Iron on low heat")).toBeVisible();
  });

  test("6. filter by status and bulk-unpublish from the list", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products");
    // Table on desktop, card list on mobile — the row checkbox carries the same label in both, so it is layout-agnostic.
    const rowCheckbox = page.getByRole("checkbox", { name: `Select ${PRODUCT}` });

    await page.getByLabel("Filter by status").selectOption("PUBLISHED");
    await page.getByPlaceholder("Search products…").fill(PRODUCT);
    await expect(rowCheckbox).toBeVisible(); // it's in the Published list…

    await rowCheckbox.check();
    await page.getByRole("button", { name: "Unpublish", exact: true }).click();
    await expect(page.getByText(/set to unpublished/i)).toBeVisible();

    // No longer live: the API stops serving it at once. (The storefront's own fetch cache keeps the rendered page for
    // up to 60 seconds — that window predates the status workflow — so the page itself isn't asserted here.)
    const apiRes = await page.request.get(`${process.env.E2E_API_URL ?? "http://localhost:4000"}/api/products/slug/${productSlug}`);
    expect(apiRes.status()).toBe(404);

    // …and now it has moved: gone from Published, present under Unpublished.
    await expect(rowCheckbox).toHaveCount(0);
    await page.getByLabel("Filter by status").selectOption("UNPUBLISHED");
    await expect(rowCheckbox).toBeVisible();
  });

  test("7. an unpublished product can be published again from its editor", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    const panel = page.getByTestId("product-status-panel");
    await expect(panel).toContainText("Unpublished");
    await panel.getByRole("button", { name: "Publish" }).click();
    await expect(panel.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 15_000 });
    const apiRes = await page.request.get(`${process.env.E2E_API_URL ?? "http://localhost:4000"}/api/products/slug/${productSlug}`);
    expect(apiRes.status()).toBe(200);
  });
});
