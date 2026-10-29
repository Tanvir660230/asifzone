import { test, expect, type Page } from "@playwright/test";

// Order Operations plan, phase 2 — the Orders list keeps its place. A bulk action leaves the page, filters, search, sort
// and size alone; when the rows it moved empty the page, the list lands on the last page that still has rows (never
// page 1) and says so. Print labels, refresh and Back/Forward return to the same list; the drawer's order is in the URL;
// page size and density are remembered per admin. The spec places its own orders (one search tag) and deletes them.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

function adminFetch(page: Page, path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return page.evaluate(
    async ({ url, method, body, headers }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    },
    { url: `${api}${path}`, method, body, headers },
  );
}

/** `count` PENDING COD orders whose customer name carries `tag` — the spec's own search filter. */
async function placeOrders(page: Page, tag: string, count: number): Promise<string[]> {
  const { body: catalog } = await adminFetch(page, "/api/products/storefront?pageSize=60", "GET");
  const items = (catalog?.items ?? []) as Array<{ trackInventory: boolean; variants: Array<{ id: string; stock: number; isActive?: boolean }> }>;
  // One unit per order, spread over every variant with stock to spare (a seed catalog has no single variant this deep).
  const units = items.flatMap((p) =>
    p.variants
      .filter((v) => v.isActive !== false)
      .flatMap((v) => Array.from({ length: p.trackInventory ? Math.max(0, v.stock - 2) : count }, () => v.id)),
  );
  expect(units.length, `stock for ${count} one-unit orders`).toBeGreaterThanOrEqual(count);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const variant = { id: units[i]! };
    const res = await adminFetch(
      page,
      "/api/orders/admin",
      "POST",
      {
        items: [{ variantId: variant.id, quantity: 1 }],
        customerName: `${tag} ${String(i).padStart(2, "0")}`,
        customerPhone: "01712345670",
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 5, Road 6 (Playwright)",
        paymentMethod: "COD",
      },
      { "Idempotency-Key": `pw-pagestate-${tag}-${i}` },
    );
    const id = (res.body?.order as { id: string } | undefined)?.id;
    expect(id, JSON.stringify(res.body)).toBeTruthy();
    ids.push(id!);
  }
  return ids;
}

const rows = (page: Page) => page.locator('[data-testid="order-row"]');
const query = (page: Page) => new URL(page.url()).searchParams;

async function selectAllAndConfirm(page: Page) {
  await page.getByRole("checkbox", { name: "Select all orders on this page" }).check();
  await page.getByRole("button", { name: /^Set status/ }).click();
  await page.getByRole("menuitem", { name: /^Confirmed/ }).click();
  await page.getByRole("button", { name: /^Move \d+ to Confirmed$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("orders list keeps its place", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1280, "The table (and its bulk flow) is the desktop layout; phones get cards");
  test.beforeEach(async ({ page }) => login(page));

  test("bulk action, emptied page, print labels, drawer, refresh, Back/Forward and remembered display", async ({ page }) => {
    test.setTimeout(180_000);
    const tag = `Pager${Date.now().toString(36)}`;
    const ids = await placeOrders(page, tag, 60);
    try {
      // Page 3 of 25 (60 matching PENDING orders → 25 + 25 + 10), sorted, searched, filtered.
      const listUrl = `/admin/orders?q=${tag}&f.status=PENDING&sort=-customerName&size=25&page=3`;
      await page.goto(listUrl);
      await expect(rows(page)).toHaveCount(10);

      // Confirm all ten: they leave the PENDING filter, page 3 empties → the list lands on page 2 (not 1) and says so.
      await selectAllAndConfirm(page);
      await expect(page.getByTestId("orders-page-moved")).toContainText("showing page 2");
      await expect.poll(() => query(page).get("page")).toBe("2");
      expect(query(page).get("q")).toBe(tag);
      expect(query(page).get("f.status")).toBe("PENDING");
      expect(query(page).get("sort")).toBe("-customerName");
      expect(query(page).get("size")).toBe("25");
      await expect(rows(page)).toHaveCount(25);

      // The default list shows latest activity first: the ten just confirmed (the first ten placed, 00–09) lead it.
      await page.goto(`/admin/orders?q=${tag}&size=25`);
      await expect(rows(page).first().getByTestId("order-moved")).toContainText("Confirmed");
      await expect(rows(page).nth(9).getByTestId("order-moved")).toContainText("Confirmed");
      await expect(rows(page).nth(10).getByTestId("order-moved")).toHaveCount(0);

      // Without the status filter the confirmed rows stay in view: a bulk action keeps page, search, sort and size.
      await page.goto(`/admin/orders?q=${tag}&sort=customerName&size=25&page=2`);
      await expect(rows(page)).toHaveCount(25);
      const before = page.url();
      await rows(page).first().getByRole("checkbox").check();
      await page.getByRole("button", { name: /^Set status/ }).click();
      await page.getByRole("menuitem", { name: /^Confirmed/ }).click();
      await page.getByRole("button", { name: /^Move (1 to Confirmed|to Confirmed)$/ }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(25);
      expect(page.url()).toBe(before);

      // Print labels → Back returns to the same list URL.
      await rows(page).first().getByRole("checkbox").check();
      await page.getByRole("button", { name: "Print labels" }).click();
      await expect(page).toHaveURL(/\/admin\/orders\/print-labels/);
      await page.getByTestId("print-labels-back").click();
      await expect.poll(() => page.url()).toBe(before);
      await expect(rows(page)).toHaveCount(25);

      // The drawer's order is in the URL: refresh reopens it; Back closes it and keeps the list.
      await rows(page).first().getByRole("button").first().click();
      await expect.poll(() => query(page).get("open")).toBeTruthy();
      await page.reload();
      await expect(page.getByRole("dialog", { name: "Order details" })).toBeVisible();
      await page.goBack();
      await expect.poll(() => query(page).get("open")).toBeNull();
      expect(query(page).get("page")).toBe("2");

      // Refresh and Back/Forward walk the same list states.
      await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Page 3" }).click();
      await expect.poll(() => query(page).get("page")).toBe("3");
      await page.goBack();
      await expect.poll(() => query(page).get("page")).toBe("2");
      await page.goForward();
      await expect.poll(() => query(page).get("page")).toBe("3");
      await page.reload();
      expect(query(page).get("page")).toBe("3");
      await expect(rows(page)).toHaveCount(10);

      // Page size and density are remembered for this admin (a link without `size` uses the stored one).
      await page.getByRole("combobox", { name: "Rows" }).selectOption("100");
      await expect.poll(() => query(page).get("size")).toBe("100");
      expect(query(page).get("page")).toBeNull();
      await page.getByTestId("orders-display").click();
      await page.getByRole("group", { name: "Row height" }).getByRole("button", { name: "Compact" }).click();
      await expect(page.getByRole("table", { name: "Orders" })).toHaveAttribute("data-density", "compact");
      await page.keyboard.press("Escape");
      await page.goto(`/admin/orders?q=${tag}`);
      await expect(page.getByRole("combobox", { name: "Rows" })).toHaveValue("100");
      await expect(page.getByRole("table", { name: "Orders" })).toHaveAttribute("data-density", "compact");
      await expect(rows(page)).toHaveCount(60);

      // An old link's size=10 rounds up to the smallest size offered now.
      await page.goto(`/admin/orders?q=${tag}&size=10`);
      await expect(page.getByRole("combobox", { name: "Rows" })).toHaveValue("25");
      await expect(rows(page)).toHaveCount(25);
    } finally {
      await adminFetch(page, "/api/v1/admin/list-preferences/orders", "PUT", { density: "standard", pageSize: 50, hiddenColumns: [] });
      for (const id of ids) {
        await adminFetch(page, `/api/orders/${id}`, "DELETE");
        await adminFetch(page, `/api/orders/${id}/permanent`, "DELETE");
      }
    }
  });
});
