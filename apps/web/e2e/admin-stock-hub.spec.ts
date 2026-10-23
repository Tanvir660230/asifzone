import { test, expect, type Page } from "@playwright/test";

// Stock hub (docs/STOCK_HUB.md, /admin/stock): the owner buys oil, fills bottles and counts — through the page — and the
// overview's numbers move by exactly that. Runs on desktop and on a phone (the forms are bottom sheets there).
//
// Needs a QA database where stock costing is live (a go-live rehearsal copy: materials, recipes, fill-to-order attar) and
// the owner's own money allowed (finance.sensitive). It writes: a purchase of 10 ml oil, one filled bottle, one count.
// E2E_API_URL must point at the API the web app talks to, started with LIVE_PROVIDERS=off.

const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const NAV = { timeout: 30_000 };

interface Item { variantId: string; sku: string; productId: string; productName: string; name: string; stock: number; reserved: number; expectedOnShelf: number; makeable: number | null }
interface Overview { costingActive: boolean; groups: Array<{ key: string; items: Item[] }> }

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/admin/login?next=%2Fadmin%2Fstock");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/stock/, NAV);
}

async function overview(page: Page): Promise<Overview> {
  const res = await page.request.get(`${API}/api/v1/finance/stock`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Overview;
}
const itemOf = (o: Overview, id: string) => o.groups.flatMap((g) => g.items).find((i) => i.variantId === id)!;
const group = (o: Overview, key: string) => o.groups.find((g) => g.key === key)?.items ?? [];

test("buy oil, fill a bottle and count — the stock follows each", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Stock", level: 1 })).toBeVisible(NAV);
  await expect(page.getByTestId("stock-group-fill")).toBeVisible(NAV);
  const start = await overview(page);
  test.skip(!start.costingActive, "stock costing isn't live on this database (run it on a go-live rehearsal copy)");

  const oil = group(start, "MATERIAL").find((i) => /oil/i.test(i.productName));
  const attar = group(start, "FILL_TO_ORDER").find((i) => (i.makeable ?? 0) > 0);
  test.skip(!oil || !attar, "needs an oil material and an attar that can be filled");

  // ── Bought: 10 ml of oil for ৳300, paid from the owner's own money ──────────────────────────────────────────────────
  await page.getByTestId("stock-action-bought").click();
  const bought = page.getByRole("dialog", { name: "Bought" });
  await bought.getByTestId("bought-search").fill(oil!.productName);
  await bought.getByTestId("bought-choices").getByRole("button", { name: new RegExp(oil!.productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await bought.getByTestId("bought-qty").fill("10");
  await bought.getByTestId("bought-amount").fill("300");
  await expect(bought.getByTestId("bought-per-unit")).toContainText("per ml");
  await bought.getByTestId("bought-paid-from").selectOption("owner");
  await bought.getByTestId("bought-save").click();
  await expect(bought).toBeHidden(NAV);
  await expect(page.getByTestId("stock-recent-row").first()).toContainText("10 ml");
  const afterBuy = await overview(page);
  expect(itemOf(afterBuy, oil!.variantId).stock).toBe(oil!.stock + 10);

  // ── Filled: one bottle of an attar that can be made ─────────────────────────────────────────────────────────────────
  const before = itemOf(afterBuy, attar!.variantId);
  await page.getByTestId("stock-action-filled").click();
  const filled = page.getByRole("dialog", { name: "Filled" });
  await filled.getByTestId("filled-attar").getByRole("button", { name: attar!.productName, exact: true }).click();
  const sizes = filled.getByRole("group", { name: "Bottle size" });
  if (await sizes.isVisible()) await filled.getByTestId(`filled-size-${attar!.sku}`).click();
  await filled.getByTestId("filled-count").fill("1");
  await expect(filled.getByTestId("filled-uses-list")).toBeVisible(NAV);
  await filled.getByTestId("filled-save").click();
  await expect(filled.getByTestId("filled-done")).toBeVisible(NAV);
  await expect(filled.getByTestId("filled-cost")).toContainText(/\d/);
  await filled.getByRole("button", { name: "Done" }).click();
  const afterFill = await overview(page);
  expect(itemOf(afterFill, attar!.variantId).stock).toBe(before.stock + 1);

  // ── Counted: the oil is 1 ml short — a reason is required, then the difference is booked ───────────────────────────
  const oilNow = itemOf(afterFill, oil!.variantId);
  await page.getByTestId("stock-action-counted").click();
  const counted = page.getByRole("dialog", { name: "Counted" });
  await counted.getByRole("searchbox", { name: "Find an item to count" }).fill(oil!.productName);
  const line = counted.getByTestId("count-line").filter({ hasText: oil!.productName }).first();
  await line.getByRole("textbox").fill(String(oilNow.expectedOnShelf - 1));
  await counted.getByTestId("counted-save").click();
  await expect(line.getByText("Say why it's short")).toBeVisible();
  await line.getByTestId("count-reason").selectOption("DAMAGED");
  await counted.getByTestId("counted-save").click();
  await expect(counted.getByTestId("counted-result")).toBeVisible(NAV);
  await expect(counted.getByTestId("counted-result-line").first()).toContainText("−1 booked");
  await counted.getByTestId("counted-close").click();
  const afterCount = await overview(page);
  expect(itemOf(afterCount, oil!.variantId).stock).toBe(oilNow.stock - 1);
  await expect(page.getByTestId("stock-summary")).toContainText("Last counted");
});

test("a sheet with typed counts asks before it closes; an empty one closes at once", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("stock-action-counted")).toBeVisible(NAV);
  test.skip(!(await overview(page)).costingActive, "stock costing isn't live on this database (run it on a go-live rehearsal copy)");
  await page.getByTestId("stock-action-counted").click();
  const counted = page.getByRole("dialog", { name: "Counted" });
  await counted.getByRole("button", { name: "Cancel" }).click();
  await expect(counted).toBeHidden();

  await page.getByTestId("stock-action-counted").click();
  const field = counted.getByTestId("count-line").first().getByRole("textbox");
  await field.fill("7");
  await page.keyboard.press("Escape");
  await expect(counted.getByTestId("discard-prompt")).toContainText("Discard these counts?");
  await counted.getByRole("button", { name: "Keep editing" }).click();
  await expect(field).toHaveValue("7");
  await counted.getByRole("button", { name: "Cancel" }).click();
  await counted.getByTestId("discard-confirm").click();
  await expect(counted).toBeHidden();
});

test("the owner's home links goods in stock to the Stock page", async ({ page }) => {
  await login(page);
  await page.goto("/admin/finance");
  await expect(page.getByTestId("owner-money")).toBeVisible(NAV);
  const link = page.getByTestId("owner-money").getByRole("link", { name: /Goods in stock, at cost/ });
  test.skip(!(await link.isVisible().catch(() => false)), "no stock value on this database's home");
  await expect(link).toHaveAttribute("href", "/admin/stock");
});

