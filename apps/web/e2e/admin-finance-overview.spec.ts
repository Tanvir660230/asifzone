import { test, expect, type Browser, type Page } from "@playwright/test";

// Finance front door (2026-10-12 reorganisation): the Finance module opens on its Overview — figures that link to the page
// behind them, the setup checklist until the books are started, and a map of every finance page; the setup pages that
// had an API but no screen (Start the books, Account mapping, Activity log) open with their data.
//
// Read-only: run against any QA database (books started or not). E2E_API_URL must point at the API the web app talks to.

const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const NAV = { timeout: 30_000 };

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "desktop Chromium only");

async function login(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
  return page;
}

let owner: Page;
test.beforeAll(async ({ browser }) => {
  owner = await login(browser);
});

test("the Finance module opens on its Overview, with every group in the map", async () => {
  await owner.goto("/admin/finance");
  await expect(owner.getByRole("heading", { name: "Finance", level: 1 })).toBeVisible(NAV);
  await expect(owner.getByRole("link", { name: /Money you have now/ })).toHaveAttribute("href", "/admin/finance/accounts");
  await expect(owner.getByTestId("overview-month").or(owner.getByText("Profit and loss couldn't be loaded"))).toBeVisible(NAV);
  await expect(owner.getByTestId("overview-alerts").or(owner.getByTestId("overview-alerts-empty"))).toBeVisible(NAV);
  const map = owner.getByTestId("finance-map");
  for (const group of ["Money", "Sales & payments", "Purchasing", "Reports & books", "Payroll & partners", "Setup & checks"]) {
    await expect(map.getByRole("heading", { name: group, exact: true })).toBeVisible();
  }
  await map.getByRole("link", { name: /Start the books/ }).click();
  await expect(owner).toHaveURL(/\/admin\/finance\/opening$/, NAV);
  await expect(owner.getByRole("heading", { name: "Start the books" })).toBeVisible(NAV);
  await expect(owner.getByTestId("opening-posted").or(owner.getByTestId("opening-date-step"))).toBeVisible(NAV);
});

test("payments pages sit in Sales & payments with the group's list beside them", async () => {
  await owner.goto("/admin/payments/transactions");
  await expect(owner.getByRole("heading", { name: "Customer payments" })).toBeVisible(NAV);
  const list = owner.getByRole("navigation", { name: "Sales & payments" });
  await expect(list.getByRole("link", { name: "Courier & gateway payouts" })).toHaveAttribute("href", "/admin/finance/settlements");
  await list.getByRole("link", { name: "Gateway monitor" }).click();
  await expect(owner.getByRole("heading", { name: "Gateway monitor" })).toBeVisible(NAV);
});

test("account mapping and the activity log load", async () => {
  await owner.goto("/admin/finance/mappings");
  await expect(owner.getByRole("heading", { name: "Account mapping" })).toBeVisible(NAV);
  await expect(owner.getByTestId("mapping-revenue.merchandise")).toBeVisible(NAV);
  await owner.goto("/admin/finance/activity?view=events");
  await expect(owner.getByRole("heading", { name: "Activity log" })).toBeVisible(NAV);
  await expect(owner.getByTestId("event-row").first().or(owner.getByTestId("events-empty"))).toBeVisible(NAV);
});
