import { test, expect, type Page } from "@playwright/test";

// Tahafi smoothness budget (docs/superpowers/plans/2026-11-25-tahafi-smooth-modern.md): on a phone the Tahafi storefront
// keeps its see-through glass to the header bar and the dock, loads one photo per card, shows a one-row cookie notice
// and doesn't jump while it loads. Runs only against a Tahafi build (STORE_THEME=tahafi) with the Haven catalogue —
// the default and Nasihamart themes are other designs. Read-only: nothing is ordered or saved.

const TAHAFI = process.env.STORE_THEME === "tahafi";
const PDP = process.env.E2E_TAHAFI_PRODUCT ?? "/product/haven-full-sleeve-jacket-black";
const ONE_REVIEW_PDP = process.env.E2E_TAHAFI_ONE_REVIEW_PRODUCT ?? PDP;

test.skip(!TAHAFI, "Tahafi theme only");
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
test.setTimeout(120_000);

async function declineTracking(page: Page) {
  await page.addInitScript(() => localStorage.setItem("az_tracking_consent_v1", "denied"));
}

async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}

function blurredElements(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || s.display === "none") return false;
        const f = s.backdropFilter || (s as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || "none";
        return f !== "none";
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`),
  );
}

for (const path of ["/", "/category/jackets", PDP]) {
  test(`blur budget on ${path}`, async ({ page }) => {
    await declineTracking(page);
    await page.goto(path, { waitUntil: "networkidle" });
    await scrollThrough(page);
    const blurred = await blurredElements(page);
    expect(blurred.length, blurred.join("\n")).toBeLessThanOrEqual(6);
  });
}

test("phone cards load one photo each", async ({ page }) => {
  await declineTracking(page);
  const photos = new Set<string>();
  page.on("request", (r) => {
    if (r.resourceType() === "image" && r.url().includes("/_next/image")) photos.add(new URL(r.url()).searchParams.get("url") ?? r.url());
  });
  await page.goto("/category/jackets", { waitUntil: "networkidle" });
  await scrollThrough(page);
  await page.waitForLoadState("networkidle");
  const cards = await page.locator("[data-nav-pending-scope]").count();
  expect(cards).toBeGreaterThan(0);
  // One photo per card, plus a little room for the header logo and a category tile.
  expect(photos.size).toBeLessThanOrEqual(cards + 2);
});

test("cookie notice is one row", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const notice = page.getByRole("dialog", { name: "Tracking preferences" });
  await expect(notice).toBeVisible();
  const box = await notice.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(64);
  await expect(notice.getByRole("button", { name: "Decline" })).toBeVisible();
});

test("product page doesn't jump while it loads", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(PDP, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.02);
});

test("product page: no size nag before a tap, no quantity stepper", async ({ page }) => {
  await declineTracking(page);
  await page.goto(PDP, { waitUntil: "networkidle" });
  await expect(page.getByText(/Please select a size/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  // Without a size, the options sheet asks for one.
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Size" }).first().getByRole("button", { name: "L", exact: true }).click();
  await expect(page.getByRole("button", { name: "Increase quantity" })).toHaveCount(0);
});

test("a product with few reviews shows no five-bar chart", async ({ page }) => {
  await declineTracking(page);
  await page.goto(ONE_REVIEW_PDP, { waitUntil: "networkidle" });
  await page.locator("#reviews").scrollIntoViewIfNeeded();
  // The reviews have loaded (the summary, not the "No reviews yet" line), and still no bars.
  await expect(page.locator("#reviews").getByText(/^Based on \d+ reviews?$/)).toBeVisible();
  await expect(page.locator("#reviews").getByText("4 star")).toHaveCount(0);
});

test("card photo glides into the product page", async ({ page }) => {
  await declineTracking(page);
  await page.goto("/category/jackets", { waitUntil: "networkidle" });
  const supported = await page.evaluate(() => typeof document.startViewTransition === "function");
  test.skip(!supported, "browser without view transitions");
  await page.evaluate(() => {
    (window as unknown as { __vt: number }).__vt = 0;
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = ((arg: Parameters<typeof original>[0]) => {
      (window as unknown as { __vt: number }).__vt++;
      return original(arg);
    }) as typeof document.startViewTransition;
  });
  await page.locator("[data-nav-pending-scope] a[href^='/product/']").first().click();
  await expect(page.locator("h1")).toBeVisible({ timeout: 5000 });
  expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBeGreaterThan(0);
});
