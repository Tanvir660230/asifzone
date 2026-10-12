import { test, expect, type Page } from "@playwright/test";

/** A product's ad landing page (/lp/[slug]): one page, no shop navigation, a Cash on Delivery order straight from it. */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

interface ApiVariant { id: string; size: string; color: string; stock: number }
interface ApiProduct { id: string; name: string; slug: string; trackInventory: boolean; variants: ApiVariant[] }

async function stockedProduct(): Promise<{ product: ApiProduct; variant: ApiVariant }> {
  const res = await fetch(`${API}/api/products/storefront?pageSize=50`);
  const items = ((await res.json()) as { items: ApiProduct[] }).items;
  const product = items.find((p) => p.variants.some((v) => v.stock > 2)) ?? items[0]!;
  return { product, variant: product.variants.find((v) => v.stock > 2) ?? product.variants[0]! };
}

async function stockOf(slug: string, variantId: string) {
  const res = await fetch(`${API}/api/products/slug/${slug}`);
  return ((await res.json()) as { product: ApiProduct }).product.variants.find((v) => v.id === variantId)!.stock;
}

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test.describe("product landing page", () => {
  test("is one focused page: product, promises, order form — no shop navigation", async ({ page }) => {
    const { product } = await stockedProduct();
    await page.goto(`/lp/${product.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
    await expect(page.getByTestId("landing-order-form")).toBeVisible();
    await expect(page.getByText("ক্যাশ অন ডেলিভারি").first()).toBeVisible();
    // Nothing to wander off into: no bag, no search, no menu.
    await expect(page.locator('a[href="/cart"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /open menu|search/i })).toHaveCount(0);
    // Ads page, not a search result: the product page is the canonical one.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("an empty form says what is missing, in Bangla", async ({ page }) => {
    const { product, variant } = await stockedProduct();
    await page.goto(`/lp/${product.slug}`);
    if (new Set(product.variants.map((v) => v.size)).size > 1) await page.getByRole("button", { name: variant.size, exact: true }).first().click();
    if (new Set(product.variants.map((v) => v.color)).size > 1) await page.getByRole("button", { name: variant.color, exact: true }).first().click();
    await page.getByTestId("landing-submit").click();
    await expect(page.getByText("আপনার নাম লিখুন")).toBeVisible();
    await expect(page.getByText(/সঠিক মোবাইল নম্বর দিন/)).toBeVisible();
    await expect(page.getByText("জেলা বেছে নিন")).toBeVisible();
  });

  test("a shopper orders Cash on Delivery from the page: total with delivery, confirmation, stock drops", async ({ page }) => {
    const errors = trackPageErrors(page);
    const { product, variant } = await stockedProduct();
    const before = variant.stock;

    await page.goto(`/lp/${product.slug}`);
    if (new Set(product.variants.map((v) => v.size)).size > 1) await page.getByRole("button", { name: variant.size, exact: true }).first().click();
    if (new Set(product.variants.map((v) => v.color)).size > 1) await page.getByRole("button", { name: variant.color, exact: true }).first().click();

    await page.getByLabel("আপনার নাম", { exact: true }).fill("Landing Tester");
    await page.getByLabel("মোবাইল নম্বর", { exact: true }).fill("01712345680");
    await page.getByLabel("জেলা", { exact: true }).fill("Dhaka");
    await page.getByRole("option", { name: "Dhaka", exact: true }).first().click();
    await page.getByLabel("এলাকা / থানা", { exact: true }).fill("Dhanmondi");
    await page.getByRole("option", { name: /Dhanmondi/ }).first().click();
    await page.getByLabel("বাসা / রোড / এলাকার বিস্তারিত").fill("House 1, Road 2 (automated test order)");
    // The delivery charge and total come from the server quote once the district is known.
    await expect(page.getByTestId("landing-total")).toHaveText(/\d/);

    await page.getByTestId("landing-submit").click();
    await expect(page).toHaveURL(/\/order-confirmation\/.+/, { timeout: 30_000 });
    await expect(page.getByText(product.name).first()).toBeVisible();

    if (product.trackInventory) expect(await stockOf(product.slug, variant.id)).toBe(before - 1);
    expect(errors).toEqual([]);
  });

  test("an unknown product is a 404", async ({ page }) => {
    const res = await page.goto("/lp/this-product-does-not-exist");
    expect(res?.status()).toBe(404);
  });
});
