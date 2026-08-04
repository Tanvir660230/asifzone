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

  test("lists customers and opens a detail page", async ({ page }) => {
    const openMenu = page.getByRole("button", { name: /open menu/i });
    if (await openMenu.isVisible()) await openMenu.click();

    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page).toHaveURL(/\/admin\/customers$/);
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible();

    const customerLink = firstRow.locator("a").first();
    await customerLink.click();
    await expect(page).toHaveURL(/\/admin\/customers\/[a-z0-9]+/);
    await expect(page.getByText("Profile")).toBeVisible();
    await expect(page.getByText(/Addresses \(/)).toBeVisible();
    await expect(page.getByText(/Orders \(/)).toBeVisible();
    await expect(page.getByText(/Wishlist \(/)).toBeVisible();
  });

  test("search narrows the customer list", async ({ page }) => {
    await page.goto("/admin/customers");
    await page.getByPlaceholder(/search name, email, phone/i).fill("zzz_no_such_customer_zzz");
    await expect(page.getByText(/no customers yet/i)).toBeVisible();
  });
});
