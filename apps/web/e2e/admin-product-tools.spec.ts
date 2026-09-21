import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

const RUN = String(Date.now()).slice(-8);
const SOURCE = `E2E Tools Source ${RUN}`;
const IMPORTED = `E2E Tools Imported ${RUN}`;
const SKU_A = `TOOLS-${RUN}-A`;
const SKU_B = `TOOLS-${RUN}-B`;

// 1x1 PNG the server's image pipeline accepts.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

const csvFile = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf-8") });

async function findInList(page: Page, name: string) {
  await page.goto("/admin/products");
  await page.getByPlaceholder("Search products…").fill(name);
  // The list filters after a debounce; wait until exactly this product's row is left.
  await expect(page.getByRole("button", { name: `Duplicate ${name}`, exact: true })).toHaveCount(1);
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test.describe("duplicate a product, and import / export it as CSV", () => {
  let editUrl = "";
  let slug = "";
  let category = "";

  test("1. set up a source product: two variants, an image, a FAQ", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product name").fill(SOURCE);
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Short description").fill("The original product for the tools spec.");
    await page.getByRole("button", { name: "Pricing & Inventory" }).click();
    await page.getByLabel("Base price (BDT)").fill("1800");

    await page.getByRole("button", { name: "Variants", exact: true }).click();
    await page.getByPlaceholder("SKU-001").first().fill(SKU_A);
    await page.getByPlaceholder(/e\.g\. S, M, L/).first().fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
    await page.locator('input[name="variants.0.stock"]').fill("8");
    await page.getByRole("button", { name: "Add variant manually" }).click();
    await page.locator('input[name="variants.1.sku"]').fill(SKU_B);
    await page.locator('input[name="variants.1.size"]').fill("L");
    await page.locator('input[name="variants.1.color"]').fill("Black");
    await page.locator('input[name="variants.1.stock"]').fill("6");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/, { timeout: 30_000 });
    editUrl = new URL(page.url()).pathname;

    await page.locator('input[type="file"]').first().setInputFiles({ name: "src.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByLabel("Image caption")).toHaveCount(1, { timeout: 30_000 });

    await page.getByRole("button", { name: "Page content" }).click();
    await page.getByRole("button", { name: "Add question" }).click();
    await page.getByLabel("Question 1", { exact: true }).fill("Is it the original?");
    await page.getByLabel("Answer 1", { exact: true }).fill("Yes.");
    await page.getByTestId("product-status-panel").getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();

    await page.getByRole("button", { name: "SEO", exact: true }).click();
    slug = await page.getByLabel("URL slug").inputValue();
    expect(slug).toContain("e2e-tools-source");
  });

  test("2. duplicate from the editor: defaults, then the copy is a separate draft", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    await page.getByRole("button", { name: "Duplicate" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name of the copy")).toHaveValue(`${SOURCE} (copy)`);
    // Defaults: stock and SEO and hand-picked lists stay behind; images, FAQ, materials, sections come along.
    await expect(dialog.getByLabel("Stock quantities")).not.toBeChecked();
    await expect(dialog.getByLabel("SEO text")).not.toBeChecked();
    await expect(dialog.getByLabel("Hand-picked related products")).not.toBeChecked();
    await expect(dialog.getByLabel("Images")).toBeChecked();
    await expect(dialog.getByLabel("FAQ")).toBeChecked();
    await dialog.getByRole("button", { name: "Create draft copy" }).click();

    const result = page.getByTestId("duplicate-result");
    await expect(result).toContainText("was created as a draft");
    await expect(result).toContainText("2 variants");
    await expect(result).toContainText("1 images");
    await result.getByRole("link", { name: "Open the copy" }).click();

    await page.waitForURL((url) => /\/admin\/products\/.+\/edit$/.test(url.pathname) && url.pathname !== editUrl); // the copy's page, not the source's
    await expect(page.getByLabel("Product name")).toHaveValue(`${SOURCE} (copy)`);
    await expect(page.getByTestId("product-status-panel")).toContainText("Draft");
    await expect(page.getByLabel("Image caption")).toHaveCount(1); // its own copy of the photo

    await page.getByRole("button", { name: "Variants", exact: true }).click();
    const skus = [await page.locator('input[name="variants.0.sku"]').inputValue(), await page.locator('input[name="variants.1.sku"]').inputValue()];
    expect(skus[0]).toBeTruthy();
    expect(new Set(skus).size).toBe(2);
    expect(skus).not.toContain(SKU_A);
    expect(skus).not.toContain(SKU_B);
    await expect(page.locator('input[name="variants.0.stock"]')).toHaveValue("0"); // stock is not counted twice
    await expect(page.locator('input[name="variants.1.stock"]')).toHaveValue("0");

    await page.getByRole("button", { name: "Page content" }).click();
    await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue("Is it the original?");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByTestId("product-history")).toContainText("Duplicated from another product");
  });

  test("3. duplicate from the list, taking the stock and leaving the images", async ({ page }) => {
    await login(page);
    await findInList(page, SOURCE);
    await page.getByRole("button", { name: `Duplicate ${SOURCE}`, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name of the copy").fill(`${SOURCE} second copy`);
    await dialog.getByLabel("Stock quantities").check();
    await dialog.getByLabel("Images").uncheck();
    await dialog.getByRole("button", { name: "Create draft copy" }).click();
    await dialog.getByRole("link", { name: "Open the copy" }).click();

    await expect(page.getByLabel("Product name")).toHaveValue(`${SOURCE} second copy`);
    await expect(page.getByLabel("Image caption")).toHaveCount(0);
    await page.getByRole("button", { name: "Variants", exact: true }).click();
    await expect(page.locator('input[name="variants.0.stock"]')).toHaveValue("8");
    await expect(page.locator('input[name="variants.1.stock"]')).toHaveValue("6");
  });

  test("4. the original is untouched and its history says it was duplicated; earlier events read in plain words", async ({ page }) => {
    await login(page);
    await page.goto(editUrl);
    await page.getByRole("button", { name: "Variants", exact: true }).click();
    await expect(page.locator('input[name="variants.0.sku"]')).toHaveValue(SKU_A);
    await expect(page.locator('input[name="variants.0.stock"]')).toHaveValue("8");
    await page.getByRole("button", { name: "History" }).click();
    const history = page.getByTestId("product-history");
    await expect(history).toContainText("Duplicated"); // "product.copied", twice
    await expect(history).toContainText("FAQ changed"); // a label, not "product.faq_updated"
    await expect(history).not.toContainText("product.");
  });

  test("5. export the catalog, edit a copy of it, and see the changes before importing", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/import");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export all products" }).click()]);
    const exported = fs.readFileSync((await download.path())!, "utf-8");
    expect(exported.charCodeAt(0)).toBe(0xfeff); // UTF-8 byte-order mark for Excel
    const lines = exported.replace(/^\ufeff/, "").split("\r\n");
    const header = lines[0]!.split(",");
    const row = lines.find((l) => l.includes(`,${SKU_A},`))!;
    expect(row).toBeTruthy();
    category = row.split(",")[header.indexOf("category")]!;
    expect(category).toBeTruthy();

    // An unchanged export imports as "nothing to change".
    await page.getByLabel("CSV file").setInputFiles(csvFile("catalog.csv", exported));
    await page.getByRole("button", { name: "Check file" }).click();
    const report = page.getByTestId("import-report");
    await expect(report).toContainText("Unchanged");
    await expect(report.getByRole("button", { name: "Nothing to import" })).toBeDisabled();

    // Now a small edit: a new price and stock for the source, and one brand-new product.
    const edit = [
      "slug,name,category,product_type,base_price,variant_sku,variant_size,variant_color,variant_stock",
      `${slug},,,,2100,${SKU_A},,,11`,
      `e2e-tools-imported-${RUN},${IMPORTED},${category},CLOTHING,950,IMP-${RUN}-M,M,Black,4`,
    ].join("\n");
    await page.getByLabel("CSV file").setInputFiles(csvFile("edit.csv", edit));
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(report).toContainText("To create");
    await expect(report.getByText("base_price: 1800 → 2100")).toBeVisible();
    await expect(report.getByText(/stock 8 → 11/)).toBeVisible();
    await expect(report.getByText(IMPORTED)).toBeVisible();

    // Checking wrote nothing: neither the new product nor the new price exists yet.
    const api = process.env.E2E_API_URL ?? "http://localhost:4000";
    const found = await page.request.get(`${api}/api/products?search=${encodeURIComponent(IMPORTED)}`);
    expect((await found.json()).items).toHaveLength(0);
  });

  test("6. importing applies exactly that, as a draft", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/import");
    const edit = [
      "slug,name,category,product_type,base_price,variant_sku,variant_size,variant_color,variant_stock",
      `${slug},,,,2100,${SKU_A},,,11`,
      `e2e-tools-imported-${RUN},${IMPORTED},${category},CLOTHING,950,IMP-${RUN}-M,M,Black,4`,
    ].join("\n");
    await page.getByLabel("CSV file").setInputFiles(csvFile("edit.csv", edit));
    await page.getByRole("button", { name: "Check file" }).click();
    await page.getByRole("button", { name: "Import 2 products" }).click();
    await expect(page.getByTestId("import-result")).toContainText("1 created, 1 updated");

    // The source: price and stock changed, everything else (image, FAQ, name) kept.
    await page.goto(editUrl);
    await expect(page.getByLabel("Product name")).toHaveValue(SOURCE);
    await page.getByRole("button", { name: "Pricing & Inventory" }).click();
    await expect(page.getByLabel("Base price (BDT)")).toHaveValue("2100");
    await page.getByRole("button", { name: "Variants", exact: true }).click();
    await expect(page.locator('input[name="variants.0.stock"]')).toHaveValue("11");
    await expect(page.locator('input[name="variants.1.stock"]')).toHaveValue("6");
    await expect(page.getByLabel("Image caption")).toHaveCount(1);
    await page.getByRole("button", { name: "Page content" }).click();
    await expect(page.getByLabel("Question 1", { exact: true })).toHaveValue("Is it the original?");
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.getByTestId("product-history")).toContainText("Price changed");

    // The new product exists, as a draft.
    await page.goto("/admin/products");
    await page.getByPlaceholder("Search products…").fill(IMPORTED);
    await expect(page.getByText(IMPORTED).locator("visible=true").first()).toBeVisible(); // the list renders a table row (desktop) and a card (mobile)
    const api = process.env.E2E_API_URL ?? "http://localhost:4000";
    const listed = (await (await page.request.get(`${api}/api/products?search=${encodeURIComponent(IMPORTED)}`)).json()).items;
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("DRAFT"); // an import never publishes
  });

  test("7. a bad file is explained line by line and can't be imported; the good products can be, if you say so", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/import");
    const bad = [
      "slug,name,category,product_type,base_price,variant_sku,variant_size,variant_color",
      `e2e-tools-broken-${RUN},E2E Tools Broken ${RUN},${category},CLOTHING,abc,BRK-${RUN},M,Black`,
      `e2e-tools-fine-${RUN},E2E Tools Fine ${RUN},${category},CLOTHING,700,FINE-${RUN},M,Black`,
    ].join("\n");
    await page.getByLabel("CSV file").setInputFiles(csvFile("bad.csv", bad));
    await page.getByRole("button", { name: "Check file" }).click();

    const errors = page.getByTestId("import-errors");
    await expect(errors).toContainText("base_price");
    await expect(errors).toContainText("is not a number");
    await expect(errors.getByRole("cell", { name: "2", exact: true })).toHaveCount(1); // the line it's on, reported once
    await expect(page.getByRole("button", { name: "Import 1 product" })).toBeDisabled();

    await page.getByLabel("Skip products with errors").check();
    await page.getByRole("button", { name: "Import 1 product" }).click();
    await expect(page.getByTestId("import-result")).toContainText("1 created");

    await page.goto("/admin/products");
    await page.getByPlaceholder("Search products…").fill(`E2E Tools Fine ${RUN}`);
    await expect(page.getByText(`E2E Tools Fine ${RUN}`).locator("visible=true").first()).toBeVisible();
    await page.getByPlaceholder("Search products…").fill(`E2E Tools Broken ${RUN}`);
    await expect(page.getByText(`E2E Tools Broken ${RUN}`)).toHaveCount(0);
  });

  test("8. a file that isn't a product sheet, and one that's too big, are refused up front", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/import");
    await page.getByLabel("CSV file").setInputFiles(csvFile("wrong.csv", "colour,size\nred,M\n"));
    await page.getByRole("button", { name: "Check file" }).click();
    await expect(page.getByTestId("import-errors")).toContainText("variant_sku");

    await page.getByLabel("CSV file").setInputFiles(csvFile("huge.csv", `slug,variant_sku\n${"x".repeat(1_600_000)}`));
    await expect(page.getByRole("alert").first()).toContainText("limit is 1.5 MB");
    await expect(page.getByRole("button", { name: "Check file" })).toBeDisabled();
  });
});
