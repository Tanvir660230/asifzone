import { test, expect, type Page } from "@playwright/test";

// Blueprint V2 P9 visual baseline for the Store Console: one screenshot per key page, desktop and phone. Opt-in
// (VISUAL=1) because screenshots depend on the OS's font rendering and on the data in the database — generate the
// baseline on the machine that compares against it: `VISUAL=1 pnpm --filter web test:e2e admin-visual --update-snapshots=all`.
// Data (table rows, times, figures) is masked, so what's compared is the layout, chrome, headings and controls. Read-only.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const NAV = { timeout: 30_000 };
// "Thursday 8 October", "8 Oct 2026 · 18:06", "7h ago", "Today, 3:05 PM" — text that changes by itself.
const DATE_TEXT = /\b(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b\d+[mhd] ago\b|\d{1,2}:\d{2}/;

const PAGES: ReadonlyArray<{ name: string; path: string; heading: string | RegExp; maskHeading?: boolean }> = [
  // The greeting follows the clock ("Good morning, …") — masked.
  { name: "home", path: "/admin/dashboard", heading: /^(Good (morning|afternoon|evening|night)|Welcome back)/, maskHeading: true },
  { name: "orders", path: "/admin/orders", heading: "Orders" },
  { name: "products", path: "/admin/products", heading: "Products" },
  { name: "customers", path: "/admin/customers", heading: "Customers" },
  { name: "inbox", path: "/admin/feedback", heading: "Inbox" },
  { name: "payments", path: "/admin/payments/overview", heading: /Payments|Overview/ },
  { name: "analytics", path: "/admin/analytics/overview", heading: /Overview|Analytics/ },
  { name: "settings", path: "/admin/settings", heading: "Settings" },
  { name: "audit-log", path: "/admin/audit-log", heading: /Audit/ },
];

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
}

test.describe("admin visual baseline", () => {
  test.skip(!process.env.VISUAL, "opt-in: VISUAL=1");

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  for (const p of PAGES) {
    test(p.name, async ({ page }) => {
      await page.goto(p.path, NAV);
      await expect(page.getByRole("heading", { name: p.heading, level: 1 }).first()).toBeVisible(NAV);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page).toHaveScreenshot(`${p.name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.02,
        mask: [
          ...(p.maskHeading ? [page.locator("main h1")] : []),
          // Anything that follows the data: rows (table or phone cards), counts in the subtitle, figures, dates, charts.
          page.locator("main tbody, main [role=row], main article, main time, main .tabular-nums, main h1 + p, [data-volatile]"),
          page.locator("main").getByText(/on the store now|trend|orders? today|need attention|placed today/),
          // Bare counts and percentages anywhere — sidebar badges, chips, trend arrows.
          page.getByText(/^[+\-−]?\d[\d,.]*%?$/),
          page.locator("main svg:not(.lucide)"),
          page.locator("main").getByText(DATE_TEXT),
        ],
      });
    });
  }
});
