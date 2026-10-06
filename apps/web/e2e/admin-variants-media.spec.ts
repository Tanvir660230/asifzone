import { test, expect, type Page } from "@playwright/test";
import { continueTo, createDraft, goToStep } from "./support/product-builder";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

const RUN = String(Date.now()).slice(-8);
const PRODUCT = `Gallery Panjabi ${RUN}`;

// 1x1 PNG the server's image pipeline accepts; each upload gets its own name (and so its own alt text).
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

test.describe("variants and media: SKU generator, per-colour galleries, captions, variant price, on-sale switch", () => {
  let editUrl = "";
  let slug = "";
  const generated: string[] = [];

  test("1. create a two-colour product using the SKU generator", async ({ page }) => {
    await login(page);
    // The prefix is store configuration (CatalogSetting.skuPrefix — "SKU" on a fresh store since Phase 12 D-8, "AZ" on
    // the original store): read it rather than assume one.
    const prefix = String((await (await page.request.get(`${API}/api/catalog/sku-settings`)).json()).settings.skuPrefix).toUpperCase();
    expect(prefix).toMatch(/^[A-Z0-9]+$/);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product name").fill(PRODUCT);
    await page.getByLabel("Category").selectOption({ index: 1 });
    await continueTo(page, "pricing");
    await page.getByLabel("Base price (BDT)").fill("1200");

    await continueTo(page, "variants");
    // Variant 1: Black / M — fill the options first, then let the pattern build the SKU from them.
    await page.getByPlaceholder(/e\.g\. S, M, L/).first().fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
    await page.locator('input[name="variants.0.stock"]').fill("10");
    await page.getByRole("button", { name: "Generate" }).first().click();
    await expect(page.getByPlaceholder("SKU-001").first()).toHaveValue(new RegExp(`^${prefix}-CLO-BLA-M-[0-9]{3}$`));
    generated.push(await page.getByPlaceholder("SKU-001").first().inputValue());

    // Variant 2: White / M.
    await page.getByRole("button", { name: "Add variant manually" }).click();
    await page.locator('input[name="variants.1.size"]').fill("M");
    await page.locator('input[name="variants.1.color"]').fill("White");
    await page.locator('input[name="variants.1.stock"]').fill("10");
    await page.getByRole("button", { name: "Generate" }).nth(1).click();
    await expect(page.locator('input[name="variants.1.sku"]')).toHaveValue(new RegExp(`^${prefix}-CLO-WHI-M-[0-9]{3}$`));
    generated.push(await page.locator('input[name="variants.1.sku"]').inputValue());
    expect(new Set(generated).size).toBe(2); // two rows in one form never get the same SKU

    editUrl = await createDraft(page);
  });

  test("2. upload three images, caption one, and see the stored size", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    await goToStep(page, "media");
    await page.locator('input[type="file"]').first().setInputFiles([
      { name: "black-1.png", mimeType: "image/png", buffer: PNG },
      { name: "black-2.png", mimeType: "image/png", buffer: PNG },
      { name: "white-1.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(page.getByLabel("Image caption")).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByText("1×1px").first()).toBeVisible();

    // Caption the black-1 image (the input sits under its thumbnail); saving happens on blur.
    const first = page.getByLabel("Image caption").first();
    await first.fill("Front view");
    await first.blur();
    await page.reload(); // the step is kept in the URL, so the reload lands back on Media
    await expect(page.getByLabel("Image caption").first()).toHaveValue("Front view");
  });

  test("3. give each colour its own gallery, price and compare-at price, then publish", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    await goToStep(page, "variants");

    // Black gets black-1 then black-2 (order matters: the first is its main image); White gets white-1.
    const gallery1 = page.getByRole("group", { name: "Variant 1 gallery" });
    await gallery1.getByRole("button", { name: /black-1\.png/ }).click();
    await gallery1.getByRole("button", { name: /black-2\.png/ }).click();
    // The picker (thumbnails + helper text) is the group's parent.
    await expect(gallery1.locator("..")).toContainText("2 images");
    const gallery2 = page.getByRole("group", { name: "Variant 2 gallery" });
    await gallery2.getByRole("button", { name: /white-1\.png/ }).click();
    await expect(gallery2.locator("..")).toContainText("1 image");

    // White sells for less than the product's base price, and shows what it was.
    await page.locator('input[name="variants.1.price"]').fill("1000");
    await page.locator('input[name="variants.1.compareAtPrice"]').fill("1400");

    const panel = page.getByTestId("product-status-panel");
    await panel.getByRole("button", { name: "Save draft" }).click();
    await expect(panel.getByRole("button", { name: "Publish" })).toBeEnabled();
    await panel.getByRole("button", { name: "Publish" }).click();
    await expect(panel.getByRole("button", { name: "Unpublish" })).toBeVisible({ timeout: 15_000 });

    const link = page.getByRole("link", { name: /view on site/i });
    slug = (await link.getAttribute("href"))!.replace("/product/", "");

    // The gallery is on the API too, in the order chosen, with the first as the primary image.
    const api = await page.request.get(`${API}/api/products/slug/${slug}`);
    const product = (await api.json()).product;
    const black = product.variants.find((v: { color: string }) => v.color === "Black");
    expect(black.images).toHaveLength(2);
    expect(black.imageId).toBe(black.images[0].imageId);
  });

  test("4. the storefront switches gallery, caption and price with the colour", async ({ page }) => {
    await page.goto(`/product/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT })).toBeVisible();

    // Nothing chosen: every image is available.
    await expect(page.getByRole("button", { name: /^View image \d of/ })).toHaveCount(3);

    await page.getByRole("button", { name: "Black", exact: true }).click();
    await expect(page.getByRole("button", { name: /^View image \d of/ })).toHaveCount(2);
    await expect(page.getByRole("img", { name: "black-1.png" }).first()).toBeVisible();
    await expect(page.getByTestId("image-caption")).toHaveText("Front view");
    await expect(page.getByTestId("product-price")).toContainText("1,200");
    await expect(page.getByTestId("product-compare-price")).toHaveCount(0);

    await page.getByRole("button", { name: "White", exact: true }).click();
    // One image left for White, so the thumbnail strip goes away and the main image is white-1.
    await expect(page.getByRole("button", { name: /^View image \d of/ })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "white-1.png" }).first()).toBeVisible();
    await expect(page.getByTestId("image-caption")).toHaveCount(0);
    await expect(page.getByTestId("product-price")).toContainText("1,000");
    await expect(page.getByTestId("product-compare-price")).toContainText("1,400");
  });

  test("5. switching a variant off removes it from the storefront API but keeps it in the admin (checkout refusal is covered by the API integration test)", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    await goToStep(page, "variants");
    const whiteRow = page.locator('input[name="variants.1.color"]');
    await expect(whiteRow).toHaveValue("White");
    await page.locator('input[name="variants.1.isActive"]').uncheck();
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();

    const pub = (await (await page.request.get(`${API}/api/products/slug/${slug}`)).json()).product;
    expect(pub.variants.map((v: { color: string }) => v.color)).toEqual(["Black"]);

    // Still there in the editor after a reload, unchecked.
    await page.reload();
    await goToStep(page, "variants");
    await expect(page.locator('input[name="variants.1.color"]')).toHaveValue("White");
    await expect(page.locator('input[name="variants.1.isActive"]')).not.toBeChecked();
  });
});
