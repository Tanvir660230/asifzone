import { test, expect, type Page } from "@playwright/test";

// Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3): the admin links matching products by hand, and each
// member's product page shows the others as photo tiles that link to their own pages. Products are never changed.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const RUN = String(Date.now()).slice(-8);

interface ApiProduct { id: string; name: string; slug: string }

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

async function threeProducts(): Promise<ApiProduct[]> {
  const res = await fetch(`${API}/api/products/storefront?pageSize=50`);
  const items = ((await res.json()) as { items: ApiProduct[] }).items;
  // Distinct names, so a search for one finds that one.
  const unique = items.filter((p, i) => items.findIndex((q) => q.name === p.name) === i);
  expect(unique.length, "the test needs three published products").toBeGreaterThanOrEqual(3);
  return unique.slice(0, 3);
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

async function add(page: Page, product: ApiProduct) {
  await page.getByPlaceholder("Search products by name…").fill(product.name);
  await page.getByRole("button", { name: new RegExp(product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await expect(page.getByTestId("family-members")).toContainText(product.name);
}

test("make a family in admin, and its products link to each other on the store", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop", "the admin flow runs once; the shopper half is checked at phone width below");
  const [a, b, c] = await threeProducts();
  const name = `E2E family ${RUN}`;
  await login(page);

  await page.goto("/admin/products/families");
  await page.getByTestId("family-new").first().click();
  await page.getByLabel("Family name").fill(name);
  await add(page, a!);
  await add(page, b!);
  await add(page, c!);
  // c up one: a, c, b.
  await page.getByRole("button", { name: `Move ${c!.name} up` }).click();
  await page.getByTestId("family-save").click();
  // The saved family's own address (not /new) — the save landed.
  await expect(page).toHaveURL(/\/admin\/products\/families\/(?!new$)[a-z0-9]+$/);
  await page.reload();
  const rows = page.getByTestId("family-members").locator("li");
  await expect(rows.nth(0)).toContainText(a!.name);
  await expect(rows.nth(1)).toContainText(c!.name);
  await expect(rows.nth(2)).toContainText(b!.name);

  // The shopper, on a phone: the family on a's page, a chosen, a tap goes to c's page with c chosen.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await expect(async () => {
    await phone.goto(`/product/${a!.slug}`);
    await expect(phone.getByTestId("product-family").filter({ hasText: name })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 }); // the storefront caches a product's families for up to a minute
  const family = phone.getByTestId("product-family").filter({ hasText: name });
  await expect(family.locator("[aria-current=page]")).toHaveCount(1);
  await expect(family.getByTestId("family-tile")).toHaveCount(2);
  await family.getByTestId("family-tile").first().click();
  await expect(phone).toHaveURL(new RegExp(`/product/${c!.slug}$`));
  await expect(phone.getByRole("heading", { level: 1, name: c!.name })).toBeVisible();
  // The buying words match the rest of the website (English).
  await expect(phone.getByRole("button", { name: "Add to Cart" }).first()).toBeVisible();
  await phone.close();

  // Delete: the family goes, the list is back to its empty state or without it.
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete family" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/families$/);
  await expect(page.getByText(name)).toHaveCount(0);
});
