import { test, expect, type Page } from "@playwright/test";

// The Orders workspace end to end (ORD-01 … ORD-29 UI paths). The spec creates its own order through the manual-order
// flow and removes it at the end (Trash → delete permanently), so it only ever touches the order it made. The API under
// test runs with live providers off (global-setup), so courier booking is expected to be refused by the provider guard.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** An admin API call with the session cookie and CSRF header — for asserting what the server itself refuses. */
function adminFetch(page: Page, path: string, method: string, body?: unknown) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { url: `${api}${path}`, method, body },
  );
}

const dialog = (page: Page) => page.getByRole("dialog").last();

test.describe("orders workspace", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("list: summary, queues, multi-status, search and empty state", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Operational summary" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Work queues" }).getByRole("button", { name: /Unpaid/ })).toBeVisible();

    // A quick filter becomes a removable chip and is reflected as pressed.
    const quick = page.getByRole("group", { name: "Quick filters" });
    await quick.getByRole("button", { name: /^COD/ }).click();
    await expect(quick.getByRole("button", { name: /^COD/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Remove filter COD" })).toBeVisible();

    // Multi-status: two status toggles → two chips (the list sends statusIn).
    const statuses = page.getByRole("group", { name: /Filter by status/ });
    await statuses.getByRole("button", { name: /^Delivered/ }).click();
    await statuses.getByRole("button", { name: /^Packed/ }).click();
    await expect(page.getByRole("button", { name: "Remove filter Status: Delivered" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove filter Status: Packed" })).toBeVisible();

    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("searchbox", { name: "Search orders" }).fill("zzz-no-such-order-zzz");
    await expect(page.locator(":text('No orders match these filters'):visible").first()).toBeVisible();
  });

  test("full order lifecycle: create, follow-up, price, status, payment, refund, courier, bulk trash/restore/delete", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one full pass is enough; mobile is covered by the responsive test");
    test.setTimeout(180_000);

    // ── ORD-17 manual order (server quote, same pipeline as checkout) ──
    await page.goto("/admin/orders/new");
    await page.getByLabel("Full name").fill("E2E Orders Workspace");
    await page.getByLabel("Phone").fill("01712345678");
    const area = page.getByRole("combobox", { name: "Area / Thana" });
    await area.click();
    await area.fill("Uttara");
    await area.press("Enter");
    await page.getByLabel("House / Road / Details").fill("House 1, Road 2");

    const productSearch = page.getByRole("textbox", { name: "Search products to add" });
    await productSearch.fill("a");
    const sellable = page.getByRole("button", { name: /in stock|not stock-tracked/ }).and(page.locator(":enabled"));
    const results = page.locator("div.absolute > div > button");
    await expect(results.first()).toBeVisible();
    for (let i = 0; i < (await results.count()) && !(await sellable.first().isVisible().catch(() => false)); i++) await results.nth(i).click();
    await sellable.first().click();
    await expect(page.getByRole("button", { name: /Create Order — .*\d/ })).toBeEnabled();
    await page.getByRole("button", { name: /Create Order — / }).click();
    await expect(page).toHaveURL(/\/admin\/orders\/(?!new$)[a-z0-9]+$/, { timeout: 30_000 });
    await expect(page.getByTestId("order-detail")).toBeVisible({ timeout: 30_000 });
    const orderId = page.url().split("/").pop()!;
    const orderNumber = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    expect(orderNumber).toMatch(/^ORD-/);
    const detail = page.getByTestId("order-detail");

    // ── ORD-07 follow-up hold on a pending order, then clear ──
    const followUp = page.getByTestId("order-follow-up");
    await followUp.getByRole("button", { name: "+1h" }).click();
    await expect(followUp.getByText(/Call back at/)).toBeVisible();
    await expect(followUp.getByText("1 call attempt so far")).toBeVisible();
    await followUp.getByRole("button", { name: "Clear reminder" }).click();
    await expect(followUp.getByText(/Couldn't confirm on the call/)).toBeVisible();

    // ── ORD-08 price adjustment (before any payment) ──
    const items = page.getByTestId("order-items");
    await items.getByRole("button", { name: "Adjust price" }).click();
    await items.getByLabel(/Price adjustment/).fill("-10");
    await items.getByRole("button", { name: "Save adjustment" }).click();
    await expect(items.getByText("Price adjustment")).toBeVisible();

    // ── ORD-05 status: only legal moves are offered; consequences shown before confirming ──
    await detail.getByRole("button", { name: "Change status" }).click();
    const menu = page.getByRole("menu", { name: `Move ${orderNumber} to` });
    await expect(menu.getByRole("menuitem", { name: "Confirmed" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Refunded" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Returned" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await detail.getByRole("button", { name: "Mark as Confirmed" }).click();
    await expect(dialog(page).getByText(/order confirmed.*SMS/)).toBeVisible();
    await dialog(page).getByLabel("Note for the timeline (optional)").fill("e2e: confirmed on call");
    await dialog(page).getByRole("button", { name: "Move to Confirmed" }).click();
    await expect(detail.getByText("Confirmed").first()).toBeVisible();
    await expect(page.getByTestId("order-timeline").getByText("e2e: confirmed on call")).toBeVisible();

    // The server rejects an illegal transition even if the UI is bypassed.
    const illegal = await adminFetch(page, `/api/orders/${orderId}/status`, "PATCH", { status: "REFUNDED" });
    expect(illegal.status).toBe(400);

    // ── ORD-11 / ORD-12 manual payment, then ORD-10 refund — figures come from the ledger ──
    const payments = page.getByTestId("order-payments");
    await payments.getByRole("button", { name: "Record a payment" }).click();
    await payments.getByLabel("Method").fill("bKash");
    await payments.getByRole("button", { name: "Record payment" }).click();
    await expect(payments.getByText(/\+.*Recorded by staff/)).toBeVisible();
    await expect(page.getByTestId("order-items").getByRole("button", { name: /Adjust price|Edit price adjustment/ })).toHaveCount(0); // paid → locked

    await payments.getByRole("button", { name: "Record a refund" }).click();
    await payments.getByLabel(/^Amount/).fill("5");
    await payments.getByLabel("Reason").fill("e2e partial refund");
    await payments.getByRole("button", { name: "Record refund" }).click();
    await dialog(page).getByRole("button", { name: "Record refund" }).click();
    await expect(payments.getByText("e2e partial refund")).toBeVisible();

    // ── ORD-13 courier: the provider guard refuses the real call in this environment ──
    const delivery = page.getByTestId("order-delivery");
    await delivery.getByRole("button", { name: /Book with/ }).click();
    await dialog(page).getByRole("button", { name: "Book courier" }).click();
    await expect(page.getByText(/blocked|Failed to book/i).first()).toBeVisible();
    await expect(delivery.getByText("Not booked with a courier yet.")).toBeVisible();

    // ── ORD-18 invoice ──
    const invoice = await page.context().newPage();
    await invoice.goto(`/admin/orders/${orderId}/invoice`);
    await expect(invoice.getByText(orderNumber).first()).toBeVisible();
    await invoice.close();

    // ── ORD-19 label: print-labels page receives the order ──
    await detail.getByRole("button", { name: "Label" }).click();
    await expect(page).toHaveURL(/\/admin\/orders\/print-labels/);
    await expect(page.getByText(orderNumber).first()).toBeVisible({ timeout: 20_000 });

    // ── ORD-14 / ORD-15 bulk: trash, restore, trash, delete permanently (typed confirmation) ──
    await page.goto("/admin/orders");
    await page.getByRole("searchbox", { name: "Search orders" }).fill(orderNumber);
    // Wait for the debounced search to apply — a filter change clears the selection by design.
    await expect(page.getByRole("button", { name: `Remove filter “${orderNumber}”` })).toBeVisible();
    await expect(page.locator('[data-testid="order-row"]:visible')).toHaveCount(1);
    const row = page.locator('[data-testid="order-row"]:visible', { hasText: orderNumber });
    await expect(row).toHaveCount(1);
    await row.getByRole("checkbox").check();
    const bar = page.getByRole("region", { name: /Actions for 1 selected orders/ });
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: "Trash" }).click();
    await dialog(page).getByRole("button", { name: "Move to Trash" }).click();
    await expect(page.getByText(/1 order\(s\) moved to trash/i)).toBeVisible();

    await page.getByRole("button", { name: "Trash", exact: true }).first().click();
    const trashed = page.locator('[data-testid="order-row"]:visible', { hasText: orderNumber });
    await expect(trashed).toHaveCount(1);
    await trashed.getByRole("checkbox").check();
    await page.getByRole("region", { name: /Actions for 1 selected/ }).getByRole("button", { name: "Restore" }).click();
    await dialog(page).getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(/1 order\(s\) restored/i)).toBeVisible();

    // Back to active, trash again from the row menu, then delete permanently from Trash.
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await page.locator('[data-testid="order-row"]:visible', { hasText: orderNumber }).getByRole("button", { name: `Actions for ${orderNumber}` }).click();
    await page.getByRole("button", { name: "Move to Trash" }).click();
    await dialog(page).getByRole("button", { name: "Move to Trash" }).click();
    await page.getByRole("button", { name: "Trash", exact: true }).first().click();
    await page.locator('[data-testid="order-row"]:visible', { hasText: orderNumber }).getByRole("button", { name: `Actions for ${orderNumber}` }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    const confirmDelete = dialog(page).getByRole("button", { name: "Delete forever" });
    await expect(confirmDelete).toBeDisabled();
    await dialog(page).getByRole("textbox").fill(orderNumber);
    await confirmDelete.click();
    await expect(page.getByText(`${orderNumber} permanently deleted`)).toBeVisible();
    expect((await adminFetch(page, `/api/orders/${orderId}`, "GET")).status).toBe(404);
  });

  test("return requests: status filter and deep link", async ({ page }) => {
    await page.goto("/admin/return-requests?status=ALL");
    await expect(page.getByRole("heading", { name: "Return Requests" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Filter by review status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All", pressed: true })).toBeVisible();
  });

  test("responsive: cards below xl, no horizontal page scroll", async ({ page }) => {
    await page.goto("/admin/orders");
    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
    const width = page.viewportSize()!.width;
    if (width < 1280) await expect(page.locator('[data-testid="order-card"]:visible').first()).toBeVisible();
    else await expect(page.locator('[data-testid="order-row"]:visible').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The drawer opens from a row/card and steps to the next order.
    await page.locator('[data-testid="order-row"]:visible, [data-testid="order-card"]:visible').first().getByRole("button").first().click();
    await expect(page.getByTestId("order-detail")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Order details" })).toBeVisible();
    await page.getByRole("button", { name: "Next order" }).click();
    await expect(page.getByTestId("order-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Order details" })).toHaveCount(0);
  });
});
