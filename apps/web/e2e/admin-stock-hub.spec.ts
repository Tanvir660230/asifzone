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
  await expect(page.getByTestId("stock-today")).toBeVisible(NAV);
  await expect(page.getByTestId("stock-list")).toBeVisible(NAV);
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
  // the bill's unit total must match the lines; a mismatch is refused before anything is written
  await bought.getByTestId("bought-document-total").fill("12");
  await bought.getByTestId("bought-save").click();
  await expect(bought.getByText("The items add up to 10, the bill says 12")).toBeVisible();
  await bought.getByTestId("bought-document-total").fill("10");
  await bought.getByTestId("bought-save").click();
  await expect(bought.getByTestId("bought-review-row")).toHaveCount(1);
  await expect(bought.getByTestId("bought-review-total")).toHaveText("10");
  await bought.getByTestId("bought-save").click();
  await expect(bought).toBeHidden(NAV);
  await expect(page.getByTestId("stock-recent-row").first()).toContainText("10 ml");
  const afterBuy = await overview(page);
  expect(itemOf(afterBuy, oil!.variantId).stock).toBe(oil!.stock + 10);

  // ── Filled: one bottle of an attar that can be made ─────────────────────────────────────────────────────────────────
  const before = itemOf(afterBuy, attar!.variantId);
  await page.getByTestId("stock-action-filled").click();
  // with bottles waiting the button opens Mark bottles filled; one bottle for later goes through its single-fill link
  const batch = page.getByRole("dialog", { name: "Mark bottles filled" });
  const filled = page.getByRole("dialog", { name: "Filled" });
  await expect(batch.or(filled)).toBeVisible(NAV);
  if (await batch.isVisible()) await batch.getByTestId("batch-fill-single").click();
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
  await expect(filled).toBeHidden(NAV);

  // ── the size's trace: its recipe, and the fill just made ───────────────────────────────────────────────────────────
  await page.getByTestId("stock-search").fill(attar!.sku);
  await page.getByTestId(`stock-row-${attar!.sku}`).click();
  await page.getByTestId("stock-item-trace").click();
  const trace = page.getByTestId("stock-trace");
  await expect(trace.getByTestId("stock-trace-recipe")).toBeVisible(NAV);
  await expect(trace.getByTestId("stock-trace-fill").first()).toContainText(/1 bottle/);
  await page.keyboard.press("Escape");
  await expect(trace).toBeHidden(NAV);

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


// ── the smart stock page (docs/STOCK_HUB.md §7): Today and the stock list ─────────────────────────────────────────────

interface Today { fill: { bottles: number } | null; reorder: unknown; count: unknown; approvals: unknown[] }

test("Today lists what to do; the fill task opens Filled bottles", async ({ page }) => {
  await login(page);
  const today = (await (await page.request.get(`${API}/api/v1/finance/stock/today`)).json()) as Today;
  const card = page.getByTestId("stock-today");
  await expect(card).toBeVisible(NAV);
  if (!today.fill && !today.reorder && !today.count && today.approvals.length === 0) {
    await expect(card.getByTestId("today-clear")).toContainText("All caught up");
    return;
  }
  test.skip(!today.fill || !(await overview(page)).costingActive, "nothing to fill on this database");
  await expect(card.getByTestId("today-fill")).toContainText(`Fill ${today.fill!.bottles}`);
  await card.getByTestId("today-fill-open").click();
  const batch = page.getByRole("dialog", { name: "Mark bottles filled" });
  await expect(batch).toBeVisible(NAV);
  await expect(batch.getByTestId("batch-fill-line")).toHaveCount((today.fill as unknown as { lines: unknown[] }).lines.length);
  await expect(batch.getByTestId("batch-fill-save")).toContainText(`Mark ${today.fill!.bottles} filled`);
});

test("Mark filled records every ticked size in one save; an unticked size stays owed", async ({ page }) => {
  await login(page);
  test.skip(!(await overview(page)).costingActive, "stock costing isn't live on this database");
  type Fill = { bottles: number; lines: Array<{ variantId: string; owed: number }>; short: unknown[] };
  const before = ((await (await page.request.get(`${API}/api/v1/finance/stock/today`)).json()) as { fill: Fill | null }).fill;
  test.skip(!before || before.lines.length < 2 || before.short.length > 0, "needs two sizes waiting, all coverable");
  await page.getByTestId("today-fill-open").click();
  const batch = page.getByRole("dialog", { name: "Mark bottles filled" });
  const lines = batch.getByTestId("batch-fill-line");
  await expect(lines).toHaveCount(before!.lines.length, NAV);
  await lines.last().getByTestId("batch-fill-tick").uncheck();
  const skipped = before!.lines[before!.lines.length - 1]!;
  await batch.getByTestId("batch-fill-save").click();
  await expect(batch.getByTestId("batch-fill-done")).toBeVisible({ timeout: 90_000 });
  const after = (await overview(page)).groups.flatMap((g) => g.items);
  for (const l of before!.lines.slice(0, -1)) expect(after.find((i) => i.variantId === l.variantId)!.stock).toBeGreaterThanOrEqual(0);
  expect(after.find((i) => i.variantId === skipped.variantId)!.stock).toBeLessThan(0);
});

test("the stock list filters by status and searches on the server", async ({ page }) => {
  await login(page);
  const list = page.getByTestId("stock-list");
  await expect(list.locator("[data-testid^=stock-row-]").first()).toBeVisible(NAV);
  const out = list.getByTestId("stock-filter-OUT");
  await out.click();
  await expect(out).toHaveAttribute("aria-pressed", "true");
  const rows = list.locator("[data-testid^=stock-row-]");
  await expect(list.getByTestId("stock-list-empty").or(rows.first())).toBeVisible(NAV);
  for (const r of await rows.all()) await expect(r).toContainText("Out");

  await list.getByTestId("stock-filter-ALL").click();
  const first = await rows.first().getAttribute("data-testid");
  const sku = first!.replace("stock-row-", "");
  await page.getByTestId("stock-search").fill(sku);
  await expect(rows).toHaveCount(1, NAV);
  await expect(rows.first()).toHaveAttribute("data-testid", `stock-row-${sku}`);
  await page.getByTestId("stock-search").fill(`no-such-item-${Date.now()}`);
  await expect(list.getByTestId("stock-list-empty")).toContainText("Nothing matches", NAV);
});

test("a row opens the item; the page never scrolls sideways", async ({ page }) => {
  await login(page);
  const row = page.getByTestId("stock-list").locator("[data-testid^=stock-row-]").first();
  await expect(row).toBeVisible(NAV);
  await row.click();
  await expect(page.getByTestId("stock-item-panel")).toBeVisible(NAV);
  await expect(page.getByTestId("stock-item-movements")).toHaveAttribute("href", /\/admin\/inventory\?variantId=/);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
