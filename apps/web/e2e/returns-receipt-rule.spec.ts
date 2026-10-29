import { test, expect, type Browser, type Page } from "@playwright/test";

// Blueprint P0.4 (owner decisions Q5 = A, Q13 = C, Q13b = B; docs/RETURNS_RECEIPT_RULE.md): with the store's returns rule
// on, an agreed return never restocks — the goods wait ("Waiting to come back") and go into stock only when received. The
// rule is turned on for this spec and off again after it, so no other spec sees it.

const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const NAV = { timeout: 20_000 };
const RUN = Date.now().toString(36);

async function call<T = unknown>(page: Page, path: string, method = "GET", body?: unknown, idempotencyKey?: string): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ url, method, body, idempotencyKey }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { url: `${API}${path}`, method, body, idempotencyKey },
  ) as Promise<{ status: number; body: T }>;
}

async function login(browser: Browser) {
  const page = await browser.newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
  return page;
}

const checkoutBody = (items: Array<{ variantId: string; quantity: number }>, phone: string) => ({
  items,
  customerName: "Returns Rule Tester",
  customerPhone: phone,
  shippingDivision: "Dhaka",
  shippingDistrict: "Dhaka",
  shippingArea: "Uttara",
  shippingAddressLine: "House 1, Road 2 (Playwright)",
  paymentMethod: "COD",
});

interface StorefrontProduct { id: string; trackInventory: boolean; variants: Array<{ id: string; stock: number; isActive?: boolean }> }
async function stockedVariants(page: Page) {
  const res = await call<{ items: StorefrontProduct[] }>(page, "/api/products/storefront?pageSize=60");
  return res.body.items.map((p) => ({ ...p, variants: p.variants.filter((v) => v.isActive !== false && p.trackInventory && v.stock >= 6) })).filter((p) => p.variants.length > 0);
}

let owner: Page;
const made: string[] = [];

test.beforeAll(async ({ browser }) => {
  owner = await login(browser);
  // The rule needs the books started (an opening date and posted opening balances), as the treasury spec sets them up.
  const business = await call<{ business: { openingDate: string | null; timezone: string }; openingBalancesStatus: string | null }>(owner, "/api/v1/finance/business");
  expect(business.status).toBe(200);
  if (!business.body.business.openingDate) expect((await call(owner, "/api/v1/finance/business", "PATCH", { openingDate: "2026-07-01" })).status).toBe(200);
  if (business.body.openingBalancesStatus !== "POSTED") {
    const accounts = (await call<{ accounts: Array<{ id: string; code: string }> }>(owner, "/api/v1/finance/accounts")).body.accounts;
    const petty = await call<{ id: string }>(owner, "/api/v1/finance/financial-accounts", "POST", { kind: "CASH", name: `Petty cash ${RUN}` });
    await call(owner, "/api/v1/finance/opening-balances/lines", "PUT", { lines: [{ category: "CASH", financialAccountId: petty.body.id, side: "DEBIT", amount: 1000 }, { category: "CAPITAL", accountId: accounts.find((a) => a.code === "3100")!.id, side: "CREDIT", amount: 1000 }] });
    expect((await call(owner, "/api/v1/finance/opening-balances/post", "POST")).status).toBe(200);
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.body.business.timezone }).format(new Date());
  const on = await call(owner, "/api/v1/finance/business", "PATCH", { returnsReceiptRuleEffectiveDate: today, reason: "e2e: returns rule" });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
});

test.afterAll(async () => {
  await call(owner, "/api/v1/finance/business", "PATCH", { returnsReceiptRuleEffectiveDate: null, reason: "e2e: returns rule off" });
  for (const id of made) {
    await call(owner, `/api/orders/${id}`, "DELETE");
    await call(owner, `/api/orders/${id}/permanent`, "DELETE");
  }
  await owner.close();
});

test("an item return still with the customer waits — nothing restocked — and goes into stock only when received", async ({ }, info) => {
  const products = await stockedVariants(owner);
  test.skip(!products.length, "needs a stocked, tracked product");
  const variantId = products[0]!.variants[0]!.id;
  const phone = `0171${String(Date.now()).slice(-7)}`;
  const created = await call<{ order: { id: string } }>(owner, "/api/orders/admin", "POST", checkoutBody([{ variantId, quantity: 2 }], phone), `pw-rr-${RUN}-${info.project.name}`);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const orderId = created.body.order.id;
  made.push(orderId);
  expect((await call(owner, `/api/orders/${orderId}/status`, "PATCH", { status: "DELIVERED" })).status).toBe(200);

  await owner.goto(`/admin/orders/${orderId}`);
  await owner.getByTestId("open-item-return").click();
  const dialog = owner.getByTestId("item-return-dialog");
  await dialog.getByTestId("return-goods-in-hand").getByText("Still with the customer").click();
  await dialog.getByRole("button", { name: /returning: one more/ }).first().click();
  await expect(dialog.getByTestId("return-line").first()).toContainText("to come back 1");
  await owner.getByLabel("Reason").fill("Wrong size (Playwright)");
  await owner.getByTestId("record-return").click();
  await owner.getByTestId("confirm-record-return").click();

  const waiting = owner.getByTestId("awaiting-return");
  await expect(waiting).toBeVisible(NAV);
  await expect(waiting.getByTestId("awaiting-line")).toContainText("1 to come back");
  const order = await call<{ order: { items: Array<{ awaitingReturnQuantity: number; restockedQuantity: number }> } }>(owner, `/api/orders/${orderId}`);
  expect(order.body.order.items[0]).toMatchObject({ awaitingReturnQuantity: 1, restockedQuantity: 0 });
  // the returns list shows it, with the rule on
  await owner.goto("/admin/return-requests?tab=parcels");
  await expect(owner.getByTestId("returns-rule")).toContainText("on since", NAV);
  await expect(owner.getByTestId("awaiting-returns")).toBeVisible();

  await owner.goto(`/admin/orders/${orderId}`);
  await owner.getByTestId("receive-awaiting").click();
  await expect(owner.getByTestId("awaiting-return")).toBeHidden(NAV);
  const after = await call<{ order: { items: Array<{ awaitingReturnQuantity: number; restockedQuantity: number }> } }>(owner, `/api/orders/${orderId}`);
  expect(after.body.order.items[0]).toMatchObject({ awaitingReturnQuantity: 0, restockedQuantity: 1 });
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("an exchange ships the replacement first and the original waits to come back (Q13 = C)", async ({ browser }, info) => {
  const products = (await stockedVariants(owner)).filter((p) => p.variants.length >= 2);
  test.skip(!products.length, "needs a product with two stocked variants");
  const original = products[0]!.variants[0]!;
  const replacement = products[0]!.variants[1]!;
  // the customer orders, as a signed-in customer (an exchange is the customer's request)
  const customer = await browser.newPage();
  const email = `pw-rr-${RUN}-${info.project.name}@example.com`;
  await customer.goto("/account/register");
  await customer.getByLabel("Name").fill("Returns Rule Tester");
  await customer.getByLabel("Email", { exact: true }).fill(email);
  await customer.getByLabel("Password", { exact: true }).fill("Returns-Rule-2026!");
  await customer.getByRole("button", { name: /create account/i }).click();
  await expect(customer).toHaveURL(/\/account$/, NAV);
  const placed = await call<{ order: { id: string; items?: Array<{ id: string }> } }>(customer, "/api/orders", "POST", checkoutBody([{ variantId: original.id, quantity: 1 }], `0181${String(Date.now()).slice(-7)}`), `pw-rr-x-${RUN}-${info.project.name}`);
  expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  const orderId = placed.body.order.id;
  made.push(orderId);
  for (const s of ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"]) expect((await call(owner, `/api/orders/${orderId}/status`, "PATCH", { status: s })).status).toBe(200);
  const { items, orderNumber } = (await call<{ order: { orderNumber: string; items: Array<{ id: string }> } }>(owner, `/api/orders/${orderId}`)).body.order;
  const req = await call<{ returnRequest?: { id: string }; id?: string }>(customer, "/api/return-requests", "POST", { orderId, type: "EXCHANGE", reason: "Size", orderItemId: items[0]!.id, requestedVariantId: replacement.id });
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  await customer.close();

  await owner.goto("/admin/return-requests?status=PENDING");
  // a table row on desktop, a card (article) on a phone
  const row = owner.getByRole("row").or(owner.getByRole("article")).filter({ hasText: orderNumber, visible: true }).first();
  await row.getByRole("button", { name: "Approve" }).click();
  const dlg = owner.getByRole("dialog");
  await dlg.getByRole("button", { name: "Approve" }).click();
  await expect(dlg).toBeHidden(NAV);

  const after = await call<{ order: { items: Array<{ awaitingReturnQuantity: number; restockedQuantity: number }> } }>(owner, `/api/orders/${orderId}`);
  expect(after.body.order.items[0]).toMatchObject({ awaitingReturnQuantity: 1, restockedQuantity: 0 });
  await owner.goto(`/admin/orders/${orderId}`);
  await expect(owner.getByTestId("awaiting-return")).toBeVisible(NAV);
});
