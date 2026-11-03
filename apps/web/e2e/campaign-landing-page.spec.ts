import { test, expect, type Page } from "@playwright/test";

// Campaign landing pages (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2): the admin builds a page for a product from a
// template, edits it with the live preview, publishes it, and a shopper orders from it — through the same checkout and
// from the same stock as the product's own pages.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const RUN = String(Date.now()).slice(-8);

interface ApiVariant { id: string; size: string; color: string; stock: number }
interface ApiProduct { id: string; name: string; slug: string; trackInventory: boolean; variants: ApiVariant[] }

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

async function stockedProduct(): Promise<{ product: ApiProduct; variant: ApiVariant }> {
  const res = await fetch(`${API}/api/products/storefront?pageSize=50`);
  const items = ((await res.json()) as { items: ApiProduct[] }).items;
  const product = items.find((p) => p.variants.some((v) => v.stock > 2))!;
  return { product, variant: product.variants.find((v) => v.stock > 2)! };
}

async function stockOf(slug: string, variantId: string) {
  const res = await fetch(`${API}/api/products/slug/${slug}`);
  return ((await res.json()) as { product: ApiProduct }).product.variants.find((v) => v.id === variantId)!.stock;
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

test("build, publish and order from a campaign landing page", async ({ page, browser }) => {
  const { product, variant } = await stockedProduct();
  const slug = `e2e-campaign-${RUN}`;
  await login(page);

  await page.goto("/admin/marketing/landing-pages");
  await page.getByTestId("lp-new").click();
  await page.getByLabel("Name").fill(`E2E campaign ${RUN}`);
  await page.getByLabel("Address").fill(slug);
  await page.getByPlaceholder("Search products by name…").fill(product.name);
  await page.getByRole("button", { name: new RegExp(product.name) }).first().click();
  await page.getByText("Single product", { exact: true }).click();
  await page.getByTestId("lp-create").click();
  await expect(page).toHaveURL(/\/admin\/marketing\/landing-pages\/[a-z0-9]+$/);

  // A draft is not public.
  const shopper = await browser.newPage();
  expect((await shopper.goto(`/lp/${slug}`))!.status()).toBe(404);

  // Edit the order form's title; it autosaves, then goes live with Publish.
  await page.getByRole("button", { name: "Order form", exact: true }).click();
  const title = `অর্ডার করুন ${RUN}`;
  await page.getByLabel("Title").first().fill(title);
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("lp-publish").click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  const before = variant.stock;
  await shopper.goto(`/lp/${slug}`);
  await expect(shopper.getByTestId("campaign-landing")).toBeVisible();
  await expect(shopper.getByRole("heading", { name: title })).toBeVisible();
  if (new Set(product.variants.map((v) => v.size)).size > 1) await shopper.locator("#order").getByRole("button", { name: variant.size, exact: true }).first().click();
  if (new Set(product.variants.map((v) => v.color)).size > 1) await shopper.locator("#order").getByRole("button", { name: variant.color, exact: true }).first().click();
  await shopper.getByLabel("আপনার নাম", { exact: true }).fill("Campaign Tester");
  await shopper.getByLabel("মোবাইল নম্বর", { exact: true }).fill("01712345681");
  await shopper.getByLabel("জেলা", { exact: true }).fill("Dhaka");
  await shopper.getByRole("option", { name: "Dhaka", exact: true }).first().click();
  await shopper.getByLabel("থানা / এলাকা", { exact: true }).fill("Dhanmondi");
  await shopper.getByRole("option", { name: /Dhanmondi/ }).first().click();
  await shopper.getByLabel("পূর্ণ ঠিকানা", { exact: true }).fill("House 1, Road 2 (automated test order)");
  await expect(shopper.getByTestId("landing-total")).toHaveText(/\d/);
  await shopper.getByTestId("landing-submit").click();
  await expect(shopper).toHaveURL(/\/order-confirmation\/.+/, { timeout: 30_000 });
  if (product.trackInventory) expect(await stockOf(product.slug, variant.id)).toBe(before - 1);

  // Unpublish takes it down again.
  await page.getByRole("button", { name: "Unpublish" }).click();
  await page.getByRole("button", { name: "Unpublish", exact: true }).last().click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  expect((await shopper.goto(`/lp/${slug}`))!.status()).toBe(404);
});
