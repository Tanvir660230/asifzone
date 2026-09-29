import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";

// Storefront: stock is shown as a state, never a quantity; Add to Cart / Buy Now without a finished size/colour choice
// opens a "choose your options" popup (PDP buttons, mobile sticky bar, product-card quick add, quick view).

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const RUN = String(Date.now()).slice(-8);
const NAME = `Picker Panjabi ${RUN}`;

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

let api: APIRequestContext;
let csrf = "";
let productId = "";
let slug = "";
let name = "";

async function adminApi() {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const res = await ctx.post("/api/auth/login", { data: { email: adminEmail, password: adminPassword } });
  expect(res.ok(), await res.text()).toBeTruthy();
  csrf = (await ctx.storageState()).cookies.find((c) => c.name === "csrf_token")?.value ?? "";
  return ctx;
}

// 1x1 PNG the server's image pipeline accepts (publishing requires at least one image).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test.beforeAll(async ({}, testInfo) => {
  api = await adminApi();
  const tag = `${RUN}-${testInfo.project.name}`; // each project (desktop / mobile) gets its own product
  const categories = (await (await api.get("/api/categories")).json()) as { categories?: Array<{ id: string }> } | Array<{ id: string }>;
  const list = Array.isArray(categories) ? categories : (categories.categories ?? []);
  const created = await api.post("/api/products", {
    headers: { "X-CSRF-Token": csrf },
    data: {
      name: `${NAME} ${testInfo.project.name}`,
      categoryId: list[0]!.id,
      basePrice: 1000,
      lowStockThreshold: 5,
      variants: [
        { sku: `PK-${tag}-M-BLK`, size: "M", color: "Black", colorHex: "#111111", stock: 40 },
        { sku: `PK-${tag}-L-BLK`, size: "L", color: "Black", colorHex: "#111111", stock: 40 },
        // White has no colour code on file: it must show as a named pill, not an anonymous grey dot.
        { sku: `PK-${tag}-M-WHT`, size: "M", color: "White", stock: 2 },
        { sku: `PK-${tag}-L-WHT`, size: "L", color: "White", stock: 0 },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = await created.json();
  productId = body.product.id;
  slug = body.product.slug;
  name = body.product.name;
  const uploaded = await api.post(`/api/products/${productId}/images`, {
    headers: { "X-CSRF-Token": csrf },
    multipart: { images: { name: "picker.png", mimeType: "image/png", buffer: PNG } },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const published = await api.patch(`/api/products/${productId}`, { headers: { "X-CSRF-Token": csrf }, data: { status: "PUBLISHED" } });
  expect(published.ok(), await published.text()).toBeTruthy();
});

test.afterAll(async () => {
  if (productId) await api.delete(`/api/products/${productId}`, { headers: { "X-CSRF-Token": csrf } });
  await api.dispose();
});

const picker = (page: Page) => page.getByTestId("variant-picker");
const QUANTITY_TEXT = /\b\d+\s*(in stock|left|available|units?)\b/i;

async function openPdp(page: Page) {
  await page.goto(`/product/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: name })).toBeVisible();
}

test("stock is shown as a state — never a quantity", async ({ page }) => {
  await openPdp(page);
  const selector = page.locator("main");
  await selector.getByRole("group", { name: "Size" }).first().getByRole("button", { name: "M", exact: true }).click();
  await selector.getByRole("group", { name: "Color" }).first().getByRole("button", { name: "Black", exact: true }).click();
  await expect(page.getByTestId("variant-stock-status")).toContainText("In stock");
  await selector.getByRole("group", { name: "Color" }).first().getByRole("button", { name: "White", exact: true }).click();
  await expect(page.getByTestId("variant-stock-status")).toContainText("Only a few left!"); // 2 units — but never "2"
  await expect(page.locator("body")).not.toContainText(QUANTITY_TEXT);
});

test("Add to Cart with nothing chosen opens the options popup, and the choice is added", async ({ page }) => {
  await openPdp(page);
  await page.locator("main").getByRole("button", { name: "Add to Cart", exact: true }).first().click();
  const dialog = picker(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Choose your options" })).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Add to Cart", exact: true });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByTestId("variant-picker-status")).toContainText(/select a size and color/i);

  await dialog.getByRole("button", { name: "L", exact: true }).click();
  // L / White is sold out: its swatch is disabled in this size.
  await expect(dialog.getByRole("button", { name: /White — out of stock in this size/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Black", exact: true }).click();
  await expect(dialog.getByTestId("variant-picker-status")).toHaveText("In stock");
  await expect(dialog).not.toContainText(QUANTITY_TEXT);
  await confirm.click();

  await expect(dialog).toHaveCount(0);
  const cart = page.getByRole("dialog", { name: "Your cart" });
  await expect(cart).toBeVisible();
  await expect(cart).toContainText(name);
  await expect(cart).toContainText("L");
  // The popup's choice became the page's choice.
  await page.keyboard.press("Escape");
  await expect(page.locator("main").getByRole("group", { name: "Size" }).first().getByRole("button", { name: "L", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Buy Now with nothing chosen opens the popup and goes to checkout with the choice", async ({ page }) => {
  await openPdp(page);
  await page.locator("main").getByRole("button", { name: "Buy Now", exact: true }).first().click();
  const dialog = picker(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "M", exact: true }).click();
  await dialog.getByRole("button", { name: "Black", exact: true }).click();
  await dialog.getByRole("button", { name: "Buy Now", exact: true }).click();
  await expect(page).toHaveURL(/\/checkout/);
  // Buy Now is the one-item express checkout; the summary (with the item) is collapsed on phones, so check presence.
  await expect(page.getByText("Buying 1 item")).toBeVisible();
  await expect(page.getByText(name).first()).toBeAttached();
});

test("a colour without a colour code is a named pill; one with a code is a swatch", async ({ page }) => {
  await openPdp(page);
  const colors = page.locator("main").getByRole("group", { name: "Color" }).first();
  await expect(colors.getByRole("button", { name: "White", exact: true })).toHaveText("White");
  await expect(colors.getByRole("button", { name: "Black", exact: true })).toHaveText("");
});

test("a bigger quantity picked on one variant never carries over to a lower-stock one", async ({ page }) => {
  await openPdp(page);
  const main = page.locator("main");
  await main.getByRole("group", { name: "Size" }).first().getByRole("button", { name: "M", exact: true }).click();
  await main.getByRole("group", { name: "Color" }).first().getByRole("button", { name: "Black", exact: true }).click();
  for (let i = 0; i < 4; i++) await main.getByRole("button", { name: "Increase quantity" }).first().click();
  await main.getByRole("group", { name: "Color" }).first().getByRole("button", { name: "White", exact: true }).click(); // only 2 in stock
  await main.getByRole("button", { name: "Buy Now", exact: true }).first().click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText(`${name} × 2`)).toBeAttached(); // not × 5
});

test("Escape or ✕ closes the popup without adding anything", async ({ page }) => {
  await openPdp(page);
  await page.locator("main").getByRole("button", { name: "Add to Cart", exact: true }).first().click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "Add to Cart", exact: true }).first().click();
  await picker(page).getByRole("button", { name: "Close" }).click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Your cart" })).toHaveCount(0);
});

test("mobile sticky bar: Add to Cart with nothing chosen opens the same popup", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the sticky bar is mobile-only");
  await openPdp(page);
  await page.mouse.wheel(0, 2500);
  const sticky = page.locator("div.fixed.bottom-16");
  await expect(sticky.getByRole("button", { name: "Add to Cart" })).toBeVisible();
  await sticky.getByRole("button", { name: "Add to Cart" }).click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).getByRole("button", { name: "Add to Cart", exact: true })).toBeDisabled();
});

test("product card quick add asks for the options when there is a real choice", async ({ page, isMobile }) => {
  await page.goto(`/search?q=${encodeURIComponent(name)}`);
  const card = page.locator("div.group").filter({ has: page.getByRole("link", { name: name }) }).first();
  await expect(card).toBeVisible();
  if (!isMobile) await card.hover();
  await card.getByRole("button", { name: "Quick add to cart" }).click();
  const dialog = picker(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "M", exact: true }).click();
  await dialog.getByRole("button", { name: "Black", exact: true }).click();
  await dialog.getByRole("button", { name: "Add to Cart", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your cart" })).toContainText(name);
  await expect(page).toHaveURL(/\/search/); // tapping inside the popup never navigated the card
});

test("quick view: the popup opens above it and Escape closes only the popup", async ({ page, isMobile }) => {
  test.skip(isMobile, "quick view is desktop-only");
  await page.goto(`/search?q=${encodeURIComponent(name)}`);
  const card = page.locator("div.group").filter({ has: page.getByRole("link", { name: name }) }).first();
  await card.hover();
  await card.getByRole("button", { name: "Quick view" }).click();
  const quickView = page.getByRole("dialog").filter({ hasText: name }).first();
  await expect(quickView).toBeVisible();
  await quickView.getByRole("button", { name: "Add to Cart", exact: true }).click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(quickView.getByRole("button", { name: "Buy Now", exact: true })).toBeVisible(); // quick view still open
});
