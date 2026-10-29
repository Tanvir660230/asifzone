import { test, expect, type Page } from "@playwright/test";

// The Store Console on a phone: an iOS-style shell — tab bar always on screen, a navigation bar with a back button, the
// whole console in the More sheet, "⋯" menus as action sheets and dialogs as bottom sheets. Phone project only.
// Read-only — it never changes data.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
// First visit to a route under `next dev` compiles it — allow for that, not just the client-side navigation.
const NAV = { timeout: 30_000 };

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
}

test.describe("admin on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "the phone shell only");

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("the tab bar sits inside the visible screen", async ({ page }) => {
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs.getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page", NAV);
    // The shell is sized to the dynamic viewport, so the bar ends at the bottom edge — never below it.
    const box = await tabs.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box!.y).toBeGreaterThan(viewport.height / 2);

    await tabs.getByRole("link", { name: /Orders/ }).click();
    await expect(page).toHaveURL(/\/admin\/orders/, NAV);
    await expect(tabs.getByRole("link", { name: /Orders/ })).toHaveAttribute("aria-current", "page");
  });

  test("More opens every module, and a module's pages", async ({ page }) => {
    await page.getByRole("button", { name: "More navigation" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Settings", { exact: true })).toBeVisible();

    // A module with pages pushes to its own list; "Menu" goes back.
    await sheet.getByRole("button", { name: /^Marketing/ }).click();
    // Marketing › Discounts holds flash sales, coupons and bundles as tabs (blueprint tab 2 §2)
    await expect(sheet.getByRole("link", { name: /Discounts/ })).toBeVisible();
    await sheet.getByRole("button", { name: "Menu" }).click();
    await expect(sheet.getByRole("button", { name: /^Marketing/ })).toBeVisible();

    await sheet.getByRole("button", { name: /^Marketing/ }).click();
    await sheet.getByRole("link", { name: /Discounts/ }).click();
    await expect(page).toHaveURL(/\/admin\/flash-sales/, NAV);
    await expect(sheet).toBeHidden();
    // its other pages are tabs on the page
    await expect(page.getByRole("link", { name: /Coupons/ }).first()).toBeVisible(NAV);
  });

  test("a detail page has a back button and no duplicate", async ({ page }) => {
    await page.goto("/admin/orders/new", NAV);
    await expect(page.getByRole("heading", { name: "New order", level: 1 })).toBeVisible(NAV);
    const back = page.getByRole("link", { name: "Back to Orders" });
    await expect(back).toHaveCount(1);
    await back.click();
    await expect(page).toHaveURL(/\/admin\/orders$/, NAV);
  });

  test("wide tables read as cards, and fit the screen", async ({ page }) => {
    await page.goto("/admin/team", NAV);
    const table = page.locator("main table").first();
    await expect(table).toHaveAttribute("data-stack", "on", NAV);
    // Each value sits beside its column's name; nothing scrolls sideways.
    await expect(table.locator("tbody td[data-label='Role']").first()).toBeVisible();
    const overflow = await page.locator("main").evaluate((main) => main.parentElement!.scrollWidth - main.parentElement!.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("filters open as a sheet, and the homepage can be edited", async ({ page }) => {
    await page.goto("/admin/orders", NAV);
    await page.getByRole("button", { name: /Filters/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "More filters" });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(Math.round(box!.width)).toBe(page.viewportSize()!.width);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();

    // The homepage opens the Storefront Studio in its phone layout — editable, not view-only.
    await page.goto("/admin/homepage", NAV);
    await expect(page.getByTestId("studio-mode-page")).toBeVisible(NAV);
    await expect(page.getByRole("button", { name: /^Switch off/ }).first()).toBeEnabled();
  });

  test("Create is an action sheet; a dialog is a bottom sheet", async ({ page }) => {
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const sheet = page.getByRole("menu");
    await expect(sheet.getByRole("menuitem", { name: "New order" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sheet).toBeHidden();

    await page.goto("/admin/inventory", NAV);
    await page.getByRole("button", { name: "Adjust stock" }).click();
    const dialog = page.getByRole("dialog", { name: "Adjust stock" });
    await expect(dialog).toBeVisible();
    // Up from the bottom edge, full width.
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(Math.round(box!.width)).toBe(viewport.width);
    expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(viewport.height - 1);
  });
});
