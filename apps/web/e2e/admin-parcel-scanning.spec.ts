import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";

// Order Operations plan, phase 4 — dispatch and return scanning in the browser. A USB keyboard-wedge scanner is a fast
// keyboard: each code is typed in a burst and ends with Enter, so the spec types them the same way. Twenty fast scans are
// all kept; duplicates and unknown codes get their own answer; confirming records the handover; a scan made offline waits
// visibly and Confirm stays off until the server has judged it; a return scan leaves stock alone until inspection.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";
const apiDir = resolve(__dirname, "../../api");

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

async function placeOrders(page: Page, count: number): Promise<string[]> {
  const { body: catalog } = await adminFetch(page, "/api/products/storefront?pageSize=60", "GET");
  const items = (catalog?.items ?? []) as Array<{ trackInventory: boolean; variants: Array<{ id: string; stock: number; isActive?: boolean }> }>;
  const units = items.flatMap((p) => p.variants.filter((v) => v.isActive !== false).flatMap((v) => Array.from({ length: p.trackInventory ? Math.max(0, v.stock - 2) : count }, () => v.id)));
  expect(units.length).toBeGreaterThanOrEqual(count);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const res = await adminFetch(
      page,
      "/api/orders/admin",
      "POST",
      {
        items: [{ variantId: units[i], quantity: 1 }],
        customerName: `Scan ${i}`,
        customerPhone: "01712345672",
        shippingDivision: "Dhaka",
        shippingDistrict: "Dhaka",
        shippingArea: "Uttara",
        shippingAddressLine: "House 9, Road 10 (Playwright)",
        paymentMethod: "COD",
        confirmNow: true,
      },
      { "Idempotency-Key": `pw-scan-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}` },
    );
    ids.push((res.body?.order as { id: string }).id);
  }
  return ids;
}

/** Booked with the courier, as a real booking leaves them (test database only — scripts/e2e/mark-booked.ts). */
function markBooked(ids: string[]): Record<string, string> {
  const out = execSync(`npx tsx scripts/with-test-db.ts npx tsx scripts/e2e/mark-booked.ts ${ids.join(" ")}`, { cwd: apiDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out.trim().split("\n").reverse().find((l) => l.startsWith("{"))!);
}

async function wedgeScan(page: Page, code: string) {
  // A wedge scanner types the whole code in a few milliseconds and presses Enter.
  await page.keyboard.type(code, { delay: 2 });
  await page.keyboard.press("Enter");
}

async function cleanup(page: Page, ids: string[]) {
  for (const id of ids) {
    await adminFetch(page, `/api/orders/${id}`, "DELETE");
    await adminFetch(page, `/api/orders/${id}/permanent`, "DELETE");
  }
}

test.describe("parcel scanning", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // The station resumes this admin's open batch — start each test from a clean one.
    for (const kind of ["DISPATCH", "RETURN"]) {
      const open = (await adminFetch(page, `/api/parcel-scans/batches/current?kind=${kind}`, "GET")).body?.batch as { id: string } | null;
      if (open) await adminFetch(page, `/api/parcel-scans/batches/${open.id}/cancel`, "POST");
    }
  });

  test("dispatch: twenty fast wedge scans, a duplicate, an unknown code, confirm, re-scan", async ({ page }) => {
    test.setTimeout(180_000);
    const ids = await placeOrders(page, 20);
    try {
      const codes = Object.values(markBooked(ids));
      await page.goto("/admin/orders/dispatch");
      await expect(page.getByTestId("scan-input")).toBeFocused();

      for (const code of codes) await wedgeScan(page, code);
      await wedgeScan(page, codes[0]!);
      await wedgeScan(page, "NOT-OUR-CODE-0001");
      await expect(page.locator('[data-testid="scan-row"][data-result="ACCEPTED"]')).toHaveCount(20, { timeout: 30_000 });
      await expect(page.locator('[data-testid="scan-row"][data-result="DUPLICATE"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="scan-row"][data-result="INVALID"]')).toHaveCount(1);
      await expect(page.getByTestId("scan-feedback")).toHaveAttribute("data-tone", "error");

      await page.getByTestId("confirm-batch").click();
      await expect(page.getByRole("status").filter({ hasText: "Handed to the courier: 20 parcels" })).toBeVisible();
      for (const id of [ids[0]!, ids[19]!]) {
        const order = (await adminFetch(page, `/api/orders/${id}`, "GET")).body?.order as { status: string; handedOverAt: string | null };
        expect(order.handedOverAt).toBeTruthy();
        expect(order.status).toBe("SHIPPED"); // a scan never moves the status
      }
      // The same parcel again, in a new batch: already handed over — who and when.
      await expect(page.getByTestId("scan-input")).toBeFocused();
      await wedgeScan(page, codes[5]!);
      await expect(page.locator('[data-testid="scan-row"][data-result="ALREADY_PROCESSED"]')).toHaveCount(1);
      await expect(page.getByTestId("scan-feedback")).toContainText("was handed over");
    } finally {
      await cleanup(page, ids);
    }
  });

  test("offline: the scan waits on the device, Confirm stays off, then it is judged when back online", async ({ page, context }) => {
    const ids = await placeOrders(page, 1);
    try {
      const [code] = Object.values(markBooked(ids));
      await page.goto("/admin/orders/dispatch");
      await expect(page.getByTestId("scan-input")).toBeFocused();
      await context.setOffline(true);
      await wedgeScan(page, code!);
      await expect(page.locator('[data-testid="scan-row"][data-result="PENDING"]')).toHaveCount(1);
      await expect(page.getByTestId("scan-feedback")).toHaveAttribute("data-tone", "waiting");
      await expect(page.getByTestId("confirm-batch")).toBeDisabled();
      await context.setOffline(false);
      await expect(page.locator('[data-testid="scan-row"][data-result="ACCEPTED"]')).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByTestId("confirm-batch")).toBeEnabled();
      await page.getByTestId("confirm-batch").click();
      await expect(page.getByRole("status").filter({ hasText: "Handed to the courier: 1 parcel" })).toBeVisible();
    } finally {
      await cleanup(page, ids);
    }
  });

  test("returns in: a refused parcel is received by scan; stock waits for inspection", async ({ page }) => {
    const ids = await placeOrders(page, 1);
    try {
      const [code] = Object.values(markBooked(ids));
      const id = ids[0]!;
      expect((await adminFetch(page, `/api/orders/${id}/status`, "PATCH", { status: "CANCELLED", note: "Customer refused the parcel (Playwright)" })).status).toBe(200);
      await page.goto("/admin/orders/returns-in");
      await expect(page.getByTestId("scan-input")).toBeFocused();
      // Focus knocked off the scan box (a click on the page): the scanner's burst still lands in the box and fires no
      // shortcut ("N" would otherwise open New order).
      await page.getByRole("heading", { name: "Returns in" }).click();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await wedgeScan(page, code!);
      await expect(page).toHaveURL(/\/admin\/orders\/returns-in/);
      await expect(page.locator('[data-testid="scan-row"][data-result="ACCEPTED"]')).toHaveCount(1);
      await page.getByTestId("confirm-batch").click();
      await expect(page.getByRole("status").filter({ hasText: "Received back" })).toBeVisible();
      const order = (await adminFetch(page, `/api/orders/${id}`, "GET")).body?.order as { receivedBackAt: string | null; status: string; items: Array<{ restockedQuantity: number }> };
      expect(order.receivedBackAt).toBeTruthy();
      expect(order.status).toBe("CANCELLED");
      expect(order.items[0]!.restockedQuantity).toBe(0); // not sellable until inspected
    } finally {
      await cleanup(page, ids);
    }
  });
});
