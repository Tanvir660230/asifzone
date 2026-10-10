import { test, expect, type Browser, type Page } from "@playwright/test";

// ERP back office browser QA (docs/FINANCE_ALERTS.md, FINANCE_BUDGETS.md, FINANCE_PAYROLL.md, FINANCE_EQUITY.md): the
// Needs-attention feed and month-end checklist, the cash forecast, payroll set-up through the UI and the printable
// payslips, the partner register (equity tied to the balance sheet), and payroll refused to staff.
//
// It changes data (a pay component, an employee, a partner — names unique per run): run it only against a disposable QA
// database whose books are started. E2E_API_URL must point at the API the web app talks to.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const STAFF = { email: process.env.QA_STAFF_EMAIL ?? "staff@example.com", password: process.env.QA_STAFF_PASSWORD ?? "ChangeMe123!" };
const NAV = { timeout: 30_000 };
const RUN = Date.now().toString(36);

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "desktop Chromium only");

async function login(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
  return page;
}

async function api(page: Page, method: string, path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "csrf_token")?.value;
  const res = await page.request.fetch(`${API}/api/v1/finance${path}`, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

let owner: Page;

test.beforeAll(async ({ browser }) => {
  owner = await login(browser, OWNER);
});

test("needs attention: every alert links to its fix; the month-end checklist covers every step", async () => {
  await owner.goto("/admin/finance/attention");
  await expect(owner.getByRole("heading", { name: "Needs attention" })).toBeVisible(NAV);
  await expect(owner.getByTestId("alert-counts").or(owner.getByTestId("alerts-empty"))).toBeVisible(NAV);
  const { body } = await api(owner, "GET", "/alerts");
  for (const a of body.alerts as Array<{ key: string; href: string }>) {
    await expect(owner.getByTestId(`alert-${a.key}`).getByRole("link")).toHaveAttribute("href", a.href);
  }
  await owner.getByRole("radio", { name: "Month-end close" }).or(owner.getByRole("button", { name: "Month-end close" })).first().click();
  await expect(owner.getByTestId("month-label")).toBeVisible(NAV);
  for (const key of ["events", "approvals", "expenses", "payroll", "bills", "bank", "depreciation", "interest", "exceptions", "checks"]) {
    await expect(owner.getByTestId(`step-${key}`)).toBeVisible();
  }
  const before = await owner.getByTestId("month-label").innerText();
  await owner.getByRole("button", { name: "Previous month" }).click();
  await expect(owner.getByTestId("month-label")).not.toHaveText(before, NAV);
});

test("budgets & cash: the forecast loads from the books", async () => {
  await owner.goto("/admin/finance/budgets");
  await expect(owner.getByRole("heading", { name: "Budgets & cash" })).toBeVisible(NAV);
  await expect(owner.getByText(/cash now/i).first()).toBeVisible(NAV);
  await expect(owner.getByRole("alert").filter({ hasText: /couldn't be loaded/ })).toHaveCount(0);
});

test("payroll: a component and an employee through the UI; payslips print", async () => {
  await owner.goto("/admin/finance/payroll");
  await expect(owner.getByRole("heading", { name: "Payroll" })).toBeVisible(NAV);
  const view = owner.locator('[aria-label="View"]');

  await view.getByText("Pay components").click();
  await owner.getByTestId("new-component").click();
  await owner.locator("#pc-name").fill(`Overtime QA ${RUN}`);
  await owner.getByTestId("save-component").click();
  await expect(owner.getByTestId("component-row").filter({ hasText: `Overtime QA ${RUN}` })).toBeVisible(NAV);

  await view.getByText("Employees").click();
  await owner.getByTestId("new-employee").click();
  const dialog = owner.getByRole("dialog");
  await dialog.locator("#em-name").fill(`QA Employee ${RUN}`);
  await dialog.locator("#em-join").fill("2026-10-01");
  const basic = (await api(owner, "GET", "/payroll/components")).body.components.find((c: { isBasic: boolean }) => c.isBasic) as { name: string } | undefined;
  test.skip(!basic, "the QA payroll has no basic salary component");
  await dialog.locator("fieldset label", { hasText: basic!.name }).locator("input[type=checkbox]").check();
  await dialog.locator(`input[aria-label="${basic!.name} amount"]`).fill("20000");
  await dialog.locator("fieldset label", { hasText: `Overtime QA ${RUN}` }).locator("input[type=checkbox]").check();
  await dialog.locator(`input[aria-label="Overtime QA ${RUN} amount"]`).fill("1500");
  await owner.getByTestId("save-employee").click();
  const row = owner.getByTestId("employee-row").filter({ hasText: `QA Employee ${RUN}` });
  await expect(row).toBeVisible(NAV);
  const emp = (await api(owner, "GET", "/payroll/employees")).body.employees.find((e: { name: string }) => e.name === `QA Employee ${RUN}`);
  await expect(row).toContainText(new Intl.NumberFormat("en-IN").format(emp.standard.gross));

  const runs = (await api(owner, "GET", "/payroll")).body.runs as Array<{ id: string; payslips: unknown[] }>;
  const printable = runs.find((r) => r.payslips.length);
  if (printable) {
    await owner.goto(`/admin/finance/payroll/runs/${printable.id}/payslips`);
    await expect(owner.getByTestId("payslip-document")).toHaveCount(printable.payslips.length, NAV);
    await expect(owner.getByTestId("print-payslips")).toBeEnabled();
  }
});

test("partners & equity: a partner gets their own accounts; equity equals the balance sheet", async () => {
  await owner.goto("/admin/finance/equity");
  await expect(owner.getByRole("heading", { name: "Partners & equity" })).toBeVisible(NAV);
  await owner.getByTestId("new-partner").click();
  await owner.locator("#pt-name").fill(`QA Partner ${RUN}`);
  await owner.locator("#pt-joined").fill("2026-01-01");
  await owner.locator("#pt-share").fill("10");
  await owner.getByTestId("save-partner").click();
  const card = owner.getByTestId("partner-card").filter({ hasText: `QA Partner ${RUN}` });
  await expect(card).toBeVisible(NAV);
  await expect(card).toContainText("unconfirmed");
  await expect(card.getByRole("link", { name: /^31\d\d ledger$/ })).toBeVisible();
  await expect(card.getByRole("link", { name: /^32\d\d ledger$/ })).toBeVisible();
  const e = (await api(owner, "GET", "/equity")).body;
  const bs = (await api(owner, "GET", `/statements/balance-sheet?asOf=${e.asOf}`)).body;
  expect(e.equity.total).toBe(bs.sections.find((s: { key: string }) => s.key === "equity").total);
});

test("staff can't see payroll — page and API", async ({ browser }) => {
  const staff = await login(browser, STAFF);
  await staff.goto("/admin/finance/payroll");
  await expect(staff.getByText("Payroll isn't available to your role")).toBeVisible(NAV);
  expect((await api(staff, "GET", "/payroll")).status).toBe(403);
  expect((await api(staff, "GET", "/equity")).status).toBe(403);
});
