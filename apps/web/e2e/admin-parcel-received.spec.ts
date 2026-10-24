import { test, expect, type Page } from "@playwright/test";

// A parcel cancelled after it shipped comes back: staff mark per item what came back and what is damaged, right on the
// order page (Delivery & courier). Only the good units go back into stock. The spec makes its own order through the admin
// API and removes it at the end.

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

/** An admin API call with the session cookie and CSRF header. */
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

/** A 2-unit COD order, shipped and then cancelled: its parcel is on the way back. */
async function parcelComingBack(page: Page) {
  const { body: catalog } = await adminFetch(page, "/api/products/storefront?pageSize=60", "GET");
  const items = (catalog?.items ?? []) as Array<{ trackInventory: boolean; variants: Array<{ id: string; stock: number; isActive?: boolean }> }>;
  const variant = items.flatMap((p) => p.variants.filter((v) => v.isActive !== false && (!p.trackInventory || v.stock >= 3)))[0];
  expect(variant, "a product with stock to order").toBeTruthy();
  const created = await adminFetch(
    page,
    "/api/orders/admin",
    "POST",
    {
      items: [{ variantId: variant!.id, quantity: 2 }],
      customerName: "Parcel Tester",
      customerPhone: "01712345679",
      shippingDivision: "Dhaka",
      shippingDistrict: "Dhaka",
      shippingArea: "Mirpur",
      shippingAddressLine: "House 3, Road 4 (Playwright)",
      paymentMethod: "COD",
      confirmNow: true,
    },
    { "Idempotency-Key": `pw-parcel-${Date.now()}-${Math.random()}` },
  );
  const id = (created.body?.order as { id: string } | undefined)?.id;
  expect(id, "the order was created").toBeTruthy();
  for (const status of ["SHIPPED", "CANCELLED"]) {
    const res = await adminFetch(page, `/api/orders/${id}/status`, "PATCH", { status, note: "Customer refused the parcel (Playwright)" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return id!;
}

test.describe("parcel received back", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("marks one unit damaged on the order page; only the good one is restocked", async ({ page }, info) => {
    const id = await parcelComingBack(page);
    try {
      await page.goto(`/admin/orders/${id}`);
      const card = page.getByTestId("parcel-coming-back");
      await expect(card).toBeVisible();
      // Defaults: everything came back, nothing damaged — the common case stays one tap.
      await expect(card.getByTestId("parcel-received")).toHaveText(/Receive — 2 good/);

      await card.getByRole("button", { name: /Damaged units of .*: one more/ }).click();
      await card.getByLabel("What was wrong? (optional)").fill("box crushed");
      await expect(card.getByTestId("parcel-received")).toHaveText(/Receive — 1 good, 1 damaged/);
      await page.screenshot({ path: info.outputPath(`parcel-received-${info.project.name}.png`), fullPage: true });

      // Nothing on the page scrolls sideways (375-wide phones included).
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      await card.getByTestId("parcel-received").click();
      await expect(page.getByText("Parcel received — good units are back in stock, the rest written off")).toBeVisible();
      await expect(page.getByTestId("parcel-coming-back")).toHaveCount(0);
      await expect(page.getByText(/Parcel received back — 1 good, 1 damaged \(box crushed\)/).first()).toBeVisible();
    } finally {
      await adminFetch(page, `/api/orders/${id}`, "DELETE");
      await adminFetch(page, `/api/orders/${id}/permanent`, "DELETE");
    }
  });
});
