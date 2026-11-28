import { test, expect, type Page } from "@playwright/test";

// Door-swap exchange + customer-reported problems (docs/superpowers/plans/2026-11-28-door-swap-exchange.md): staff record
// what the customer said about a delivered item, then send a replacement; the parcel is protected with the full price.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";

async function call<T = unknown>(page: Page, path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ url, method, body }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { url: `${api}${path}`, method, body },
  ) as Promise<{ status: number; body: T }>;
}

async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

interface StorefrontProduct {
  slug: string;
  trackInventory: boolean;
  variants: Array<{ id: string; stock: number; isActive?: boolean }>;
}

const made: string[] = [];
test.afterAll(async ({ browser }) => {
  if (!made.length) return;
  const page = await browser.newPage();
  await adminLogin(page);
  for (const id of made) {
    await call(page, `/api/orders/${id}`, "DELETE");
    await call(page, `/api/orders/${id}/permanent`, "DELETE");
  }
  await page.close();
});

test("a reported tear, then a free replacement protected with the full price", async ({ page }) => {
  await adminLogin(page);
  const products = (await call<{ items: StorefrontProduct[] }>(page, "/api/products/storefront?pageSize=60")).body.items;
  // Any product with two sizes; their stock is topped up here so the run never depends on what earlier suites left.
  const product = products.map((p) => ({ ...p, variants: p.variants.filter((v) => v.isActive !== false) })).find((p) => p.variants.length >= 2);
  test.skip(!product, "needs a product with two sizes");
  if (product!.trackInventory) {
    for (const v of product!.variants.slice(0, 2)) {
      const r = await call(page, `/api/inventory/variants/${v.id}/adjust`, "POST", { delta: 3, reason: "RESTOCK", note: "Playwright door swap" });
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
  }
  const placed = await call<{ order: { id: string; orderNumber: string } }>(page, "/api/orders", "POST", {
    items: [{ variantId: product!.variants[0]!.id, quantity: 1 }],
    customerName: "Swap Tester",
    customerPhone: "01712345684",
    shippingDivision: "Dhaka",
    shippingDistrict: "Dhaka",
    shippingArea: "Uttara",
    shippingAddressLine: "House 1, Road 2 (Playwright swap)",
    paymentMethod: "COD",
  });
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  const orderId = placed.body.order.id;
  made.push(orderId);
  for (const status of ["CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"]) {
    const r = await call(page, `/api/orders/${orderId}/status`, "PATCH", { status });
    expect(r.status, `${status}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  }

  await page.goto(`/admin/orders/${orderId}`);
  const section = page.getByTestId("order-exchanges");
  await expect(section).toContainText("Nothing reported");

  await section.getByTestId("report-problem").click();
  const report = page.getByRole("dialog", { name: "Report a problem" });
  await report.getByTestId("issue-kind-TORN").click();
  await expect(report.getByTestId("save-problem")).toBeDisabled();
  await report.getByLabel("What the customer said").fill("Left sleeve torn, photo on WhatsApp");
  await report.getByTestId("save-problem").click();
  await expect(section.getByTestId("reported-problems")).toContainText("Left sleeve torn, photo on WhatsApp");
  await expect(section.getByTestId("reported-problems")).toContainText("Open");

  await section.getByRole("button", { name: "Send a replacement" }).click();
  const dialog = page.getByRole("dialog", { name: "Exchange" });
  await expect(dialog).toContainText("For the reported problem: Torn");
  await dialog.getByTestId("exchange-variant").getByRole("button").first().click();
  await expect(dialog.getByTestId("exchange-summary")).toContainText("Customer pays nothing when the old item is handed over");
  await expect(dialog.getByTestId("exchange-summary")).toContainText("if they keep both");
  await dialog.getByTestId("create-exchange").click();
  await expect(dialog).toHaveCount(0);

  const list = section.getByTestId("exchange-list");
  await expect(list).toContainText("Waiting for swap");
  await expect(list).toContainText("free with the old item");
  const link = list.getByTestId("exchange-order-link");
  await expect(link).toContainText("Replacement order");
  made.push((await call<{ exchanges: Array<{ exchangeOrder: { id: string } }> }>(page, `/api/orders/${orderId}/exchanges`)).body.exchanges[0]!.exchangeOrder.id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll").toBe(true);
});
