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
  const bought = page.getByRole("dialog", { name: "Received goods" });
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
  // the purchase heads the activity (beside the list on wide screens, its own tab on a phone)
  if (!(await page.getByTestId("activity-panel").isVisible())) await page.getByTestId("stock-view-activity").click();
  await expect(page.getByTestId("activity-event").first()).toContainText("Received 10 ml", NAV);
  if (await page.getByTestId("stock-view-stock").isVisible()) await page.getByTestId("stock-view-stock").click();
  const afterBuy = await overview(page);
  expect(itemOf(afterBuy, oil!.variantId).stock).toBe(oil!.stock + 10);

  // ── Filled: one bottle of an attar that can be made ─────────────────────────────────────────────────────────────────
  const before = itemOf(afterBuy, attar!.variantId);
  await page.getByTestId("stock-action-filled").click();
  // with bottles waiting the button opens Mark bottles filled; one bottle for later goes through its single-fill link
  const batch = page.getByRole("dialog", { name: "Mark bottles filled" });
  const filled = page.getByRole("dialog", { name: "Filled bottles" });
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
  const counted = page.getByRole("dialog", { name: "Count", exact: true });
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

test("before stock costing is live, Received goods opens in simple mode: nothing booked, catalog cost on by default", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("stock-list")).toBeVisible(NAV);
  test.skip((await overview(page)).costingActive, "stock costing is live on this database — purchases are booked there");
  // blueprint P1.4 (owner decision Q-F): fills and counts wait for go-live, Received goods doesn't
  await expect(page.getByTestId("stock-golive")).toContainText("Received goods can be recorded now");
  await page.getByTestId("stock-action-bought").click();
  const bought = page.getByRole("dialog", { name: "Received goods" });
  await expect(bought.getByTestId("bought-simple")).toContainText("Stock costing hasn't started");
  await expect(bought.getByTestId("bought-catalog-cost")).toBeChecked();
  await bought.getByRole("button", { name: "Cancel" }).click();
  await expect(bought).toBeHidden(NAV);
});

test("a sheet with typed counts asks before it closes; an empty one closes at once", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("stock-action-counted")).toBeVisible(NAV);
  test.skip(!(await overview(page)).costingActive, "stock costing isn't live on this database (run it on a go-live rehearsal copy)");
  await page.getByTestId("stock-action-counted").click();
  const counted = page.getByRole("dialog", { name: "Count", exact: true });
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
  // the previous list stays on screen (aria-busy) until the filtered one arrives
  const settled = () => expect(list.locator("[aria-busy=true]")).toHaveCount(0, NAV);
  await settled();
  await expect(list.getByTestId("stock-list-empty").or(rows.first())).toBeVisible(NAV);
  for (const r of await rows.all()) await expect(r).toContainText("Out");

  await list.getByTestId("stock-filter-ALL").click();
  await expect(list.getByTestId("stock-filter-ALL")).toHaveAttribute("aria-pressed", "true");
  await settled();
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

test("Reorder opens Received goods with the suggested amounts; a price far above last time asks for a check", async ({ page }) => {
  await login(page);
  type Reorder = { items: Array<{ variantId: string; suggested: number; supplier: { id: string } | null; lastUnitCost: number | null }> } | null;
  const reorder = ((await (await page.request.get(`${API}/api/v1/finance/stock/today`)).json()) as { reorder: Reorder }).reorder;
  test.skip(!reorder || !(await overview(page)).costingActive, "nothing to reorder on this database");
  await page.getByTestId("today-reorder-open").click();
  const sheet = page.getByTestId("reorder-sheet");
  await expect(sheet).toBeVisible(NAV);
  await expect(sheet.getByTestId("reorder-row")).toHaveCount(reorder!.items.length);
  const group = sheet.getByTestId("reorder-group").first();
  const firstQty = await group.getByTestId("reorder-qty").first().inputValue();
  await group.getByTestId("reorder-record").click();
  const bought = page.getByRole("dialog", { name: "Received goods" });
  await expect(bought).toBeVisible(NAV);
  await expect(bought.getByTestId("bought-line").first()).toBeVisible();
  const qty = bought.getByTestId("bought-qty").first();
  if (await qty.isVisible()) await expect(qty).toHaveValue(firstQty);

  const last = bought.getByTestId("bought-last-price").first();
  if (await last.isVisible()) {
    const line = bought.getByTestId("bought-line").filter({ has: page.getByTestId("bought-last-price") }).first();
    const lastEach = Number((await last.innerText()).replace(/[^\d.]/g, ""));
    const n = Number(await line.getByTestId("bought-qty").inputValue());
    await line.getByTestId("bought-amount").fill(String(Math.ceil(n * lastEach * 1.3)));
    await expect(line.getByTestId("bought-price-check")).toContainText("more than last time");
  }
});

test("this week's count goes one item at a time and saves one count", async ({ page }) => {
  await login(page);
  const today = (await (await page.request.get(`${API}/api/v1/finance/stock/today`)).json()) as Today;
  test.skip(!today.count || !(await overview(page)).costingActive, "nothing due to count on this database");
  await page.getByTestId("today-count-open").click();
  const sheet = page.getByTestId("guided-count");
  await expect(sheet).toBeVisible(NAV);
  // type what the books say on every screen: everything matches, so nothing moves
  for (let n = 0; n < 200 && (await sheet.getByTestId("guided-step").isVisible()); n++) {
    const says = (await sheet.getByTestId("guided-step").innerText()).match(/The books say ([\d,]+)/)![1]!.replace(/,/g, "");
    await sheet.getByTestId("guided-qty").fill(says);
    await expect(sheet.getByTestId("guided-match")).toBeVisible();
    await page.getByTestId("guided-next").click();
  }
  await expect(sheet.getByTestId("guided-summary")).toContainText("0 short");
  await page.getByTestId("guided-save").click();
  await expect(sheet.getByTestId("guided-done")).toContainText("all match the books", NAV);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("a count loss waiting for the owner can be approved from Today", async ({ page }) => {
  await login(page);
  const today = (await (await page.request.get(`${API}/api/v1/finance/stock/today`)).json()) as Today;
  test.skip(today.approvals.length === 0, "no count loss waiting on this database (only staff counts wait)");
  await page.getByTestId("today-approval-open").first().click();
  await expect(page.getByTestId("approval-sheet")).toBeVisible(NAV);
  await page.getByTestId("approval-approve").click();
  await expect(page.getByTestId("approval-sheet")).toBeHidden(NAV);
});

test("the list's filters live in the URL", async ({ page }) => {
  await login(page);
  await page.getByTestId("stock-filter-LOW").click();
  await expect(page).toHaveURL(/status=LOW/, NAV);
  await page.reload();
  await expect(page.getByTestId("stock-filter-LOW")).toHaveAttribute("aria-pressed", "true", NAV);
});

test("search forgives typos and shows matches with what to do; the activity shows what happened", async ({ page }) => {
  await login(page);
  const first = page.getByTestId("stock-list").locator("[data-testid^=stock-row-]").first();
  await expect(first).toBeVisible(NAV);
  const name = (await first.locator("span.line-clamp-2").innerText()).trim();
  const word = name.split(/\s+/).find((w) => w.length >= 5)!;
  // drop one letter: still found
  const typo = word.slice(0, 2) + word.slice(3);
  await page.getByTestId("stock-search").fill(typo);
  await expect(page.getByTestId("stock-search-results")).toBeVisible(NAV);
  await expect(page.getByTestId("stock-search-result").first()).toBeVisible();
  await page.getByTestId("stock-search").press("Enter");
  await expect(page.getByTestId("stock-item-panel")).toBeVisible(NAV);
  await page.keyboard.press("Escape");
  await page.getByTestId("stock-search").fill("");
  // wide: the item sits where the activity was — back to it; phone: the Activity tab
  if (await page.getByTestId("stock-item-back").isVisible()) await page.getByTestId("stock-item-back").click();
  else if (!(await page.getByTestId("activity-panel").isVisible())) await page.getByTestId("stock-view-activity").click();
  await expect(page.getByTestId("activity-panel")).toBeVisible(NAV);
  await expect(page.getByTestId("activity-done-today")).toBeVisible();
});
