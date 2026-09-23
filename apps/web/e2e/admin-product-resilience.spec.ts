import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

const RUN = String(Date.now()).slice(-8);
const PRODUCT = `Resilient Panjabi ${RUN}`;
// 1x1 transparent PNG — a real image the server's sharp pipeline accepts.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

async function apiProduct(page: Page, id: string) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  return (await (await page.request.get(`${API}/api/products/${id}`, { headers: { Cookie: cookie } })).json()).product;
}

const stepChip = (page: Page, id: string) => page.getByTestId(`wizard-step-${id}`);

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1600, height: 1000 } });

test.describe("product wizard: upload failures, save failures, variant bulk tools", () => {
  let productId = "";

  test("1. a photo that fails to upload after creation stays visible with a Retry — and Retry finishes the job", async ({ page }) => {
    await login(page);

    // The first upload request fails as if storage were down; later ones go through.
    let uploadsSeen = 0;
    await page.route("**/api/products/*/images", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      uploadsSeen += 1;
      if (uploadsSeen === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated storage failure" }) });
      return route.continue();
    });

    await page.goto("/admin/products/wizard/new");
    await page.getByLabel("Product name").fill(PRODUCT);
    await page.getByLabel("Category").selectOption({ index: 1 });
    await page.getByLabel("Product type").selectOption({ label: "Clothing" });
    await page.getByRole("button", { name: "Continue" }).click(); // -> Media
    await page.locator('input[type="file"]').setInputFiles([
      { name: "front.png", mimeType: "image/png", buffer: PNG },
      { name: "back.png", mimeType: "image/png", buffer: PNG },
    ]);
    await page.getByRole("button", { name: "Continue" }).click(); // -> Pricing
    await page.getByLabel("Base price (BDT)").fill("1890");
    await page.getByRole("button", { name: "Continue" }).click(); // -> Variants
    await page.getByPlaceholder("SKU-001").first().fill(`RS-${RUN}-M`);
    await page.locator('input[name="variants.0.size"]').fill("M");
    await page.locator('input[name="variants.0.color"]').fill("Black");
    await page.locator('input[name="variants.0.stock"]').fill("5");
    await page.getByRole("button", { name: "Continue" }).click(); // creates the draft

    // Lands on Media, where the two staged photos upload: one fails, one lands.
    await expect(page).toHaveURL(/\/wizard\/[^/]+\/edit\?step=media/);
    productId = page.url().match(/wizard\/([^/]+)\/edit/)![1]!;
    await expect(stepChip(page, "media")).toHaveAttribute("aria-current", "step");
    const failed = page.locator('[data-testid="upload-item"][data-status="failed"]');
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText("Simulated storage failure");
    await expect.poll(async () => (await apiProduct(page, productId)).images.length).toBe(1);

    // The product itself is a normal, valid draft — nothing half-made.
    expect((await apiProduct(page, productId)).status).toBe("DRAFT");

    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("upload-item")).toHaveCount(0);
    await expect.poll(async () => (await apiProduct(page, productId)).images.length).toBe(2);
  });

  test("2. a failed save keeps what was typed, says so, and the next edit saves it", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit`);

    await page.route(`**/api/products/${productId}`, (route) => (route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.continue()));
    await page.getByLabel("Short description").fill(`Written offline ${RUN}`);
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText(/Couldn't save/, { timeout: 10_000 });
    await expect(page.getByLabel("Short description")).toHaveValue(`Written offline ${RUN}`);

    await page.unroute(`**/api/products/${productId}`);
    await page.getByLabel("Short description").fill(`Written offline ${RUN}, then online`);
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText("Saved", { timeout: 10_000 });
    await page.reload();
    await expect(page.getByLabel("Short description")).toHaveValue(`Written offline ${RUN}, then online`);
  });

  test("3. duplicate SKUs are flagged while typing; bulk set stock/price; generate missing SKUs", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/products/wizard/${productId}/edit?step=variants`);
    await expect(stepChip(page, "variants")).toHaveAttribute("aria-current", "step");

    await page.getByRole("button", { name: "Add variant manually" }).click();
    await page.locator('input[name="variants.1.size"]').fill("L");
    await page.locator('input[name="variants.1.color"]').fill("Black");
    await page.locator('input[name="variants.1.sku"]').fill(`RS-${RUN}-M`);
    await expect(page.getByTestId("duplicate-sku-warning")).toBeVisible();
    await expect(page.locator('input[name="variants.1.sku"]')).toHaveAttribute("aria-invalid", "true");
    await page.locator('input[name="variants.1.sku"]').fill(`RS-${RUN}-L`);
    await expect(page.getByTestId("duplicate-sku-warning")).toHaveCount(0);

    // Stock for every variant at once.
    const bulk = page.getByTestId("variant-bulk-bar");
    await bulk.getByLabel("Set").selectOption("stock");
    await bulk.getByLabel("to").fill("12");
    await bulk.getByRole("button", { name: /apply to all 2/i }).click();
    await expect(page.locator('input[name="variants.0.stock"]')).toHaveValue("12");
    await expect(page.locator('input[name="variants.1.stock"]')).toHaveValue("12");

    // A price override for just the selected one.
    await page.getByLabel("Select variant 2").check();
    await bulk.getByLabel("Set").selectOption("price");
    await bulk.getByLabel("to").fill("1999");
    await bulk.getByRole("button", { name: /apply to 1 selected/i }).click();
    await expect(page.locator('input[name="variants.1.price"]')).toHaveValue("1999");
    await expect(page.locator('input[name="variants.0.price"]')).toHaveValue("");

    // A third row with no SKU: generated from the pattern, unique among the rows already there.
    await page.getByRole("button", { name: "Add variant manually" }).click();
    await page.locator('input[name="variants.2.size"]').fill("XL");
    await page.locator('input[name="variants.2.color"]').fill("Black");
    await page.getByRole("button", { name: /generate missing skus/i }).click();
    await expect(page.locator('input[name="variants.2.sku"]')).not.toHaveValue("");
    await expect(page.getByTestId("duplicate-sku-warning")).toHaveCount(0);

    // All of it autosaves.
    await expect(page.getByTestId("wizard-autosave-status")).toHaveText("Saved", { timeout: 10_000 });
    await expect
      .poll(async () => {
        const variants = (await apiProduct(page, productId)).variants as { size: string; stock: number; price: string | null }[];
        return variants.map((v) => `${v.size}:${v.stock}:${v.price === null ? "-" : Number(v.price)}`).sort().join(",");
      })
      .toBe("L:12:1999,M:12:-,XL:0:-");
  });
});
