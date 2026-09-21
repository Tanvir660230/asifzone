import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

// Unique per run so reruns never collide with rows an earlier (possibly failed) run left behind.
const RUN = String(Date.now()).slice(-8);
const ATTR_LABEL = `Embroidery ${RUN}`;
const GUIDE_NAME = `Cap size guide ${RUN}`;
const TEMPLATE_NAME = `Cap template ${RUN}`;
const TYPE_NAME = `Cap ${RUN}`;
const PRODUCT_NAME = `E2E Cap ${RUN}`;

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

// A single serial flow: each step builds on the previous one, exactly as an admin would.
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
// Fail fast on a wrong locator instead of waiting out the whole test timeout.
test.use({ actionTimeout: 15_000 });

test.describe("admin creates a brand-new product type with no code change", () => {
  let productSlug = "";

  test("1. define a select attribute", async ({ page, isMobile }) => {
    await login(page);
    await page.goto("/admin/catalog/attributes");
    await page.getByRole("button", { name: /add attribute/i }).click();
    await page.getByLabel("Label").fill(ATTR_LABEL);
    await page.getByLabel("Field type").selectOption("SELECT");
    await page.getByLabel(/Options \(one per line\)/).fill("Hand Embroidery\nMachine Embroidery\nNone");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(ATTR_LABEL, { exact: false }).first()).toBeVisible();
    // The options column is hidden below the md breakpoint by design.
    if (!isMobile) await expect(page.getByText("Hand Embroidery").first()).toBeVisible();
  });

  test("2. create a cap size guide with its own columns", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/size-guides");
    await page.getByRole("button", { name: /add size guide/i }).click();
    await page.getByLabel("Name").fill(GUIDE_NAME);
    await page.getByLabel("Unit label").fill("cm");
    await page.getByLabel("Column 2 heading").fill("Head circumference");
    await page.getByLabel("Row 1, Head circumference").fill("54–56");
    await page.getByLabel("Row 2, Head circumference").fill("56–58");
    await page.getByLabel("Row 3, Head circumference").fill("58–60");
    // The preview shows the chart exactly as customers will see it.
    await expect(page.getByText("All measurements are in cm.")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: GUIDE_NAME })).toBeVisible();
  });

  test("3. create a template that uses them", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/templates");
    await page.getByRole("button", { name: /add template/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(TEMPLATE_NAME);
    await page.getByRole("checkbox", { name: "Has a size (or size-like) choice" }).check();
    await page.getByLabel("Has a size (or size-like) choice label", { exact: true }).fill("Cap size");
    await page.getByLabel("Has a size (or size-like) choice values", { exact: true }).fill("S, M, L");
    await page.getByLabel("Behaviour").selectOption("ON_BY_DEFAULT");
    await page.getByLabel("Size guide", { exact: true }).selectOption({ label: GUIDE_NAME });
    await page.getByLabel("Attribute to add").selectOption({ label: `${ATTR_LABEL} (Select (one option))` });
    await page.getByRole("button", { name: /^Add$/ }).click();
    await page.getByLabel("Required", { exact: true }).check();
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(TEMPLATE_NAME).first()).toBeVisible();
  });

  test("4. create the product type", async ({ page }) => {
    await login(page);
    await page.goto("/admin/catalog/types");
    await page.getByRole("button", { name: /add product type/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(TYPE_NAME);
    await page.getByLabel("Template").selectOption({ label: TEMPLATE_NAME });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(TYPE_NAME).first()).toBeVisible();
  });

  test("5. the product editor offers the new type, with its own fields, and enforces them", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await page.getByLabel("Product name").fill(PRODUCT_NAME);
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Product type").selectOption({ label: TYPE_NAME });

    // The type's own attribute and size guide editor appear; nothing about Clothing does.
    await expect(page.getByText(`${TYPE_NAME} details`)).toBeVisible();
    await expect(page.getByLabel(ATTR_LABEL)).toBeVisible();
    await expect(page.getByLabel("Material")).toHaveCount(0);
    await expect(page.getByText("Show Size Guide on Storefront")).toBeVisible();

    await page.getByRole("button", { name: "Pricing & Inventory" }).click();
    await page.getByLabel("Base price (BDT)").fill("450");

    await page.getByRole("button", { name: "Variants", exact: true }).click();
    // The variant form speaks the template's language: "Cap size", and no colour input at all.
    await expect(page.getByText("Cap size").first()).toBeVisible();
    await page.getByPlaceholder("SKU-001").first().fill(`E2E-CAP-${RUN}-M`);
    await page.getByPlaceholder(/e\.g\. S, M, L/).first().fill("M");
    await page.locator('input[name="variants.0.stock"]').fill("7");

    // Required attribute left empty -> blocked with a clear message.
    await page.getByRole("button", { name: "Create product" }).click();
    await page.getByRole("button", { name: "Basic Info" }).click();
    await expect(page.getByText(`${ATTR_LABEL} is required`)).toBeVisible();

    await page.getByLabel(ATTR_LABEL).selectOption("Hand Embroidery");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/, { timeout: 30_000 });

    const link = page.getByRole("link", { name: /view on site/i });
    productSlug = (await link.getAttribute("href"))!.replace("/product/", "");
    expect(productSlug).toContain("e2e-cap");
  });

  test("6. saved values survive a reload of the editor", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products");
    await page.getByPlaceholder(/search/i).first().fill(PRODUCT_NAME);
    // The list filters after a debounce, and below `sm` it swaps the table for a card list (each with its own
    // edit link) — so wait until exactly one visible edit link is left: this run's product.
    const editLinks = page.locator('a[href$="/edit"]:visible');
    await expect(editLinks).toHaveCount(1);
    await editLinks.click();
    await expect(page).toHaveURL(/\/admin\/products\/.+\/edit/);
    await expect(page.getByLabel("Product type")).toHaveValue(/.+/, { timeout: 15_000 });
    await expect(page.getByLabel("Product type").locator("option:checked")).toHaveText(TYPE_NAME);
    await expect(page.getByLabel(ATTR_LABEL)).toHaveValue("Hand Embroidery");
  });

  test("7. the storefront shows specs, size guide and variant label from the template", async ({ page }) => {
    await page.goto(`/product/${productSlug}`);
    await expect(page.getByRole("heading", { name: PRODUCT_NAME })).toBeVisible();

    // Specs section built from the template's attribute.
    await page.getByRole("button", { name: /^specifications$/i }).click();
    await expect(page.getByText(`${ATTR_LABEL}:`)).toBeVisible();
    await expect(page.getByText("Hand Embroidery").first()).toBeVisible();

    // Variant picker uses the template's label.
    await expect(page.getByText("Cap size", { exact: false }).first()).toBeVisible();

    // The cap's own size-guide columns, not the apparel chart's.
    await page.getByRole("button", { name: /size guide/i }).click();
    await expect(page.getByRole("columnheader", { name: "Head circumference" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Chest" })).toHaveCount(0);
  });
});
