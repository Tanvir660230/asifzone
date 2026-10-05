import { test, expect, type Page } from "@playwright/test";

/** Ad-pixel acceptance (lib/pixels/): drives the real storefront flow against the REAL TikTok SDK (events.js is
 * downloaded) while intercepting every TikTok beacon locally — nothing reaches TikTok's servers. Meta's fbevents.js is
 * blocked, so its stub queue records exactly what the storefront asked Meta to track.
 *
 * Needs a build with NEXT_PUBLIC_TIKTOK_PIXEL_ID and NEXT_PUBLIC_META_PIXEL_ID set (any values work — no beacon
 * leaves the machine); skipped otherwise. Places one COD test order, like storefront-existing-products.spec.ts. */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";

interface TikTokBeacon {
  event: string;
  event_id: string;
  url: string;
  properties: Record<string, unknown>;
}

interface ApiVariant { id: string; size: string; color: string; stock: number }
interface ApiProduct { id: string; name: string; slug: string; variants: ApiVariant[] }

/** Real SDK in, every TikTok POST captured and answered locally; Meta's script blocked. */
async function interceptPixels(page: Page): Promise<TikTokBeacon[]> {
  const beacons: TikTokBeacon[] = [];
  await page.route(/tiktok\.com/, async (route) => {
    const req = route.request();
    if (req.method() === "GET" && /\.js(\?|$)/.test(req.url())) return route.continue();
    try {
      const body = JSON.parse(req.postData() ?? "{}") as { event?: string; event_id?: string; properties?: Record<string, unknown>; context?: { page?: { url?: string } } };
      if (body.event) {
        beacons.push({
          event: body.event,
          event_id: body.event_id ?? "",
          url: new URL(body.context?.page?.url ?? "http://x/").pathname,
          properties: body.properties ?? {},
        });
      }
    } catch {
      // non-JSON telemetry — not an event
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"code":0}' });
  });
  await page.route(/connect\.facebook\.net/, (route) => route.abort());
  // A failed SDK download (the one real request these tests make) shows up in the failure message as such.
  page.on("requestfailed", (req) => {
    if (/tiktok\.com/.test(req.url())) beacons.push({ event: `REQUEST FAILED (${req.failure()?.errorText})`, event_id: "", url: req.url(), properties: {} });
  });
  return beacons;
}

/** What the storefront asked Meta to track (fbq stub queue — fbevents.js never loads here). */
async function metaTracked(page: Page): Promise<{ name: string; params: Record<string, unknown>; eventID?: string }[]> {
  return page.evaluate(() => {
    const queue = ((window as unknown as { fbq?: { queue: unknown[][] } }).fbq?.queue ?? []) as unknown[][];
    return queue
      .filter((args) => args[0] === "track")
      .map((args) => ({ name: args[1] as string, params: args[2] as Record<string, unknown>, eventID: (args[3] as { eventID?: string } | undefined)?.eventID }));
  });
}

const count = (beacons: TikTokBeacon[], event: string, path?: string) =>
  beacons.filter((b) => b.event === event && (path === undefined || b.url === path)).length;

/** Lets late beacons arrive before counting — the SDK batches/defers some sends. */
const settle = (page: Page) => page.waitForTimeout(3000);

const describe = (beacons: TikTokBeacon[]) => beacons.map((b) => `${b.event} @ ${b.url}`).join(" | ");

/** Waits for the event to arrive (the SDK sends asynchronously), then gives any duplicate time to show up too. */
async function expectExactlyOnce(page: Page, beacons: TikTokBeacon[], event: string, path?: string) {
  await expect.poll(() => count(beacons, event, path), { timeout: 20_000, message: `${event} never arrived: ${describe(beacons)}` }).toBeGreaterThanOrEqual(1);
  await settle(page);
  expect(count(beacons, event, path), `${event} count — ${describe(beacons)}`).toBe(1);
}

async function pickProduct(): Promise<{ product: ApiProduct; variant: ApiVariant }> {
  const res = await fetch(`${API}/api/products/storefront?pageSize=50`);
  const items = ((await res.json()) as { items: ApiProduct[] }).items;
  const product = items.find((p) => p.variants.some((v) => v.stock > 1))!;
  return { product, variant: product.variants.find((v) => v.stock > 1)! };
}

async function chooseVariant(page: Page, product: ApiProduct, variant: ApiVariant) {
  const hasSizePicker = new Set(product.variants.map((v) => v.size)).size > 1 || variant.size !== "Standard";
  if (hasSizePicker && variant.size !== "Standard") await page.getByRole("button", { name: variant.size, exact: true }).first().click();
  if (variant.color) await page.getByRole("button", { name: variant.color, exact: true }).first().click();
}

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

test.beforeEach(async ({ page }) => {
  // Fence first: no TikTok/Meta request may leave the machine, even from this setup visit.
  await page.route(/tiktok\.com/, (route) =>
    route.request().method() === "GET" && /\.js(\?|$)/.test(route.request().url())
      ? route.continue()
      : route.fulfill({ status: 200, contentType: "application/json", body: '{"code":0}' }),
  );
  await page.route(/connect\.facebook\.net/, (route) => route.abort());
  await page.goto("/");
  const configured = await page
    .waitForFunction(() => Boolean((window as unknown as { ttq?: unknown }).ttq), undefined, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!configured, "build has no NEXT_PUBLIC_TIKTOK_PIXEL_ID — nothing to verify");
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  // Leave the setup page so the SDK flushes whatever it still has queued (it sends some beacons late, or on unload)
  // into the setup fence above — not into the next test's capture.
  await page.goto("about:blank");
  await page.waitForTimeout(1000);
});

test("full funnel: each event exactly once, with real data, shared event ids, no repeat Purchase", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const beacons = await interceptPixels(page);
  const { product, variant } = await pickProduct();

  // Test 1 — home: one PageView.
  await page.goto("/");
  await expectExactlyOnce(page, beacons, "Pageview", "/");
  expect((await metaTracked(page)).filter((e) => e.name === "PageView")).toHaveLength(1);

  // Test 2 + 8 — SPA navigation to the product: one PageView for the new page, one ViewContent.
  const productPath = `/product/${product.slug}`;
  // Next's own client router (what every <Link> uses) — a real SPA navigation, no document reload.
  await page.evaluate((href) => {
    (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
    (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(href);
  }, productPath);
  await page.waitForURL((u) => u.pathname === productPath);
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true); // no reload
  await expectExactlyOnce(page, beacons, "Pageview", productPath);
  await expectExactlyOnce(page, beacons, "ViewContent");
  expect(count(beacons, "Pageview", "/")).toBe(1);
  const viewContent = beacons.find((b) => b.event === "ViewContent")!;
  expect(viewContent.properties).toMatchObject({ content_type: "product_group", currency: "BDT" });
  expect((viewContent.properties.contents as { content_id: string }[])[0]!.content_id).toBe(product.id);
  const metaViewContent = (await metaTracked(page)).filter((e) => e.name === "ViewContent");
  expect(metaViewContent).toHaveLength(1);
  expect(metaViewContent[0]!.eventID).toBe(viewContent.event_id); // one business event, one id on both platforms

  // Test 3 — AddToCart only after the cart actually changed, with the variant + quantity that landed.
  await chooseVariant(page, product, variant);
  expect(count(beacons, "AddToCart")).toBe(0);
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await expect(page.getByText(/added to cart/i).first()).toBeVisible();
  await expectExactlyOnce(page, beacons, "AddToCart");
  const addToCart = beacons.find((b) => b.event === "AddToCart")!;
  expect(addToCart.properties).toMatchObject({ content_type: "product", currency: "BDT" });
  expect(addToCart.properties.contents).toEqual([expect.objectContaining({ content_id: variant.id, quantity: 1, content_name: product.name })]);

  // Test 4 — InitiateCheckout once; a refresh of the same checkout doesn't repeat it.
  await page.goto("/checkout");
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expectExactlyOnce(page, beacons, "InitiateCheckout");
  await page.reload();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await settle(page);
  expect(count(beacons, "InitiateCheckout")).toBe(1);

  // Test 5 — AddPaymentInfo once the server accepted the order; no payment fields in it.
  await page.getByLabel("Full name").fill("E2E Pixel Shopper");
  await page.getByLabel("Phone").fill("01712345679");
  await page.getByLabel("District").fill("Dhaka");
  await page.getByRole("option", { name: "Dhaka", exact: true }).first().click();
  await page.getByLabel("Area / Thana").fill("Dhanmondi");
  await page.getByRole("option", { name: /Dhanmondi/ }).first().click();
  await page.getByLabel("House / Road / Details").fill("House 1, Road 2 (automated pixel test order)");
  await page.getByLabel("Cash on Delivery").check();
  expect(count(beacons, "AddPaymentInfo")).toBe(0);
  await page.getByRole("button", { name: /^Place Order/ }).click();

  // Test 6 — Purchase once, from the verified order.
  await expect(page).toHaveURL(/\/order-confirmation\/.+/, { timeout: 30_000 });
  const orderNumber = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  await expect(page.getByText(product.name).first()).toBeVisible();
  await expectExactlyOnce(page, beacons, "AddPaymentInfo");
  const addPaymentInfo = beacons.find((b) => b.event === "AddPaymentInfo")!;
  expect(JSON.stringify(addPaymentInfo.properties)).not.toMatch(/COD|card|cvv|otp|password|phone|0171/i);
  await expectExactlyOnce(page, beacons, "Purchase");
  const purchase = beacons.find((b) => b.event === "Purchase")!;
  expect(purchase.event_id).toBe(`purchase_${orderNumber}`);
  expect(purchase.properties).toMatchObject({ order_id: orderNumber, currency: "BDT", content_type: "product" });
  expect(purchase.properties.contents).toEqual([expect.objectContaining({ content_id: variant.id, quantity: 1, content_name: product.name })]);
  expect(typeof purchase.properties.value).toBe("number");
  expect(JSON.stringify(purchase.properties)).not.toMatch(/E2E Pixel Shopper|01712345679|Dhanmondi/);
  const metaPurchase = (await metaTracked(page)).filter((e) => e.name === "Purchase");
  expect(metaPurchase).toHaveLength(1);
  expect(metaPurchase[0]!.eventID).toBe(`purchase_${orderNumber}`);

  // Test 7 — refresh and revisit of the success page: still exactly one Purchase.
  await page.reload();
  await expect(page.getByText(product.name).first()).toBeVisible();
  await settle(page);
  await page.goto("/");
  await page.goBack();
  await expect(page).toHaveURL(/\/order-confirmation\//);
  await expect(page.getByText(orderNumber).first()).toBeVisible();
  await settle(page);
  expect(count(beacons, "Purchase")).toBe(1);

  // Nothing fired more than the flow warrants.
  expect(count(beacons, "AddToCart")).toBe(1);
  expect(count(beacons, "ViewContent")).toBe(1);
  expect(errors).toEqual([]);
});

test("Search fires once per query with search_string", async ({ page }) => {
  const beacons = await interceptPixels(page);
  await page.goto("/search?q=shirt");
  await expectExactlyOnce(page, beacons, "Search");
  // toMatchObject: on mobile the SDK appends its own device fields (android_version, device_model).
  expect(beacons.find((b) => b.event === "Search")!.properties).toMatchObject({ search_string: "shirt" });
});

test("admin pages never load or fire the pixels", async ({ page }) => {
  const beacons = await interceptPixels(page);
  await page.goto("/admin/login");
  await settle(page);
  expect(beacons, describe(beacons)).toHaveLength(0);
  expect(await page.evaluate(() => Boolean((window as unknown as { ttq?: unknown }).ttq))).toBe(false);
});

test("Test 10 — TikTok and Meta blocked (ad blocker): the storefront and add-to-cart keep working", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.route(/tiktok\.com|facebook\.net/, (route) => route.abort("blockedbyclient"));
  const { product, variant } = await pickProduct();

  await page.goto(`/product/${product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
  await chooseVariant(page, product, variant);
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await expect(page.getByText(/added to cart/i).first()).toBeVisible();
  await page.goto("/checkout");
  await expect(page.getByLabel("Full name")).toBeVisible();
  expect(errors).toEqual([]);
});
