import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

const RUN = String(Date.now()).slice(-8);
const TEMPLATE_NAME = `Wizard Simple template ${RUN}`;
const TYPE_NAME = `Wizard Simple ${RUN}`;
const SIMPLE_PRODUCT = `Wizard Simple Product ${RUN}`;
const VARIANT_PRODUCT = `Wizard Variant Product ${RUN}`;

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

// Assert on the progress header's own step chips (data-testid) rather than role+label text — several
// step panes reuse the same words as their own headings/buttons (e.g. ProductStatusPanel also has a
// "Publish" button), which makes a plain accessible-name lookup ambiguous.
const CORE_STEP_IDS = ["basics", "media", "pricing", "content", "seo", "preview", "review", "publish"];
const DYNAMIC_STEP_IDS = ["variants", "care", "sizeGuide"];
const stepChip = (page: Page, id: string) => page.getByTestId(`wizard-step-${id}`);

/** Fills Basics + Pricing (+ a minimal variant, when the type has size/color and Variants is part of
 * the pre-create phase — the server validates a type's declared dimensions on every create, so a
 * variant-having type can't be created with the untouched blank default row) on the "new" wizard and
 * finishes creation, landing on the edit wizard. */
async function createThroughWizard(page: Page, name: string, typeLabel: string, price: string) {
  await page.goto("/admin/products/wizard/new");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Product type").selectOption({ label: typeLabel });
  await page.getByRole("button", { name: "Continue" }).click(); // -> Media
  await page.getByRole("button", { name: "Continue" }).click(); // -> Pricing
  await page.getByLabel("Base price (BDT)").fill(price);
  await page.getByRole("button", { name: "Continue" }).click(); // -> Variants, or creates directly

  if (await stepChip(page, "variants").getAttribute("aria-current").catch(() => null) === "step") {
    await page.getByPlaceholder("SKU-001").first().fill(`WZ-${Date.now()}`);
    const size = page.locator('input[name="variants.0.size"]');
    if (await size.count()) await size.fill("M");
    const color = page.locator('input[name="variants.0.color"]');
    if (await color.count()) await color.fill("Black");
    await page.getByRole("button", { name: "Continue" }).click(); // creates the product
  }

  await expect(page).toHaveURL(/\/admin\/products\/wizard\/[^/]+\/edit/);
  await expect(page.getByRole("heading", { name: `Edit ${name}` })).toBeVisible();
  return page.url().match(/wizard\/([^/]+)\/edit/)?.[1] ?? "";
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test.describe("product wizard: dynamic steps, create, autosave", () => {
  let simpleProductId = "";
  let variantProductId = "";

  test("1. set up a type with no size/color choice at all (a true simple product)", async ({ page }) => {
    await login(page);

    await page.goto("/admin/catalog/templates");
    await page.getByRole("button", { name: /add template/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(TEMPLATE_NAME);
    // Deliberately leave "Has a size" and "Has a colour" unchecked, and size guide at NOT_APPLICABLE
    // (the default) — this is the "simple product, no options at all" shape from the spec. Material
    // and Care default to shown for every template (independent of variant options — a product with
    // no size/color can still have care instructions), so this type also switches both off, to get a
    // genuinely step-free "simple product" with none of the three dynamic steps at all.
    await page.getByLabel("Material visibility").selectOption("false");
    await page.getByLabel("Care instructions visibility").selectOption("false");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(TEMPLATE_NAME).first()).toBeVisible();

    await page.goto("/admin/catalog/types");
    await page.getByRole("button", { name: /add product type/i }).click();
    await page.getByLabel("Name", { exact: true }).fill(TYPE_NAME);
    await page.getByLabel("Template").selectOption({ label: TEMPLATE_NAME });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(TYPE_NAME).first()).toBeVisible();
  });

  test("2. the 'new' wizard never shows Care & Material or Size Guide (or anything past Pricing) before the product exists", async ({ page }) => {
    await login(page);
    // A type with no variant dimensions: nothing at all exists before the product does — 3 steps flat.
    await page.goto("/admin/products/wizard/new");
    await page.getByLabel("Product type").selectOption({ label: TYPE_NAME });
    await expect(page.getByText("Step 1 of 3")).toBeVisible();

    // A type WITH size/color: Variants also has to be reachable pre-creation (the server requires a
    // real size/color on the very first save for a type that declares those dimensions) — but Care &
    // Material and Size Guide still don't, since nothing about creating the row needs them.
    await page.goto("/admin/products/wizard/new");
    await page.getByLabel("Product type").selectOption({ label: "Clothing" });
    await expect(page.getByText("Step 1 of 4")).toBeVisible();
    await expect(stepChip(page, "variants")).toBeVisible();
    for (const id of ["care", "sizeGuide", "content", "seo", "preview", "review", "publish"]) {
      await expect(stepChip(page, id)).toHaveCount(0);
    }
  });

  test("3. Back preserves what was typed on an earlier step", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/wizard/new");
    await page.getByLabel("Product name").fill(SIMPLE_PRODUCT);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(stepChip(page, "media")).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Product name")).toHaveValue(SIMPLE_PRODUCT);
  });

  test("4. a simple-typed product's full step list (after creation) skips Options & Variants, Care & Material, and Size Guide", async ({ page }) => {
    await login(page);
    simpleProductId = await createThroughWizard(page, SIMPLE_PRODUCT, TYPE_NAME, "990");
    expect(simpleProductId).toBeTruthy();

    for (const id of CORE_STEP_IDS) {
      await expect(stepChip(page, id)).toBeVisible();
    }
    for (const id of DYNAMIC_STEP_IDS) {
      await expect(stepChip(page, id)).toHaveCount(0);
    }

    const cookieHeader = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await page.request.get(`${API}/api/products/${simpleProductId}`, { headers: { Cookie: cookieHeader } });
    expect((await res.json()).product.status).toBe("DRAFT");
  });

  test("5. a Clothing-typed product's full step list includes Options & Variants, Care & Material and Size Guide", async ({ page }) => {
    await login(page);
    variantProductId = await createThroughWizard(page, VARIANT_PRODUCT, "Clothing", "1890");
    expect(variantProductId).toBeTruthy();

    for (const id of [...CORE_STEP_IDS, ...DYNAMIC_STEP_IDS]) {
      await expect(stepChip(page, id)).toBeVisible();
    }
  });

  test("6. autosave persists an edit without an explicit save action", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${simpleProductId}/edit`);

    await page.getByLabel("Short description").fill(`Autosaved ${RUN}`);
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText(/Saving…|Saved/, { timeout: 5_000 });
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText("Saved", { timeout: 5_000 });

    await page.reload();
    await expect(page.getByLabel("Short description")).toHaveValue(`Autosaved ${RUN}`);
  });

  test("7. Options & Variants is reachable and works on the variant product's edit wizard", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${variantProductId}/edit`);
    await stepChip(page, "variants").click();
    await expect(page.getByRole("heading", { name: "Options & Variants" })).toBeVisible();
    await page.getByPlaceholder("SKU-001").first().fill(`WZ-${RUN}-M`);
  });
});
