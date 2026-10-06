import { expect, test, type Page } from "@playwright/test";

// Phase 12 D-4: provider-backed actions are offered only when the provider is usable on this deployment. The e2e API
// runs with every provider credential blank (LIVE_PROVIDERS=off), so courier, SMS, email, push and both gateways are
// unavailable here: their actions must not appear, while the OWNER still sees the status and the missing variables.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const STAFF = { email: process.env.E2E_STAFF_EMAIL ?? "claude-e2e-staff@example.com", password: process.env.E2E_STAFF_PASSWORD ?? "ClaudeE2eStaff123!" };

test.describe.configure({ mode: "serial" });

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

async function apiGet(page: Page, path: string) {
  return page.evaluate(async ({ api, path }) => {
    const res = await fetch(`${api}${path}`, { credentials: "include" });
    return { status: res.status, body: res.ok ? await res.json() : null };
  }, { api: API, path });
}

test.describe("provider actions follow provider availability (D-4)", () => {
  test("this e2e deployment reports every provider-backed capability as unavailable", async ({ page }) => {
    await login(page, OWNER);
    const { status, body } = await apiGet(page, "/api/v1/ops/capabilities");
    expect(status).toBe(200);
    expect(body.capabilities).toEqual({ sms: false, email: false, push: false, courier: false, payments: { SSLCOMMERZ: false, EPS_PG: false } });
  });

  test("OWNER: the Integrations panel shows each provider's status and the missing variables by name", async ({ page }) => {
    await login(page, OWNER);
    await page.goto("/admin/settings");
    await page.getByRole("button", { name: "Shipping, Tax & Rewards" }).click();
    const panel = page.locator("li", { hasText: "Courier" });
    await expect(panel).toContainText("steadfast");
    await expect(panel).toContainText("Missing credentials");
    await expect(panel).toContainText("STEADFAST_API_KEY, STEADFAST_SECRET_KEY");
    // A gateway that can't work can't be switched on, and says why.
    await expect(page.getByText("Not configured on this server — see Integrations below.").first()).toBeVisible();
  });

  test("courier and SMS actions are not offered; campaign channels without a provider can't be chosen", async ({ page }) => {
    await login(page, OWNER);
    await expect(page.getByText("Steadfast balance")).toHaveCount(0);

    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { name: /orders/i }).first()).toBeVisible();
    await expect(page.getByText("Check score")).toHaveCount(0);
    await expect(page.getByText("Book with Steadfast")).toHaveCount(0);

    await page.goto("/admin/customers");
    await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send SMS" })).toHaveCount(0);

    await page.goto("/admin/campaigns");
    await page.getByRole("button", { name: /new campaign/i }).click();
    const channel = page.locator("select#channel");
    await expect(channel).toBeVisible();
    await expect(channel.locator('option[value="SMS"]')).toBeDisabled();
    await expect(channel.locator('option[value="PUSH"]')).toBeDisabled();
    await expect(channel.locator('option[value="SMS"]')).toHaveText("SMS (not configured)");
  });

  test("STAFF can read the action availability but not the OWNER-only provider status", async ({ page }) => {
    await login(page, STAFF);
    expect((await apiGet(page, "/api/v1/ops/capabilities")).status).toBe(200);
    expect((await apiGet(page, "/api/v1/ops/providers")).status).toBe(403);
  });
});
