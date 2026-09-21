import { test, expect, type Page } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

async function saveProduct(page: Page) {
  const saved = page.waitForResponse(
    (res) => /\/api\/products\/[^/]+$/.test(new URL(res.url()).pathname) && res.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: /^save product$/i }).click();
  const res = await saved;
  expect(res.ok()).toBeTruthy();
}

// Regression: the edit form used to omit productType/attributes from its defaults, so saving any
// edit re-submitted "CLOTHING" and blank spec fields — silently resetting the product's type and
// wiping its specifications.
test.describe("admin product type", () => {
  test("type and specifications survive saving and reopening a product", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);

    await page.goto("/admin/products");
    const firstEdit = page.locator('a[href$="/edit"]:visible').first();
    await expect(firstEdit).toBeVisible();
    const editUrl = await firstEdit.getAttribute("href");
    await page.goto(editUrl!);

    // Turn it into a fragrance with a specification, and save.
    await page.locator("#productType").selectOption("FRAGRANCE");
    await page.locator("#attr-topNotes").fill("Bergamot E2E");
    await saveProduct(page);

    // Reopen: the type and the specification must have been loaded back into the form.
    await page.reload();
    await expect(page.locator("#productType")).toHaveValue("FRAGRANCE");
    await expect(page.locator("#attr-topNotes")).toHaveValue("Bergamot E2E");

    // Save again without touching either field (the case that used to wipe them), then reopen.
    await saveProduct(page);
    await page.reload();
    await expect(page.locator("#productType")).toHaveValue("FRAGRANCE");
    await expect(page.locator("#attr-topNotes")).toHaveValue("Bergamot E2E");

    // Put the shared demo product back so other specs see it as it was.
    await page.locator("#productType").selectOption("CLOTHING");
    await saveProduct(page);
    await page.reload();
    await expect(page.locator("#productType")).toHaveValue("CLOTHING");
  });
});
