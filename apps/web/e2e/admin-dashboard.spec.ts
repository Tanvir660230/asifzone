import { test, expect, type Page } from "@playwright/test";

// The admin dashboard as an operations cockpit: Action Center, today's tiles, recent orders, the Ctrl/⌘+K palette, the
// Create menu, and deep links into a pre-filtered Orders list. Read-only — it never changes data.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
// First visit to a route under `next dev` compiles it — allow for that, not just the client-side navigation.
const NAV = { timeout: 30_000 };

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
}

test.describe("admin dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("shows the cockpit sections", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
    await expect(page.getByText("Today", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent orders" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Analytics" })).toBeVisible();
    // The old analytics tabs are gone — their content lives in BI.
    await expect(page.getByRole("button", { name: "Catalog Performance" })).toHaveCount(0);
  });

  test("'To confirm' tile opens Orders filtered to pending + confirmed", async ({ page }) => {
    await page.getByRole("link", { name: /^To confirm:/ }).click();
    await expect(page).toHaveURL(/\/admin\/orders\?status=PENDING,CONFIRMED/, NAV);
    await expect(page.getByText("Status: Pending")).toBeVisible();
    await expect(page.getByText("Status: Confirmed")).toBeVisible();
  });

  test("Ctrl+K palette jumps to a page", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search and jump" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("inventory");
    await expect(dialog.getByRole("option", { name: /Inventory/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/inventory/, NAV);
  });

  test("Create menu offers a new order", async ({ page }) => {
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: "New order" }).click();
    await expect(page).toHaveURL(/\/admin\/orders\/new/, NAV);
  });
});
