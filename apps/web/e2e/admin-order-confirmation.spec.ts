import { test, expect, type Page } from "@playwright/test";

// Order Operations plan, phase 3 — the confirmation call panel end to end. "Will confirm later" sets a callback and the
// order stays Pending; four unanswered calls escalate it (never cancel); the owner's "One more try" lifts it; Confirmed
// moves it through the normal transition; "Take next call" claims an order and opens it. The spec places its own orders.

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

async function pendingOrder(page: Page, name: string) {
  const { body: catalog } = await adminFetch(page, "/api/products/storefront?pageSize=60", "GET");
  const items = (catalog?.items ?? []) as Array<{ trackInventory: boolean; variants: Array<{ id: string; stock: number; isActive?: boolean }> }>;
  const variant = items.flatMap((p) => p.variants.filter((v) => v.isActive !== false && (!p.trackInventory || v.stock >= 3)))[0];
  expect(variant, "a product with stock").toBeTruthy();
  const res = await adminFetch(
    page,
    "/api/orders/admin",
    "POST",
    {
      items: [{ variantId: variant!.id, quantity: 1 }],
      customerName: name,
      customerPhone: "01712345671",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Uttara",
      shippingAddressLine: "House 7, Road 8 (Playwright)",
      paymentMethod: "COD",
    },
    { "Idempotency-Key": `pw-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  );
  const order = res.body?.order as { id: string; orderNumber: string } | undefined;
  expect(order, JSON.stringify(res.body)).toBeTruthy();
  return order!;
}

const panel = (page: Page) => page.getByTestId("order-call-panel");
const outcome = (page: Page, name: string) => panel(page).getByRole("group", { name: "What happened on the call?" }).getByRole("button", { name });

test.describe("customer confirmation calls", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("callback, unanswered calls, escalation, one more try, confirmed", async ({ page }) => {
    test.setTimeout(120_000);
    const order = await pendingOrder(page, `Caller ${Date.now().toString(36)}`);
    try {
      await page.goto(`/admin/orders/${order.id}`);
      await expect(panel(page)).toContainText("Not called yet");

      // "Will confirm later" needs a time; it schedules a callback and the order stays Pending.
      await outcome(page, "Will confirm later").click();
      await panel(page).getByRole("button", { name: "Tomorrow 18:00" }).click();
      await panel(page).getByRole("textbox", { name: "Call note" }).fill("will ask her husband");
      await panel(page).getByRole("button", { name: "Save call" }).click();
      await expect(panel(page).getByTestId("call-callback")).toContainText("Next call");
      await expect(panel(page).getByTestId("call-attempt").first()).toContainText("Will confirm later");
      expect((await adminFetch(page, `/api/orders/${order.id}`, "GET")).body?.order).toMatchObject({ status: "PENDING" });

      // Four unanswered calls → escalated; nothing cancelled.
      for (const name of ["No answer", "Phone off", "Busy", "No answer"]) {
        await outcome(page, name).click();
        await expect(panel(page)).toContainText(/unanswered/);
      }
      await expect(panel(page).getByTestId("call-escalated")).toContainText(/not reached after every try/i);
      expect((await adminFetch(page, `/api/orders/${order.id}`, "GET")).body?.order).toMatchObject({ status: "PENDING" });

      // The owner gives it one more try (reason required), then the customer confirms.
      await panel(page).getByRole("textbox", { name: "Reason for the decision" }).fill("customer messaged on Facebook");
      await panel(page).getByRole("button", { name: "One more try" }).click();
      await expect(panel(page).getByTestId("call-escalated")).toHaveCount(0);
      await outcome(page, "Confirmed").click();
      await expect.poll(async () => ((await adminFetch(page, `/api/orders/${order.id}`, "GET")).body?.order as { status: string }).status).toBe("CONFIRMED");
      await expect(panel(page).getByTestId("call-attempt").first()).toContainText("Confirmed");
      await expect(panel(page).getByTestId("call-attempt")).toHaveCount(6);
    } finally {
      await adminFetch(page, `/api/orders/${order.id}`, "DELETE");
      await adminFetch(page, `/api/orders/${order.id}/permanent`, "DELETE");
    }
  });

  test("Take next call claims an order and opens it; Declined cancels with a reason", async ({ page }) => {
    const order = await pendingOrder(page, `Next ${Date.now().toString(36)}`);
    try {
      await page.goto("/admin/orders?f.queue=callNow");
      await page.getByTestId("take-next-call").click();
      await expect.poll(() => new URL(page.url()).searchParams.get("open")).toBeTruthy();
      const claimed = new URL(page.url()).searchParams.get("open")!;
      const state = await adminFetch(page, `/api/orders/${claimed}/confirmation`, "GET");
      expect(state.body?.claimedBy).toBeTruthy();
      // Hand it back (it may be another suite's order), then decline our own.
      await adminFetch(page, `/api/orders/${claimed}/confirmation/release`, "POST");

      await page.goto(`/admin/orders/${order.id}`);
      await outcome(page, "Declined").click();
      const save = panel(page).getByRole("button", { name: "Cancel the order" });
      await expect(save).toBeDisabled();
      await panel(page).getByRole("textbox", { name: "Call note" }).fill("ordered by mistake");
      await save.click();
      await expect.poll(async () => ((await adminFetch(page, `/api/orders/${order.id}`, "GET")).body?.order as { status: string }).status).toBe("CANCELLED");
    } finally {
      await adminFetch(page, `/api/orders/${order.id}`, "DELETE");
      await adminFetch(page, `/api/orders/${order.id}/permanent`, "DELETE");
    }
  });
});
