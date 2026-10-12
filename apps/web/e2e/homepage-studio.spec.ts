import { test, expect, type Page } from "@playwright/test";

// Storefront Studio (/admin/homepage): the live preview follows the draft as the admin edits, sections can be hidden per
// device and added from the gallery, and Publish puts the draft on the real homepage.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const RUN = String(Date.now()).slice(-8);
const STORY = `Studio story ${RUN}`;
const TEXT = `Studio note ${RUN}`;

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

interface StudioState {
  version: number;
  sections: { id: string; type: string; config: Record<string, unknown> }[];
  liveSections: unknown[];
}

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

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

test("phones see the homepage's sections, read-only", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  await login(page);
  await page.goto("/admin/homepage");
  await expect(page.getByText(/needs a wider screen/i)).toBeVisible();
  await expect(page.getByRole("list", { name: /homepage sections/i })).toBeVisible();
  await expect(page.getByTestId("studio")).toHaveCount(0);
});

test("edit in the live preview, hide per device, add a section and publish", async ({ page, isMobile }) => {
  test.skip(isMobile, "the Studio needs a wide screen");
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const original = (await adminApi<StudioState>(page, "GET", "/api/homepage-sections/studio")).json;

  try {
    await page.goto("/admin/homepage");
    const frame = page.frameLocator('[data-testid="studio-frame"]');
    await expect(frame.locator("[data-section-id]").first()).toBeVisible();

    // Edit: the preview shows the unsaved text, and the draft autosaves (not live yet).
    await page.getByTestId("outline-row-BRAND_STORY").getByRole("button", { name: /^image with text/i }).click();
    const inspector = page.getByTestId("studio-inspector");
    await inspector.getByLabel("Heading", { exact: true }).fill(STORY);
    await expect(frame.getByRole("heading", { name: STORY })).toBeVisible();
    await expect(page.getByTestId("studio-save-status")).toContainText(/not live yet/i);

    // Show it on computers only: on the phone preview it's gone and the outline says why.
    await inspector.getByTestId("inspector-tab-visibility").click();
    await inspector.getByRole("radio", { name: "Computers" }).or(inspector.getByRole("button", { name: "Computers" })).first().click();
    await page.getByTestId("studio-device-mobile").click();
    await expect(page.getByTestId("studio-frame")).toHaveAttribute("data-device-width", "375");
    await expect(frame.getByRole("heading", { name: STORY })).toBeHidden();
    await expect(page.getByTestId("outline-row-BRAND_STORY")).toContainText(/hidden on phones/i);

    // Add a text section from the gallery.
    await page.getByTestId("studio-device-desktop").click();
    await page.getByTestId("studio-add-section").click();
    await page.getByTestId("gallery-RICH_TEXT").click();
    await inspector.getByLabel("Heading", { exact: true }).fill(TEXT);
    await expect(frame.getByRole("heading", { name: TEXT })).toBeVisible();

    // Publish: the real homepage now has both.
    await page.getByTestId("studio-publish").click();
    await expect(page.getByTestId("studio-save-status")).toContainText(/everything is published/i);
    const home = await page.request.get("/");
    const html = await home.text();
    expect(html).toContain(STORY);
    expect(html).toContain(TEXT);

    // The publish is in the history.
    await page.getByTestId("studio-history").click();
    await expect(page.getByRole("dialog", { name: /publish history/i }).getByText("Live", { exact: true })).toBeVisible();
  } finally {
    // Put the homepage back as it was.
    const now = (await adminApi<StudioState>(page, "GET", "/api/homepage-sections/studio")).json;
    const saved = await adminApi<{ version: number }>(page, "PUT", "/api/homepage-sections/studio/draft", { version: now.version, sections: original.liveSections });
    await adminApi(page, "POST", "/api/homepage-sections/studio/publish", { version: saved.json.version });
  }
});
