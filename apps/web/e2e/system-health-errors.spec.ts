import { test, expect, type Page } from "@playwright/test";

// Site health › Errors: a crash reported by a browser shows up in Admin › System health, opens to its details, and
// "Mark fixed" moves it out of the open list. The crash is sent through the real public beacon, as a visitor's browser
// would. E2E_API_URL must point at the API the web app talks to.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const NAV = { timeout: 30_000 };
// The API saves errors in batches every 5 seconds.
const FLUSH = { timeout: 20_000 };

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
}

test("a browser crash appears under System health › Errors and can be marked fixed", async ({ page, request }, testInfo) => {
  const tag = `e2e-${testInfo.project.name}-${Date.now().toString(36)}`;
  const message = `TypeError: ${tag} cannot read 'price'`;
  const sent = await request.post(`${API}/api/v1/client-errors`, {
    data: { message, stack: `TypeError: x\n    at Card (http://localhost/_next/static/chunks/${tag}.js:1:1)`, path: "/products/e2e", kind: "unhandled" },
  });
  expect(sent.status()).toBe(204);

  await login(page);
  await page.goto("/admin/system-health#errors");
  const row = page.getByTestId("error-row").filter({ hasText: tag });
  await expect(async () => {
    await page.reload();
    await expect(row).toBeVisible({ timeout: 3_000 });
  }).toPass(FLUSH);
  await expect(row).toContainText("Website · /products/e2e");

  await row.locator("summary").click();
  await expect(row.locator("pre")).toContainText(tag);
  await row.getByRole("button", { name: "Mark fixed" }).click();
  await expect(row).toHaveCount(0);

  await page.getByRole("button", { name: "Fixed" }).click();
  await expect(page.getByTestId("error-row").filter({ hasText: tag })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
