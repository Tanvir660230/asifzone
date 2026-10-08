import { test, expect, type Page } from "@playwright/test";

// The shell's section bar: a module's pages pinned under the toolbar whenever the sidebar isn't listing them (collapsed
// rail, phones), so moving between them never needs the rail's hover flyout. Read-only — it never changes data.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
// First visit to a route under `next dev` compiles it — allow for that, not just the client-side navigation.
const NAV = { timeout: 30_000 };
const SHOTS = process.env.SECTION_BAR_SHOTS;

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
}

test.describe("admin section bar", () => {
  test.beforeEach(async ({ page }) => {
    // Collapsed rail on desktop — the case where the pages used to sit behind a hover.
    await page.addInitScript(() => localStorage.setItem("admin-sidebar", "collapsed"));
    await login(page);
  });

  test("moves between a module's pages without the sidebar", async ({ page }, info) => {
    await page.goto("/admin/products", NAV);
    const bar = page.getByRole("navigation", { name: "Products pages" });
    await expect(bar).toBeVisible(NAV);
    await expect(bar.getByRole("link", { name: "All products" })).toHaveAttribute("aria-current", "page");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/products-${info.project.name}.png` });

    await bar.getByRole("link", { name: "Categories" }).click();
    await expect(page).toHaveURL(/\/admin\/categories/, NAV);
    await expect(bar.getByRole("link", { name: "Categories" })).toHaveAttribute("aria-current", "page");

    // A deeper page keeps its module tab lit; its own ten pages stay as in-page tabs.
    await bar.getByRole("link", { name: "Catalog setup" }).click();
    await expect(page).toHaveURL(/\/admin\/catalog\//, NAV);
    await expect(bar.getByRole("link", { name: "Catalog setup" })).toHaveAttribute("aria-current", "page");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/catalog-${info.project.name}.png` });

    await page.goto("/admin/orders", NAV);
    const orders = page.getByRole("navigation", { name: "Orders pages" });
    await expect(orders.getByRole("link", { name: "All orders" })).toHaveAttribute("aria-current", "page", NAV);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/orders-${info.project.name}.png` });

    // Scrolled: the page's own sticky filter bar pins under the section bar (top-chrome), not beneath it.
    const barBox = await orders.boundingBox();
    await page.locator("main").evaluate((main) => main.parentElement?.scrollBy(0, 900));
    const filterSearch = page.getByPlaceholder(/Search order/);
    await expect(filterSearch).toBeInViewport();
    const searchBox = await filterSearch.boundingBox();
    expect(searchBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/orders-scrolled-${info.project.name}.png` });
  });

  test("stays out of create flows", async ({ page }) => {
    await page.goto("/admin/products/new", NAV);
    await expect(page.getByRole("navigation", { name: "Products pages" })).toHaveCount(0);
  });
});
