import { expect, test, type Page } from "@playwright/test";

// Phase 5: one storefront, store-specific everything else. Data-agnostic — runs against any store's database — and every
// change it makes through the admin API is restored afterwards.
//   1. Navigation: category names never wrap; what doesn't fit is in "More", reachable by keyboard.
//   2. Category grid: up to 4 columns, fewer as the viewport narrows.
//   3. Store policy is configuration: the product page, FAQ and structured data follow the store's settings.
//   4. Every store image is replaceable through the admin's normal upload pipeline and shows on the storefront.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

/** A request from the logged-in OWNER's own session (credentials + CSRF), as the admin UI makes it. */
async function adminApi<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ({ api, method, path, body }) => {
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
      const res = await fetch(`${api}${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
    },
    { api: API, method, path, body },
  ) as Promise<{ status: number; json: T }>;
}

/** Uploads a freshly drawn PNG (a distinct colour each call) through an admin upload endpoint, exactly as a file input does. */
async function uploadPng(page: Page, path: string, field = "image"): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(
    async ({ api, path, field }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 40% 70%)`;
      ctx.fillRect(0, 0, 640, 640);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      const form = new FormData();
      form.append(field, new File([blob], "e2e-asset.png", { type: "image/png" }));
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
      const res = await fetch(`${api}${path}`, { method: "POST", credentials: "include", headers: { "X-CSRF-Token": csrf }, body: form });
      return { status: res.status, json: await res.json() };
    },
    { api: API, path, field },
  );
}

/** An image's bytes, read now — settings delete a replaced logo/favicon file, so the original must be captured before it
 * is replaced and restored by uploading the same image again (never by URL). */
async function capture(page: Page, url: string): Promise<{ base64: string; type: string }> {
  const res = await page.request.get(url);
  expect(res.status(), `capture ${url}`).toBe(200);
  return { base64: (await res.body()).toString("base64"), type: res.headers()["content-type"] ?? "image/png" };
}

/** Uploads captured image bytes through an admin upload endpoint and returns the new reference. */
async function reupload(page: Page, image: { base64: string; type: string }, path: string): Promise<string> {
  const res = await page.evaluate(
    async ({ api, image, path }) => {
      const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.append("image", new File([bytes], "restore", { type: image.type }));
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] ?? "";
      const r = await fetch(`${api}${path}`, { method: "POST", credentials: "include", headers: { "X-CSRF-Token": csrf }, body: form });
      return { status: r.status, json: await r.json() };
    },
    { api: API, image, path },
  );
  expect(res.status, `restore via ${path}`).toBe(201);
  return res.json.url as string;
}

/** The storage key of a stored reference (`/uploads/products/x-full.webp` → `products/x-full.webp`). */
const keyOf = (ref: string) => ref.replace(/^.*\/uploads\//, "");

/** Polls a storefront page until its HTML contains `needle` (the storefront's data cache revalidates on save). */
async function expectPageToContain(page: Page, path: string, needle: string) {
  await expect.poll(async () => (await page.goto(path), await page.content()).includes(needle), { timeout: 30_000 }).toBe(true);
}

test.describe("navigation and category grid (shared layout)", () => {
  test("category names never wrap; overflow is in an accessible More menu", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "desktop navigation");
    const { tree } = (await (await page.request.get(`${API}/api/categories/tree`)).json()) as { tree: { name: string }[] };
    test.skip(tree.length === 0, "store has no categories");

    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const nav = page.getByRole("navigation", { name: "Categories" });
      const links = nav.locator(":scope > ul > li > a");
      await expect(links.first()).toBeVisible();
      // One line each: every top-level link is as tall as the shortest one.
      const heights = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights), `wrapped label at ${width}px`).toBeLessThan(2);

      const more = nav.getByRole("button", { name: "More" });
      let inMore = 0;
      if (await more.isVisible()) {
        await more.focus();
        await page.keyboard.press("Enter");
        await expect(more).toHaveAttribute("aria-expanded", "true");
        inMore = await nav.locator(`[id="${await more.getAttribute("aria-controls")}"] > ul > li > a`).count();
        expect(inMore).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        await expect(more).toHaveAttribute("aria-expanded", "false");
        await expect(more).toBeFocused();
      }
      expect(heights.length + inMore, `every category reachable at ${width}px`).toBe(tree.length);
    }
  });

  test("the category grid shows up to 4 columns, fewer on narrower screens", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "viewport sizes are set explicitly");
    await page.goto("/");
    const grid = page.locator(".ui-tile-grid").first();
    test.skip((await grid.count()) === 0, "store's homepage has no category grid");
    const n = await grid.locator(":scope > *").count();
    for (const [width, columns] of [[1440, 4], [1024, 4], [640, 3], [390, 2]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const tops = await grid.locator(":scope > *").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      const firstRow = tops.filter((top) => top === tops[0]).length;
      expect(firstRow, `${width}px`).toBe(Math.min(n, columns));
    }
  });
});

test.describe("store-owned configuration", () => {
  let original: Record<string, unknown> = {};
  const POLICY_KEYS = ["returnWindowDays", "returnConditions", "handlingDaysMin", "handlingDaysMax"] as const;

  test.beforeAll(async ({ request }) => {
    const { settings } = await (await request.get(`${API}/api/settings`)).json();
    original = Object.fromEntries(POLICY_KEYS.map((k) => [k, settings[k] ?? null]));
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page);
    expect((await adminApi(page, "PATCH", "/api/settings", original)).status).toBe(200);
    await page.close();
  });

  test("store policy is configuration: product page, FAQ and structured data follow the settings", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "store settings are global state — exercised once");
    const { items } = (await (await page.request.get(`${API}/api/products/storefront?pageSize=1`)).json()) as { items: { slug: string }[] };
    test.skip(items.length === 0, "store has no products");
    const productPath = `/product/${items[0]!.slug}`;
    await login(page);

    const policy = { returnWindowDays: 14, returnConditions: "E2E test items", handlingDaysMin: 2, handlingDaysMax: 3 };
    expect((await adminApi(page, "PATCH", "/api/settings", policy)).status).toBe(200);
    await expectPageToContain(page, productPath, "14-day easy returns");
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
    expect(ld).toContain('"merchantReturnDays":14');
    expect(ld).toMatch(/"handlingTime":\{[^}]*"minValue":2[^}]*"maxValue":3/);
    await expectPageToContain(page, "/faq", "E2E test items can be returned or exchanged within 14 days of delivery.");

    // A store that states no return window claims none — anywhere.
    expect((await adminApi(page, "PATCH", "/api/settings", { returnWindowDays: null, returnConditions: null, handlingDaysMin: null, handlingDaysMax: null })).status).toBe(200);
    await expect.poll(async () => (await page.goto(productPath), await page.content()).includes("-day easy returns"), { timeout: 30_000 }).toBe(false);
    expect((await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n")).not.toContain("merchantReturnDays");

    // Invalid input is refused by the shared schema.
    expect((await adminApi(page, "PATCH", "/api/settings", { handlingDaysMin: 5, handlingDaysMax: 2 })).status).toBe(400);
  });

  test("logo, favicon, category, homepage and product images are replaced through the admin upload pipeline", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "store content is global state — exercised once");
    await login(page);
    const restore: (() => Promise<unknown>)[] = [];

    try {
      // Logo and favicon (settings): the stored value is the domain-free /uploads reference the upload returned.
      const { settings } = await (await page.request.get(`${API}/api/settings`)).json();
      const before = {
        logo: settings.logoUrl ? await capture(page, settings.logoUrl as string) : null,
        favicon: settings.faviconUrl ? await capture(page, settings.faviconUrl as string) : null,
      };
      restore.push(async () => {
        const back = {
          logoUrl: before.logo && (await reupload(page, before.logo, "/api/settings/upload-logo")),
          faviconUrl: before.favicon && (await reupload(page, before.favicon, "/api/settings/upload-favicon")),
        };
        expect((await adminApi(page, "PATCH", "/api/settings", back)).status).toBe(200);
      });
      const logo = await uploadPng(page, "/api/settings/upload-logo");
      expect(logo.status).toBe(201);
      const favicon = await uploadPng(page, "/api/settings/upload-favicon");
      expect(favicon.status).toBe(201);
      const logoUrl = logo.json.url as string;
      const faviconUrl = favicon.json.url as string;
      expect(logoUrl).toMatch(/^\/uploads\//);
      expect((await adminApi(page, "PATCH", "/api/settings", { logoUrl, faviconUrl })).status).toBe(200);
      await expectPageToContain(page, "/", keyOf(logoUrl));
      expect(await page.locator(`link[rel="icon"][href*="${keyOf(faviconUrl)}"]`).count()).toBeGreaterThan(0);
      expect((await page.request.get(logoUrl)).status(), "the uploaded file is served").toBe(200);

      // A category image.
      const { tree } = (await (await page.request.get(`${API}/api/categories/tree`)).json()) as { tree: { id: string; imageUrl: string | null }[] };
      if (tree.length) {
        const cat = tree[0]!;
        const img = await uploadPng(page, "/api/categories/upload-image");
        expect(img.status).toBe(201);
        expect((await adminApi(page, "PATCH", `/api/categories/${cat.id}`, { imageUrl: img.json.url })).status).toBe(200);
        restore.push(() => adminApi(page, "PATCH", `/api/categories/${cat.id}`, { imageUrl: cat.imageUrl }));
      }

      // Homepage sections that carry an image: hero, brand story, promotional banner.
      const { sections } = (await adminApi<{ sections: { id: string; type: string; config: Record<string, unknown> }[] }>(page, "GET", "/api/homepage-sections")).json;
      const imageSections = sections.filter((s) => ["HERO", "BRAND_STORY", "PROMO_BANNER"].includes(s.type));
      const expectedKeys: string[] = [];
      for (const section of imageSections) {
        const img = await uploadPng(page, "/api/homepage-sections/upload-image");
        expect(img.status).toBe(201);
        const res = await adminApi(page, "PATCH", `/api/homepage-sections/${section.id}`, { config: { ...section.config, imageUrl: img.json.url } });
        expect(res.status, `${section.type} saved with an uploaded image`).toBe(200);
        restore.push(() => adminApi(page, "PATCH", `/api/homepage-sections/${section.id}`, { config: section.config }));
        if (section.type !== "HERO") expectedKeys.push(keyOf(img.json.url as string));
      }
      for (const key of expectedKeys) await expectPageToContain(page, "/", key);

      // A product image (the product gallery's own upload), shown on its page, then removed again.
      const { items } = (await (await page.request.get(`${API}/api/products/storefront?pageSize=1`)).json()) as { items: { id: string; slug: string }[] };
      if (items.length) {
        const product = items[0]!;
        const res = await uploadPng(page, `/api/products/${product.id}/images`, "images");
        expect(res.status).toBe(201);
        const images = (res.json.product as { images: { id: string; url: string }[] }).images;
        const added = images[images.length - 1]!;
        restore.push(() => adminApi(page, "DELETE", `/api/products/${product.id}/images/${added.id}`));
        await expectPageToContain(page, `/product/${product.slug}`, keyOf(added.url));
      }
    } finally {
      for (const undo of restore.reverse()) await undo();
    }
  });
});
