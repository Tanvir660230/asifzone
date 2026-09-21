import { test, expect, type Page } from "@playwright/test";

/** Regression guard for the product-type / catalog work: products that existed before it must still render,
 * be purchasable, and decrement stock. Runs against whatever catalog the dev database holds. */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

interface ApiVariant { id: string; size: string; color: string; stock: number; sku: string }
interface ApiProduct { id: string; name: string; slug: string; variants: ApiVariant[] }

async function listProducts(): Promise<ApiProduct[]> {
  const res = await fetch(`${API}/api/products/storefront?pageSize=50`);
  const body = (await res.json()) as { items: ApiProduct[] };
  return body.items;
}

async function getProduct(slug: string): Promise<ApiProduct & { resolved?: { type: { key: string } | null } }> {
  const res = await fetch(`${API}/api/products/slug/${slug}`);
  return ((await res.json()) as { product: ApiProduct }).product;
}

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test.describe("existing products keep working", () => {
  test("every product page renders its name, price and add-to-cart without errors", async ({ page }) => {
    const errors = trackPageErrors(page);
    const products = await listProducts();
    expect(products.length).toBeGreaterThan(0);

    for (const p of products) {
      await page.goto(`/product/${p.slug}`);
      await expect(page.getByRole("heading", { level: 1, name: p.name }), `product page for ${p.name}`).toBeVisible();
      await expect(page.getByRole("button", { name: "Add to Cart" }).first()).toBeVisible();
      // No unresolved-placeholder leakage from the type/variant rework.
      const text = await page.locator("main").innerText();
      expect(text, `${p.name} shows a dangling variant label`).not.toMatch(/\(\s*\/?\s*\)|undefined|\[object/);
    }
    expect(errors).toEqual([]);
  });

  test("every product resolves a product type on the API (typeId back-filled or resolved by legacy key)", async () => {
    for (const p of await listProducts()) {
      const detail = await getProduct(p.slug);
      expect(detail.resolved?.type?.key, `${p.name} has no resolved type`).toBeTruthy();
    }
  });

  test("a shopper can buy an existing product: pick options, add to cart, check out (COD), stock drops", async ({ page }) => {
    const errors = trackPageErrors(page);

    // Prefer a multi-variant product with stock so both pickers are exercised.
    const candidates = (await listProducts()).filter((p) => p.variants.some((v) => v.stock > 1));
    const product = candidates.find((p) => new Set(p.variants.map((v) => v.color)).size > 1) ?? candidates[0]!;
    const variant = product.variants.find((v) => v.stock > 1)!;
    const before = variant.stock;

    await page.goto(`/product/${product.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();

    const hasSizePicker = new Set(product.variants.map((v) => v.size)).size > 1 || variant.size !== "Standard";
    if (hasSizePicker && variant.size !== "Standard") await page.getByRole("button", { name: variant.size, exact: true }).first().click();
    if (variant.color) await page.getByRole("button", { name: variant.color, exact: true }).first().click();

    await page.getByRole("button", { name: "Add to Cart" }).first().click();
    await expect(page.getByText(/added to cart/i).first()).toBeVisible();

    await page.goto("/checkout");
    await page.getByLabel("Full name").fill("E2E Shopper");
    await page.getByLabel("Phone").fill("01712345679");
    await page.getByLabel("District").fill("Dhaka");
    await page.getByRole("option", { name: "Dhaka", exact: true }).first().click();
    await page.getByLabel("Area / Thana").fill("Dhanmondi");
    await page.getByRole("option", { name: /Dhanmondi/ }).first().click();
    await page.getByLabel("House / Road / Details").fill("House 1, Road 2 (automated test order)");
    await page.getByLabel("Cash on Delivery").check();
    await page.getByRole("button", { name: /^Place Order/ }).click();

    await expect(page).toHaveURL(/\/order-confirmation\/.+/, { timeout: 30_000 });
    await expect(page.getByText(product.name).first()).toBeVisible();

    const after = (await getProduct(product.slug)).variants.find((v) => v.id === variant.id)!.stock;
    expect(after).toBe(before - 1);
    expect(errors).toEqual([]);
  });
});
