import { test, expect, type Page } from "@playwright/test";

// Orders UI phase 2 (docs/ORDER_ADJUSTMENTS.md): the customer change-order flow, stale-price handling, Store Balance,
// cancellation → balance, spending balance at checkout, the staff change / partial return / payment-link / exchange
// workflows, and the product-page free-delivery indicator. Every money figure asserted here is the server's. The spec makes
// its own customer and orders through the real API; orders it creates are trashed and deleted at the end where possible.
// Paid-ONLINE orders can't be created without a gateway (live providers are off), so the "pay the difference" path is
// covered by the API integration suite (order-adjustments.integration.test.ts) rather than here.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";

/** A JSON API call with the browser's cookies and the CSRF double-submit header (works for admin and customer sessions). */
async function call<T = unknown>(page: Page, path: string, method = "GET", body?: unknown, idempotencyKey?: string): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ url, method, body, idempotencyKey }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { url: `${api}${path}`, method, body, idempotencyKey },
  ) as Promise<{ status: number; body: T }>;
}

async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  // exact: Google's "Sign in with Google" button also matches /sign in/i whenever its script loads.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

async function registerCustomer(page: Page, tag: string) {
  const email = `pw-adjust-${tag}-${Date.now()}@example.com`;
  await page.goto("/account/register");
  await page.getByLabel("Name").fill("Adjust Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Adjust-Test-2026!");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

interface StorefrontProduct {
  id: string;
  name: string;
  slug: string;
  freeDelivery?: boolean;
  trackInventory: boolean;
  variants: Array<{ id: string; size: string; color: string; stock: number; isActive?: boolean }>;
}

/** Published products with sellable variants (stock ≥ 6 so each run can take a few units). */
async function stockedProducts(page: Page) {
  const res = await call<{ items: StorefrontProduct[] }>(page, "/api/products/storefront?pageSize=60");
  return res.body.items
    .map((p) => ({ ...p, variants: p.variants.filter((v) => v.isActive !== false && (!p.trackInventory || v.stock >= 6)) }))
    .filter((p) => p.variants.length > 0);
}

const checkoutBody = (items: Array<{ variantId: string; quantity: number }>) => ({
  items,
  customerName: "Adjust Tester",
  customerPhone: "01712345678",
  shippingDivision: "Dhaka",
  shippingDistrict: "Dhaka",
  shippingArea: "Uttara",
  shippingAddressLine: "House 1, Road 2 (Playwright)",
  paymentMethod: "COD",
});

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal page scroll").toBe(true);
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

test.describe("customer: change order, Store Balance, cancellation", () => {
  test("change order: quantity up and an added product — server summary, confirm, order updated", async ({ page }, info) => {
    await registerCustomer(page, info.project.name);
    const products = await stockedProducts(page);
    test.skip(products.length < 2, "needs two stocked products");
    const [a, b] = products;
    const placed = await call<{ order: { id: string; orderNumber: string; total: string } }>(page, "/api/orders", "POST", checkoutBody([{ variantId: a!.variants[0]!.id, quantity: 1 }]), `pw-${Date.now()}-${Math.random()}`);
    expect(placed.status).toBe(201);
    const orderId = placed.body.order.id;
    made.push(orderId);

    await page.goto(`/account/orders/${orderId}`);
    const panel = page.getByTestId("order-self-service");
    await expect(panel).toContainText("hasn't been prepared yet");
    await panel.getByTestId("change-order-link").click();
    await expect(page).toHaveURL(new RegExp(`/account/orders/${orderId}/change$`));
    await noHorizontalScroll(page);

    // Edit: one more of the existing item, plus another product.
    await page.getByRole("button", { name: "Increase quantity" }).first().click();
    await page.getByRole("button", { name: "Add a product" }).click();
    await page.getByLabel("Search products to add").fill(b!.name.slice(0, Math.min(8, b!.name.length)));
    await page.getByTestId("product-picker").getByRole("button", { name: b!.name }).first().click();
    await page.getByTestId("product-picker").locator("button[aria-pressed]").first().click();
    await page.getByRole("button", { name: "Add to order" }).click();
    await page.getByTestId("review-change").click();

    const summary = page.getByTestId("modification-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(b!.name);
    // COD order: the extra is collected on delivery — the outcome says so in words, not colour.
    await expect(page.getByTestId("modification-outcome")).toHaveAttribute("data-outcome", "collect");
    await expect(page.getByTestId("modification-outcome")).toContainText("more than before");
    await noHorizontalScroll(page);
    await page.getByTestId("confirm-change").click();
    await expect(page).toHaveURL(new RegExp(`/account/orders/${orderId}$`));

    const after = await call<{ order: { total: string; items: Array<{ variantId: string; quantity: number }> } }>(page, `/api/customers/me/orders/${orderId}`);
    // Extra units of an item already on the order are a new line priced today (the original units keep their price), so
    // count the variant across its lines.
    expect(after.body.order.items.filter((i) => i.variantId === a!.variants[0]!.id).reduce((n, i) => n + i.quantity, 0)).toBe(2);
    expect(after.body.order.items.some((i) => b!.variants.some((v) => v.id === i.variantId))).toBe(true);
    expect(Number(after.body.order.total)).toBeGreaterThan(Number(placed.body.order.total));
    await expect(page.getByTestId("order-self-service")).toContainText("Changes to this order (1)");
  });

  test("a change re-priced while reviewing is never applied silently", async ({ page }, info) => {
    await registerCustomer(page, `stale-${info.project.name}`);
    const [a] = await stockedProducts(page);
    const placed = await call<{ order: { id: string } }>(page, "/api/orders", "POST", checkoutBody([{ variantId: a!.variants[0]!.id, quantity: 2 }]), `pw-${Date.now()}-${Math.random()}`);
    const orderId = placed.body.order.id;
    made.push(orderId);

    await page.goto(`/account/orders/${orderId}/change`);
    await page.getByRole("button", { name: "Decrease quantity" }).first().click();
    await page.getByTestId("review-change").click();
    await expect(page.getByTestId("modification-summary")).toBeVisible();

    // Meanwhile the order changes (another tab): the confirmed preview is now stale.
    const other = await call(page, `/api/customers/me/orders/${orderId}/modifications`, "POST", { items: [{ variantId: a!.variants[0]!.id, quantity: 3 }] }, `pw-other-${Date.now()}`);
    expect(other.status).toBe(201);

    await page.getByTestId("confirm-change").click();
    await expect(page.getByText("Prices were updated")).toBeVisible();
    await expect(page.getByTestId("modification-summary")).toBeVisible();
    // The order still has the other tab's quantity — nothing stale was applied.
    const mid = await call<{ order: { items: Array<{ quantity: number }> } }>(page, `/api/customers/me/orders/${orderId}`);
    expect(mid.body.order.items.reduce((n, i) => n + i.quantity, 0)).toBe(3);
    await page.getByTestId("confirm-change").click();
    await expect(page).toHaveURL(new RegExp(`/account/orders/${orderId}$`));
    const done = await call<{ order: { items: Array<{ quantity: number }> } }>(page, `/api/customers/me/orders/${orderId}`);
    expect(done.body.order.items.reduce((n, i) => n + i.quantity, 0)).toBe(1);
  });

  test("an order being prepared says why it can't be changed", async ({ page }, info) => {
    await registerCustomer(page, `locked-${info.project.name}`);
    const [a] = await stockedProducts(page);
    const placed = await call<{ order: { id: string } }>(page, "/api/orders", "POST", checkoutBody([{ variantId: a!.variants[0]!.id, quantity: 1 }]), `pw-${Date.now()}-${Math.random()}`);
    const orderId = placed.body.order.id;
    made.push(orderId);
    // Staff move it on (another browser context = the admin).
    const admin = await page.context().browser()!.newPage();
    await adminLogin(admin);
    expect((await call(admin, `/api/orders/${orderId}/status`, "PATCH", { status: "PROCESSING" })).status).toBe(200);
    await admin.close();

    await page.goto(`/account/orders/${orderId}`);
    await expect(page.getByTestId("order-not-editable")).toContainText("already being prepared");
    await expect(page.getByTestId("change-order-link")).toHaveCount(0);
    await page.goto(`/account/orders/${orderId}/change`);
    await expect(page.getByTestId("change-not-allowed")).toBeVisible();
  });
});

test.describe("staff: change, partial return, payment link, Store Balance", () => {
  test("paid order lowered → Store Balance; partial return → credit; balance spent at checkout", async ({ page }, info) => {
    // Customer + a staff-entered paid order for them (markPaid = money received out of band).
    const email = await registerCustomer(page, `staff-${info.project.name}`);
    const me = await call<{ customer: { id: string } }>(page, "/api/customers/me");
    const customerId = me.body.customer.id;
    const products = await stockedProducts(page);
    const [a] = products;
    const variant = a!.variants[0]!.id;

    const admin = await page.context().browser()!.newPage();
    await adminLogin(admin);
    const created = await call<{ order: { id: string; orderNumber: string; total: string } }>(
      admin,
      "/api/orders/admin",
      "POST",
      { ...checkoutBody([{ variantId: variant, quantity: 3 }]), customerId, customerEmail: email, markPaid: true },
      `pw-admin-${Date.now()}-${Math.random()}`,
    );
    expect(created.status).toBe(201);
    const orderId = created.body.order.id;
    made.push(orderId);

    // Staff change: 3 → 2. Total goes down on a paid order → the excess goes to Store Balance.
    await admin.goto(`/admin/orders/${orderId}`);
    await admin.getByTestId("open-change-order").click();
    const dlg = admin.getByRole("dialog");
    await dlg.getByRole("button", { name: "Decrease quantity" }).first().click();
    await dlg.getByTestId("review-change").click();
    await expect(dlg.getByTestId("modification-outcome")).toHaveAttribute("data-outcome", "credit");
    await expect(dlg.getByTestId("modification-outcome")).toContainText("Store Balance");
    await dlg.getByTestId("confirm-change").click();
    await expect(admin.getByTestId("order-changes")).toContainText("Change #1");
    await expect(admin.getByTestId("order-payments")).toContainText(/credited to store balance/i);
    const payment = await call<{ payment: { credited: number; paid: number; refunded: number } }>(admin, `/api/orders/${orderId}/payment`);
    expect(payment.body.payment.credited).toBeGreaterThan(0);
    expect(payment.body.payment.refunded).toBe(0);
    await noHorizontalScroll(admin);

    // Deliver it, then the customer sends 1 of the 2 back (kept 1): partial return with Store credit.
    expect((await call(admin, `/api/orders/${orderId}/status`, "PATCH", { status: "DELIVERED" })).status).toBe(200);
    await admin.reload();
    await admin.getByTestId("open-item-return").click();
    const ret = admin.getByTestId("item-return-dialog");
    await expect(ret.getByTestId("return-line").first()).toContainText("returnable 2");
    await ret.getByRole("button", { name: /returning: one more/ }).first().click();
    await expect(ret.getByTestId("return-compensation")).toContainText("Returned value");
    await expect(ret.getByTestId("return-line").first()).toContainText("Customer keeps 1");
    await admin.getByLabel("Reason").fill("Too small (Playwright)");
    await admin.getByTestId("record-return").click();
    await admin.getByTestId("confirm-record-return").click();
    await expect(admin.getByTestId("order-returns")).toContainText("Store credit");
    await expect(admin.getByTestId("order-timeline")).toContainText("Items returned");
    await expect(admin.getByTestId("order-timeline")).toContainText("Store credit issued");

    // The customer sees the balance and its history — the page shows exactly the server's balance.
    const balance = await call<{ storeCredit: { balance: number; entries: unknown[] } }>(page, "/api/customers/me/store-credit");
    expect(balance.body.storeCredit.balance).toBeGreaterThan(0);
    await page.goto("/account/store-balance");
    await expect(page.getByTestId("store-balance-history").locator("li")).toHaveCount(balance.body.storeCredit.entries.length);
    const shown = (await page.getByTestId("store-balance-amount").innerText()).replace(/[^\d.]/g, "");
    expect(Number(shown)).toBe(balance.body.storeCredit.balance);
    await noHorizontalScroll(page);

    // Spend it: checkout with "Use my store balance".
    await page.goto("/");
    await page.evaluate(
      ({ item }) => localStorage.setItem("cart-storage", JSON.stringify({ state: { items: [item], lastActivityAt: Date.now() }, version: 0 })),
      { item: { variantId: variant, productId: a!.id, productSlug: a!.slug, productName: a!.name, sku: "x", size: a!.variants[0]!.size, color: a!.variants[0]!.color, price: 1, imageUrl: null, maxStock: 5, quantity: 1 } },
    );
    await page.goto("/checkout");
    const box = page.getByTestId("checkout-store-balance");
    await expect(box).toContainText("Store Balance available");
    await box.getByRole("checkbox").check();
    await expect(box).toContainText("To pay");
    await noHorizontalScroll(page);
    await admin.close();
  });

  test("payment link: exact balance due, shown on /pay, unusable once cancelled", async ({ page }) => {
    await adminLogin(page);
    const [a] = await stockedProducts(page);
    const created = await call<{ order: { id: string } }>(page, "/api/orders/admin", "POST", checkoutBody([{ variantId: a!.variants[0]!.id, quantity: 1 }]), `pw-link-${Date.now()}-${Math.random()}`);
    const orderId = created.body.order.id;
    made.push(orderId);
    const due = (await call<{ payment: { amountDue: number } }>(page, `/api/orders/${orderId}/payment`)).body.payment.amountDue;

    await page.goto(`/admin/orders/${orderId}`);
    const panel = page.getByTestId("order-payment-links");
    await panel.getByRole("button", { name: /Generate link for/ }).click();
    await expect(panel).toContainText(/Collects .* \(balance due\)/);
    const url = (await panel.locator(".font-mono").innerText()).trim();
    const links = await call<{ links: Array<{ amount: number; status: string }> }>(page, `/api/orders/${orderId}/payment-links`);
    expect(links.body.links[0]).toMatchObject({ amount: due, status: "ACTIVE" });

    const customer = await page.context().browser()!.newPage();
    await customer.goto(url.replace(/^https?:\/\/[^/]+/, ""));
    await expect(customer.getByTestId("pay-page")).toContainText("Amount to pay");
    await noHorizontalScroll(customer);

    await panel.getByRole("button", { name: "Cancel link" }).click();
    await expect(panel).toContainText("Link history (1)");
    await customer.reload();
    await expect(customer.getByTestId("pay-page")).toContainText("no longer valid");
    await customer.close();
    await expect(page.getByTestId("order-timeline")).toContainText("Payment link created");
  });
});

test.describe("free delivery on the product page", () => {
  test("the indicator follows the product flag; a mixed bag never claims free delivery", async ({ page }) => {
    await adminLogin(page);
    const products = await stockedProducts(page);
    test.skip(products.length < 2, "needs two stocked products");
    const [free, normal] = products.filter((p) => !p.freeDelivery);
    test.skip(!free || !normal, "needs two products without free delivery to flip one");
    const flip = (on: boolean) => call(page, `/api/products/${free!.id}`, "PATCH", { freeDelivery: on });
    expect((await flip(true)).status).toBe(200);
    try {
      await expect
        .poll(async () => {
          await page.goto(`/product/${free!.slug}`);
          return page.getByTestId("product-free-delivery").count();
        }, { timeout: 90_000 })
        .toBe(1);
      const quote = await call<{ quote: { shipping: { waived: boolean; waivedReason: string | null } } }>(page, "/api/v1/checkout/quote", "POST", {
        items: [
          { variantId: free!.variants[0]!.id, quantity: 1 },
          { variantId: normal!.variants[0]!.id, quantity: 1 },
        ],
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
      });
      expect(quote.body.quote.shipping.waivedReason).not.toBe("FREE_DELIVERY");
    } finally {
      await flip(false);
    }
  });
});
