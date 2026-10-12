import { test, expect, type Browser, type Page } from "@playwright/test";

// Financial Core Phase 4A browser QA (docs/FINANCE_PHASE_4.md §6–§7): suppliers (automatic permanent code, edit, hold
// with a reason) and purchase tax codes (create, permanent rate, deactivate), and what STAFF may do — through the UI, with
// every effect checked through the API. Changes data: run only against a disposable QA database.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: PASSWORD };
const STAFF = { email: process.env.QA_STAFF_EMAIL ?? "staff@example.com", password: PASSWORD };
const NAV = { timeout: 30_000 };
const RUN = Date.now().toString(36).toUpperCase();

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "desktop Chromium only");

async function shot(page: Page, name: string) {
  if (process.env.QA_SHOTS) await page.screenshot({ path: `${process.env.QA_SHOTS}/${name}.png`, fullPage: true });
}
async function login(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/admin\/login/, NAV);
  return page;
}
async function api(page: Page, method: string, path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "csrf_token")?.value;
  const res = await page.request.fetch(`${API}/api/v1${path}`, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
  return { status: res.status(), body: await res.json().catch(() => null) };
}
async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text, visible: true }).or(page.getByRole("alert").filter({ hasText: text, visible: true })).first()).toBeVisible({ timeout: 20_000 });
}

let owner: Page;
test.beforeAll(async ({ browser }) => {
  owner = await login(browser, OWNER);
});

test("purchasing accounts are ready", async () => {
  const s = await api(owner, "GET", "/purchasing/status");
  expect(s.status).toBe(200);
  if (!s.body.readiness.ready) expect((await api(owner, "POST", "/purchasing/setup", {})).status).toBe(200);
  expect((await api(owner, "GET", "/purchasing/status")).body.readiness).toEqual({ ready: true, missing: [] });
});

test("suppliers: create with an automatic permanent code, edit, hold with a reason — audited", async () => {
  await owner.goto("/admin/finance/suppliers");
  await expect(owner.getByRole("heading", { name: "Suppliers" })).toBeVisible(NAV);
  await owner.getByTestId("new-supplier").click();
  const d = owner.getByRole("dialog");
  await d.locator("#sp-legal").fill(`Dhaka Fabrics ${RUN} Ltd`);
  await d.locator("#sp-contact").fill("Rahim");
  await d.locator("#sp-phone").fill("01711000000");
  await d.locator("#sp-terms").fill("30");
  await d.locator("#sp-limit").fill("50000.50");
  await d.getByTestId("save-supplier").click();
  await toast(owner, /Supplier SUP-\d{4} added/);
  const created = (await api(owner, "GET", `/purchasing/suppliers?q=${RUN}`)).body.suppliers[0];
  expect(created).toMatchObject({ legalName: `Dhaka Fabrics ${RUN} Ltd`, paymentTermsDays: 30, creditLimit: 50000.5, status: "ACTIVE" });
  expect(created.code).toMatch(/^SUP-\d{4}$/);

  const row = owner.getByTestId("supplier-row").filter({ hasText: created.code });
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(owner.getByRole("dialog").locator("#sp-code")).toBeDisabled(); // the code is permanent
  await owner.getByRole("dialog").locator("#sp-display").fill(`DF ${RUN}`);
  await owner.getByRole("dialog").getByTestId("save-supplier").click();
  await toast(owner, "Supplier saved");
  await expect(row).toContainText(`DF ${RUN}`);

  await row.getByRole("button", { name: "Hold" }).click();
  await expect(owner.getByTestId("confirm-status")).toBeDisabled(); // a reason is required
  await owner.getByRole("dialog").locator("#st-reason").fill("Quality dispute on last batch");
  await owner.getByTestId("confirm-status").click();
  await toast(owner, /is on hold/);
  await expect(row).toContainText("Quality dispute on last batch");
  await shot(owner, "p4a-suppliers");

  const after = (await api(owner, "GET", `/purchasing/suppliers/${created.id}`)).body;
  expect(after).toMatchObject({ code: created.code, displayName: `DF ${RUN}`, status: "ON_HOLD" });
});

test("tax codes: create, the rate is permanent, deactivate", async () => {
  await owner.goto("/admin/finance/tax-codes");
  await expect(owner.getByRole("heading", { name: "Purchase tax codes" })).toBeVisible(NAV);
  await owner.getByTestId("new-tax-code").click();
  const d = owner.getByRole("dialog");
  await d.locator("#tc-code").fill(`VAT${RUN}`.slice(0, 20));
  await d.locator("#tc-name").fill("VAT 15%");
  await d.locator("#tc-rate").fill("15");
  await d.locator("#tc-rec").fill("100");
  await d.getByTestId("save-tax-code").click();
  await toast(owner, /Tax code .* added/);
  const code = `VAT${RUN}`.slice(0, 20);
  const row = owner.getByTestId("tax-code-row").filter({ hasText: code });
  await expect(row).toContainText("15%");
  const tc = (await api(owner, "GET", "/purchasing/tax-codes")).body.taxCodes.find((t: { code: string }) => t.code === code);
  // The API ignores a rate change (only name, description and status can change).
  expect((await api(owner, "PATCH", `/purchasing/tax-codes/${tc.id}`, { rate: 10, name: "VAT standard" })).body).toMatchObject({ rate: "15", name: "VAT standard" });
  await owner.reload();
  await row.getByRole("button", { name: "Deactivate" }).click();
  await toast(owner, /deactivated/);
  await expect(row).toContainText("inactive");
  // A bad rate is refused — in the form, and by the API.
  await owner.getByTestId("new-tax-code").click();
  await owner.getByRole("dialog").locator("#tc-code").fill(`BAD${RUN}`.slice(0, 20));
  await owner.getByRole("dialog").locator("#tc-name").fill("Too high");
  await owner.getByRole("dialog").locator("#tc-rate").fill("150");
  await expect(owner.getByRole("dialog")).toContainText("Enter 0–100, at most 4 decimals");
  await expect(owner.getByRole("dialog").getByTestId("save-tax-code")).toBeDisabled();
  expect((await api(owner, "POST", "/purchasing/tax-codes", { code: `BAD${RUN}`.slice(0, 20), name: "Too high", rate: "150", recoverablePct: 0 })).status).toBe(400);
  await shot(owner, "p4a-tax-codes");
});

test("STAFF manages suppliers but can't configure purchasing", async ({ browser }) => {
  const staff = await login(browser, STAFF);
  await staff.goto("/admin/finance/suppliers");
  await expect(staff.getByTestId("new-supplier")).toBeVisible(NAV);
  await staff.goto("/admin/finance/tax-codes");
  await expect(staff.getByRole("heading", { name: "Purchase tax codes" })).toBeVisible(NAV);
  await expect(staff.getByTestId("new-tax-code")).toHaveCount(0);
  expect((await api(staff, "POST", "/purchasing/tax-codes", { code: "STAFF1", name: "x", rate: 1, recoverablePct: 0 })).status).toBe(403);
  expect((await api(staff, "POST", "/purchasing/setup", {})).status).toBe(403);
  expect((await api(staff, "POST", "/purchasing/suppliers", { legalName: `Staff supplier ${RUN}` })).status).toBe(201);
});
