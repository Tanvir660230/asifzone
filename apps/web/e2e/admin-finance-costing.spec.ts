import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page } from "@playwright/test";

// Financial Core Phase 4B browser QA (docs/FINANCE_PHASE_4.md §9) — with inventory costing NOT active (it is activated by
// the Phase 4C valuation cutover): commerce and inventory behave exactly as before, nothing is valued, order lines are
// labelled with where their cost came from, and the new inventory checks say they don't apply yet. Changes data: run only
// against a disposable QA database. QA_P4B_FIXTURE: the JSON written by the QA seed (a tracked product to adjust, an
// untracked product, and one order on each).

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const NAV = { timeout: 30_000 };
type Fixture = {
  adjustable: { productId: string; productName: string; variantId: string; sku: string };
  untracked: { productId: string; productName: string; variantId: string; sku: string };
  untrackedOrder: string;
  trackedOrder: string;
};
const fx: Fixture = process.env.QA_P4B_FIXTURE ? JSON.parse(readFileSync(process.env.QA_P4B_FIXTURE, "utf8")) : (null as never);

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "desktop Chromium only");
test.skip(!process.env.QA_P4B_FIXTURE, "needs QA_P4B_FIXTURE (a disposable QA database seeded for it)");

async function shot(page: Page, name: string) {
  if (process.env.QA_SHOTS) await page.screenshot({ path: `${process.env.QA_SHOTS}/${name}.png`, fullPage: true });
}
async function login(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/admin\/login/, NAV);
  return page;
}
async function api(page: Page, method: string, path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "csrf_token")?.value;
  const res = await page.request.fetch(`${API}${path}`, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
type Check = { checkKey: string; status: string; details: Record<string, unknown> };
async function runChecks(page: Page, checks: string[]) {
  const r = await api(page, "POST", "/api/v1/finance/reconciliation/run", { checks });
  expect(r.status).toBe(200);
  return Object.fromEntries((r.body.results as Check[]).map((c) => [c.checkKey, c]));
}

let owner: Page;
test.beforeAll(async ({ browser }) => {
  owner = await login(browser, OWNER);
});

test("inventory costing is OFF until the 4C cutover — the books say so", async () => {
  const business = (await api(owner, "GET", "/api/v1/finance/business")).body;
  expect(business).toHaveProperty("inventoryCostingActivatedAt", null); // read-only: set only by the 4C cutover
  await owner.goto("/admin/finance/checks");
  await expect(owner.getByRole("heading", { name: "Books health check" })).toBeVisible(NAV);
  for (const key of ["inventory.order_cost_links", "inventory.quantity_vs_valuation", "inventory.valuation_postings"]) await expect(owner.getByTestId(`check-${key}`)).toBeVisible();
  await owner.getByTestId("run-checks").click();
  for (const key of ["inventory.order_cost_links", "inventory.quantity_vs_valuation", "inventory.valuation_postings"]) {
    await expect(owner.getByTestId(`check-${key}`)).toContainText("not applicable", { timeout: 30_000 });
  }
  await shot(owner, "p4b-checks-not-applicable");
  const r = await runChecks(owner, ["inventory.quantity_vs_valuation"]);
  expect(r["inventory.quantity_vs_valuation"]!.details).toMatchObject({ reason: expect.stringMatching(/not active/) });
});

test("order lines are labelled with their cost source — catalog cost, never inventory-valued while costing is off", async () => {
  const r = await runChecks(owner, ["inventory.order_cost_links"]);
  const bySource = (r["inventory.order_cost_links"]!.details as { linesByCostSource: Record<string, number> }).linesByCostSource;
  expect(bySource.CATALOG ?? 0).toBeGreaterThanOrEqual(2); // the seeded tracked and untracked orders (catalog costs 300 / 150)
  expect(bySource.INVENTORY ?? 0).toBe(0);
  expect(bySource.INVENTORY_PROVISIONAL ?? 0).toBe(0);
  // The untracked product still sells exactly as before (its stock is not guarded and goes below zero, recorded as usual).
  const untrackedOrder = (await api(owner, "GET", `/api/orders/${fx.untrackedOrder}`)).body;
  expect(untrackedOrder.items?.[0] ?? untrackedOrder.order?.items?.[0]).toBeTruthy();
});

test("a stock adjustment through the Inventory screen works exactly as before and writes no valuation", async () => {
  const movementsBefore = (await api(owner, "GET", `/api/inventory/movements?variantId=${fx.adjustable.variantId}`)).body;
  const before = movementsBefore.total ?? movementsBefore.items?.length ?? 0;
  await owner.goto("/admin/inventory");
  await owner.getByRole("button", { name: /Adjust stock/ }).first().click();
  const dialog = owner.getByRole("dialog");
  await dialog.locator("#stock-product-search").fill(fx.adjustable.productName);
  await dialog.getByRole("button", { name: new RegExp(fx.adjustable.productName) }).first().click();
  await dialog.locator("#stock-variant-select").selectOption(fx.adjustable.variantId);
  await dialog.locator("#stock-delta").fill("3");
  await dialog.locator("#stock-reason").selectOption("RESTOCK");
  await dialog.locator("#stock-note").fill("QA 4B count");
  await dialog.getByRole("button", { name: "Adjust stock" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await shot(owner, "p4b-inventory-adjusted");
  const after = (await api(owner, "GET", `/api/inventory/movements?variantId=${fx.adjustable.variantId}`)).body;
  expect(after.total ?? after.items?.length).toBe(before + 1);
  const latest = (after.items ?? after.movements ?? after.data)[0];
  expect(latest).toMatchObject({ change: 3, reason: "RESTOCK", note: "QA 4B count" });
  // Quantity and valuation: the quantity check doesn't apply (nothing is valued), and Phase 3 still treats the unvalued
  // receipt exactly as before — an UNVALUED_STOCK_RECEIPT exception after the next sync.
  const r = await runChecks(owner, ["inventory.quantity_vs_valuation", "inventory.valuation_postings"]);
  expect([r["inventory.quantity_vs_valuation"]!.status, r["inventory.valuation_postings"]!.status]).toEqual(["NOT_APPLICABLE", "NOT_APPLICABLE"]);
  expect((await api(owner, "POST", "/api/v1/finance/commerce/sync", {})).status).toBe(200);
  const exceptions = (await api(owner, "GET", "/api/v1/finance/exceptions?kind=UNVALUED_STOCK_RECEIPT&pageSize=200")).body.exceptions as Array<{ title: string; details: { note?: string } }>;
  expect(exceptions.some((e) => e.title.includes(fx.adjustable.sku) && e.details.note === "QA 4B count")).toBe(true);
  // Still off afterwards.
  expect((await api(owner, "GET", "/api/v1/finance/business")).body).toHaveProperty("inventoryCostingActivatedAt", null);
});
