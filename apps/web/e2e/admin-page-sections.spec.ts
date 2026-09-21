import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

const RUN = String(Date.now()).slice(-8);
const TEMPLATE = `Sections template ${RUN}`;
const TYPE = `Sections type ${RUN}`;
const PRODUCT_A = `Sections Clothing ${RUN}`; // an ordinary Clothing product: the store-level settings must reach it
const PRODUCT_B = `Sections Kurta ${RUN}`; // a product of the new type: template + product overrides, FAQ, video, picks
const STORE_WARRANTY = `Store warranty ${RUN}: 12 months against stitching defects.`;
const TEMPLATE_SHIPPING_TITLE = `Delivery ${RUN}`;
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// 1x1 PNG the server's image pipeline accepts.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** The accordion rows on a product page, in the order a customer sees them. */
const accordionTitles = (page: Page) => page.locator("button[aria-expanded]").allTextContents().then((t) => t.map((s) => s.trim()));

async function createDraft(page: Page, name: string, sku: string, opts: { type?: string } = {}) {
  await page.goto("/admin/products/new");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ index: 1 });
  if (opts.type) await page.getByLabel("Product type").selectOption({ label: opts.type });
  await page.getByLabel("Short description").fill(`${name} — a test product.`);
  await page.getByRole("button", { name: "Pricing & Inventory" }).click();
  await page.getByLabel("Base price (BDT)").fill("1500");
  await page.getByRole("button", { name: "Variants", exact: true }).click();
  await page.getByPlaceholder("SKU-001").first().fill(sku);
  await page.locator('input[name="variants.0.stock"]').fill("9");
  // Clothing's template requires a size and a colour on every variant; the new type's template asks for neither.
  if (!opts.type) {
    await page.getByPlaceholder(/e\.g\. S, M, L/).first().fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
  }
}

async function publish(page: Page, editUrl: string) {
  await page.goto(editUrl);
  const panel = page.getByTestId("product-status-panel");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PNG });
  await expect(panel.getByRole("button", { name: "Publish" })).toBeEnabled({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Publish" }).click();
  await expect(panel.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test.describe("page sections: store → template → product, FAQ, video, hand-picked lists, draft preview", () => {
  let editA = "";
  let editB = "";
  let idB = "";

  test("1. store level: turn the warranty section on for every product and write its wording once", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/sections");
    const editor = page.getByTestId("section-settings");
    await expect(editor).toBeVisible();

    await page.getByLabel("Warranty visibility").selectOption("true");
    await page.getByLabel("Warranty text").fill(STORE_WARRANTY);
    await page.getByRole("button", { name: "Save page sections" }).click();
    await expect(page.getByText("Page sections saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Warranty visibility")).toHaveValue("true");
    await expect(page.getByLabel("Warranty text")).toHaveValue(STORE_WARRANTY);
    // Everything not touched still says "default" rather than storing a copy of the default.
    await expect(page.getByLabel("Description visibility")).toHaveValue("");
  });

  test("2. template level: a new template retitles Shipping and switches Highlights on", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/templates");
    await page.getByRole("button", { name: /add template/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(TEMPLATE);

    // The template editor shows what each section inherits — here the warranty the store turned on in step 1.
    await expect(page.getByLabel("Warranty visibility")).toContainText("Inherit (shown)");
    await page.getByLabel("Shipping & returns title").fill(TEMPLATE_SHIPPING_TITLE);
    await page.getByLabel("Highlights visibility").selectOption("true");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(TEMPLATE).first()).toBeVisible();

    // Persisted: reopening shows the same choices.
    await page.getByRole("button", { name: `Edit ${TEMPLATE}` }).click();
    await expect(page.getByLabel("Shipping & returns title")).toHaveValue(TEMPLATE_SHIPPING_TITLE);
    await expect(page.getByLabel("Highlights visibility")).toHaveValue("true");
  });

  test("3. a product type uses the template", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/types");
    await page.getByRole("button", { name: /add product type/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(TYPE);
    await page.getByLabel("Template").selectOption({ label: TEMPLATE });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(TYPE).first()).toBeVisible();
  });

  test("4. an ordinary Clothing product is created and published", async ({ page }) => {
    await login(page);
    await createDraft(page, PRODUCT_A, `SEC-A-${RUN}`);
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/, { timeout: 30_000 });
    editA = new URL(page.url()).pathname;
    await publish(page, editA);
  });

  test("5. the Clothing product's live page: default sections, plus the store's warranty — no FAQ, video or highlights", async ({ page }) => {
    await page.goto(`/product/${slugOf(PRODUCT_A)}`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_A })).toBeVisible();
    const titles = await accordionTitles(page);
    expect(titles).toContain("Description");
    expect(titles).toContain("Shipping & Returns"); // the default title: the template's retitle is not this product's
    expect(titles).toContain("Warranty"); // switched on store-wide
    for (const absent of ["FAQ", "Highlights", "Product video", "Returns"]) expect(titles).not.toContain(absent);
    expect(titles.indexOf("Description")).toBeLessThan(titles.indexOf("Shipping & Returns"));

    await page.getByRole("button", { name: "Warranty", exact: true }).click();
    await expect(page.getByText(STORE_WARRANTY)).toBeVisible();
    await page.getByRole("button", { name: "Shipping & Returns", exact: true }).click();
    await expect(page.getByText(/Dispatched within 1–2 business days/)).toBeVisible();
  });

  test("6. a draft of the new type carries FAQ, video, highlights and a hand-picked list from the product form", async ({ page }) => {
    await login(page);
    await createDraft(page, PRODUCT_B, `SEC-B-${RUN}`, { type: TYPE });

    await page.getByRole("button", { name: "Page content" }).click();
    // Product-level editor: shows the template's choices as inherited.
    await expect(page.getByLabel("Highlights visibility")).toContainText("Inherit (shown)");
    await page.getByLabel("Highlights text").fill("Lightweight cotton\nHand finished collar");
    await page.getByLabel("Product video visibility").selectOption("true");
    await page.getByLabel("Product video link").fill(VIDEO);

    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByLabel("Question 1", { exact: true }).fill("Does it shrink?");
    await page.getByLabel("Answer 1", { exact: true }).fill("Pre-washed, so no.");
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByLabel("Question 2", { exact: true }).fill("Can I exchange the size?");
    await page.getByLabel("Answer 2", { exact: true }).fill("Yes, within 7 days.");

    // Hand-pick the ordinary product for the "Related products" list.
    const related = page.getByTestId("related-editor");
    await related.getByPlaceholder("Search products by name…").first().fill(PRODUCT_A);
    await related.getByRole("button", { name: new RegExp(PRODUCT_A) }).click();
    await expect(related.getByText(PRODUCT_A)).toBeVisible();

    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/, { timeout: 30_000 });
    editB = new URL(page.url()).pathname;
    idB = editB.split("/")[3]!;
  });

  test("7. it all survives a reload of the editor", async ({ page }) => {
    await login(page);
    await page.goto(editB);
    await page.getByRole("button", { name: "Page content" }).click();
    await expect(page.getByLabel("Highlights text")).toHaveValue("Lightweight cotton\nHand finished collar");
    await expect(page.getByLabel("Product video link")).toHaveValue(VIDEO);
    await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue("Does it shrink?");
    await expect(page.getByLabel("Answer 2", { exact: true })).toHaveValue("Yes, within 7 days.");
    await expect(page.getByTestId("related-editor").getByText(PRODUCT_A)).toBeVisible();
  });

  test("8. the draft is previewable through the real storefront page, and is not live", async ({ page, request }) => {
    await login(page);
    await page.goto(`/preview/${idB}`);
    await expect(page.getByTestId("preview-banner")).toContainText("draft");
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_B })).toBeVisible();

    const titles = await accordionTitles(page);
    expect(titles).toContain(TEMPLATE_SHIPPING_TITLE); // the template's retitle
    expect(titles).not.toContain("Shipping & Returns");
    for (const present of ["Highlights", "Warranty", "FAQ", "Product video"]) expect(titles).toContain(present);

    await page.getByRole("button", { name: "Highlights", exact: true }).click();
    await expect(page.getByText("Hand finished collar")).toBeVisible();
    await page.getByRole("button", { name: "FAQ", exact: true }).click();
    await expect(page.getByText("Does it shrink?")).toBeVisible();
    await expect(page.getByText("Yes, within 7 days.")).toBeVisible();
    await page.getByRole("button", { name: "Product video", exact: true }).click();
    await expect(page.locator('iframe[src*="youtube"]')).toHaveCount(1);
    // Inherited store wording reaches a product that never wrote any.
    await page.getByRole("button", { name: "Warranty", exact: true }).click();
    await expect(page.getByText(STORE_WARRANTY)).toBeVisible();

    // The hand-picked list replaces the automatic one, under the section's own title.
    await expect(page.getByRole("heading", { name: "Best Match" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: new RegExp(PRODUCT_A) }).first()).toBeVisible();

    // A draft is not on the public storefront.
    const res = await request.get(`${process.env.E2E_API_URL ?? "http://localhost:4000"}/api/products/slug/${slugOf(PRODUCT_B)}`);
    expect(res.status()).toBe(404);
  });

  test("9. product level: hide the inherited shipping row and put the FAQ first", async ({ page }) => {
    await login(page);
    await page.goto(editB);
    await page.getByRole("button", { name: "Page content" }).click();
    await page.getByLabel("Shipping & returns visibility").selectOption("false");
    const up = page.getByRole("button", { name: "Move FAQ up" });
    for (let i = 0; i < 14 && (await up.isEnabled()); i++) await up.click();
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();

    await page.goto(`/preview/${idB}`);
    const titles = await accordionTitles(page);
    expect(titles).not.toContain(TEMPLATE_SHIPPING_TITLE);
    expect(titles.indexOf("FAQ")).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf("FAQ")).toBeLessThan(titles.indexOf("Description"));
  });

  test("10. published, the FAQ is on the public page and in structured data", async ({ page }) => {
    await login(page);
    await publish(page, editB);

    await page.goto(`/product/${slugOf(PRODUCT_B)}`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_B })).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const faq = ld.map((t) => JSON.parse(t)).find((j) => j["@type"] === "FAQPage");
    expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(["Does it shrink?", "Can I exchange the size?"]);
    // No preview banner and no admin controls on the live page.
    await expect(page.getByTestId("preview-banner")).toHaveCount(0);
  });

  test("11. restore the store's section defaults", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/sections");
    await page.getByLabel("Warranty visibility").selectOption("");
    await page.getByLabel("Warranty text").fill("");
    await page.getByRole("button", { name: "Save page sections" }).click();
    await expect(page.getByText("Page sections saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Warranty visibility")).toHaveValue("");
    await expect(page.getByLabel("Warranty text")).toHaveValue("");
  });
});
