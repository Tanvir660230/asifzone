import { test, expect } from "@playwright/test";

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

test.describe("admin customer management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test("lists customers and opens a detail panel", async ({ page }) => {
    const openMenu = page.getByRole("button", { name: /open menu/i });
    if (await openMenu.isVisible()) await openMenu.click();

    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/admin\/customers$/);
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

    // Below the `sm` breakpoint the page swaps the table for a card list — both render in the
    // DOM (only one is shown via CSS), so scope to whichever copy of the row is actually visible.
    const firstRow = page.locator('[data-testid="customer-row"]:visible').first();
    await expect(firstRow).toBeVisible();

    // Rows open an in-place drawer (CustomerDetailPanel) rather than navigating to a detail
    // page, so the URL stays on /admin/customers — assert on the drawer's content instead.
    await firstRow.getByRole("button").first().click();
    await expect(page.getByText("Customer details")).toBeVisible();
    await expect(page.getByText(/Addresses \(/)).toBeVisible();
    await expect(page.getByText(/Order History \(/)).toBeVisible();
  });

  test("search narrows the customer list", async ({ page }) => {
    await page.goto("/admin/customers");
    await page.getByPlaceholder(/search name, phone, email, order/i).fill("zzz_no_such_customer_zzz");
    // An active search shows the "no results for your filter" empty state, distinct from the
    // plain "No customers yet" shown when the whole list is empty. Both the table and card-list
    // layouts render their own copy (only one visible via CSS), so scope to the visible one.
    await expect(page.locator('[data-testid="customers-empty-filtered"]:visible')).toBeVisible();
  });
});
