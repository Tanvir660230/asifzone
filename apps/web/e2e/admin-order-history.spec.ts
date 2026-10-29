import { test, expect, type Page } from "@playwright/test";

// Order history: a finished order (here: cancelled before booking, nothing paid) leaves the daily work list and is found
// on its own page by order number or phone; the page is read-only (no selection, no Trash, no status moves); the order
// says where it is. The work list's queue views ask the server for their queue (a regression: Call now / parcel queues
// were sent without their filter, so the list showed every order under the queue's badge).

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

async function cancelledOrder(page: Page, phone: string) {
  const { body: catalog } = await adminFetch(page, "/api/products/storefront?pageSize=60", "GET");
  const items = (catalog?.items ?? []) as Array<{ trackInventory: boolean; variants: Array<{ id: string; stock: number; isActive?: boolean }> }>;
  const variant = items.flatMap((p) => p.variants.filter((v) => v.isActive !== false && (!p.trackInventory || v.stock > 2)))[0]!;
  const res = await adminFetch(
    page,
    "/api/orders/admin",
    "POST",
    {
      items: [{ variantId: variant.id, quantity: 1 }],
      customerName: "History Check",
      customerPhone: phone,
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 9, Road 10 (Playwright)",
      paymentMethod: "COD",
    },
    { "Idempotency-Key": `pw-history-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  );
  const order = res.body?.order as { id: string; orderNumber: string };
  expect((await adminFetch(page, `/api/orders/${order.id}/status`, "PATCH", { status: "CANCELLED", note: "Customer changed their mind (Playwright)" })).status).toBe(200);
  return order;
}

test.describe("order history", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("a finished order leaves the work list and is found, read-only, in Order history", async ({ page }) => {
    const phone = `017${String(Date.now()).slice(-8)}`;
    const order = await cancelledOrder(page, phone);
    try {
      // The work list's Cancelled tab (no search) no longer lists it, and says where finished orders are.
      await page.goto("/admin/orders?f.status=CANCELLED");
      await expect(page.getByTestId("orders-history-hint")).toBeVisible();
      await expect(page.getByRole("link", { name: "Order history" }).first()).toBeVisible();
      await expect(page.locator('[data-testid="order-row"], [data-testid="order-card"]').filter({ hasText: order.orderNumber })).toHaveCount(0);
      // A search on the work list still finds it.
      await page.goto(`/admin/orders?q=${order.orderNumber}`);
      await expect(page.locator('[data-testid="order-row"]:visible, [data-testid="order-card"]:visible').filter({ hasText: order.orderNumber })).toHaveCount(1);

      // Order history, by phone: listed, no selection boxes, no Trash.
      await page.goto(`/admin/orders/history?q=${phone}`);
      await expect(page.getByRole("heading", { name: "Order history" })).toBeVisible();
      const row = page.locator('[data-testid="order-row"]:visible, [data-testid="order-card"]:visible').filter({ hasText: order.orderNumber });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("checkbox")).toHaveCount(0);
      await row.getByRole("button", { name: `Actions for ${order.orderNumber}` }).click();
      await expect(page.getByRole("menuitem", { name: "Invoice" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Move to Trash" })).toHaveCount(0);
      await page.keyboard.press("Escape");

      // Opened, it says it is finished and in Order history; the URL keeps the search and the open order.
      await row.getByText(order.orderNumber).first().click();
      await expect(page).toHaveURL(new RegExp(`open=${order.id}`));
      await expect(page.getByTestId("order-in-history")).toBeVisible();
    } finally {
      await adminFetch(page, `/api/orders/${order.id}`, "DELETE");
      await adminFetch(page, `/api/orders/${order.id}/permanent`, "DELETE");
    }
  });

  test("queue views send their queue to the server", async ({ page }) => {
    const callNow = page.waitForRequest((r) => r.url().includes("/api/orders?") && r.url().includes("confirmQueue=callNow"));
    await page.goto("/admin/orders?f.queue=callNow");
    await callNow;
    const coming = page.waitForRequest((r) => r.url().includes("/api/orders?") && r.url().includes("parcelQueue=comingBack"));
    await page.goto("/admin/orders?f.queue=comingBack");
    await coming;
    // The plain work list asks for the work scope; a queue view doesn't narrow it further.
    const work = page.waitForRequest((r) => r.url().includes("/api/orders?") && r.url().includes("scope=active"));
    await page.goto("/admin/orders");
    await work;
  });
});
