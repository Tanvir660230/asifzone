import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";

// Social Inbox (owner 2026-10-17): WhatsApp, Messenger and post comments arrive through Meta's signed webhook and are
// answered from Messages › Inbox. The spec sends real signed webhooks to the API, so the whole path is exercised; only
// the AI draft is injected into one response (no model runs in e2e).

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";
const RUN = Date.now().toString(36);
const SECRET = `e2e-meta-secret-${RUN}`;
const PAGE_ID = "100200300400500";
const WA_ID = `88017${String(Date.now()).slice(-8)}`;
const PSID = `70${Date.now()}`;
const COMMENT_ID = `888000111_${RUN}`;
const nowSec = () => Math.floor(Date.now() / 1000);

async function call<T = unknown>(page: Page, path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
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
  ) as Promise<{ status: number; body: T }>;
}

async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
}

async function webhook(request: APIRequestContext, body: unknown) {
  const raw = JSON.stringify(body);
  const res = await request.post(`${api}/api/v1/webhooks/meta`, {
    data: raw,
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` },
  });
  expect(res.status()).toBe(200);
}

const META_KEYS = {
  META_APP_SECRET: SECRET,
  META_PAGE_ID: PAGE_ID,
  META_PAGE_ACCESS_TOKEN: `e2e-page-${RUN}`,
  WHATSAPP_PHONE_NUMBER_ID: "555666",
  WHATSAPP_ACCESS_TOKEN: `e2e-wa-${RUN}`,
  WHATSAPP_WABA_ID: "2000001",
};
const OLD_WA_ID = `88016${String(Date.now()).slice(-8)}`;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ browser, request }) => {
  const page = await browser.newPage();
  await adminLogin(page);
  expect((await call(page, "/api/settings/integrations", "PATCH", { values: META_KEYS })).status).toBe(200);
  await page.close();

  await webhook(request, {
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "8801711000000", phone_number_id: "555666" }, contacts: [{ profile: { name: `Rahim ${RUN}` }, wa_id: WA_ID }], messages: [{ from: WA_ID, id: `wamid.e2e.${RUN}`, timestamp: String(nowSec()), type: "text", text: { body: "Bhai kalo panjabi tar dam koto?" } }] } }] }],
  });
  await webhook(request, {
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "8801711000000", phone_number_id: "555666" }, contacts: [{ profile: { name: `Old ${RUN}` }, wa_id: OLD_WA_ID }], messages: [{ from: OLD_WA_ID, id: `wamid.e2e.old.${RUN}`, timestamp: String(nowSec() - 30 * 3600), type: "text", text: { body: "Ami kalke order korbo" } }] } }] }],
  });
  await webhook(request, {
    object: "page",
    entry: [{ id: PAGE_ID, time: Date.now(), messaging: [{ sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: Date.now() - 30 * 3_600_000, message: { mid: `m_e2e_${RUN}`, text: "Order ta kobe pabo?" } }] }],
  });
  await webhook(request, {
    object: "page",
    entry: [{ id: PAGE_ID, time: nowSec(), changes: [{ field: "feed", value: { from: { id: "5001", name: `Karim ${RUN}` }, message: "price?", post_id: `${PAGE_ID}_888000111`, comment_id: COMMENT_ID, created_time: nowSec(), item: "comment", parent_id: `${PAGE_ID}_888000111`, verb: "add" } }] }],
  });
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await adminLogin(page);
  const list = await call<{ items: Array<{ id: string; contactName: string; preview: string }> }>(page, `/api/v1/admin/conversations?status=all&pageSize=100&search=${RUN}`);
  const messenger = await call<{ items: Array<{ id: string }> }>(page, `/api/v1/admin/conversations?status=all&pageSize=100&channel=MESSENGER&search=${encodeURIComponent("Order ta kobe pabo")}`);
  for (const c of [...list.body.items, ...messenger.body.items]) await call(page, `/api/v1/admin/conversations/${c.id}`, "DELETE");
  await call(page, "/api/settings/integrations", "PATCH", { values: Object.fromEntries(Object.keys(META_KEYS).map((k) => [k, null])) });
  await page.close();
});

test("a WhatsApp message arrives, the AI draft is ready to send, and the reply goes out on WhatsApp", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/feedback");
  await page.getByLabel("Channel").selectOption("WHATSAPP");
  const row = page.getByRole("button", { name: new RegExp(`Rahim ${RUN}`) });
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: /Karim/ })).toHaveCount(0);

  // The AI's suggestion, as the API returns it once the model has run.
  let injected = false;
  await page.route(/\/api\/v1\/admin\/conversations\/[^/?]+$/, async (route) => {
    if (route.request().method() !== "GET" || injected) return route.continue();
    injected = true;
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, draft: { body: "Ji, kalo panjabi 1450 taka. M ar L size ache.", intent: "price" } } });
  });
  await row.click();

  await expect(page.getByRole("heading", { name: /WhatsApp chat/ })).toBeVisible();
  await expect(page.getByText("Reply window closes in")).toBeVisible();
  await expect(page.getByText(/AI draft · Price/)).toBeVisible();
  await expect(page.getByLabel("Your reply")).toHaveValue("Ji, kalo panjabi 1450 taka. M ar L size ache.");
  await expect(page.getByText(`On WhatsApp to 0${WA_ID.slice(3)}`)).toBeVisible();

  await page.getByRole("button", { name: "Send reply" }).click();
  const sent = page.getByRole("list", { name: "Messages" }).getByRole("listitem").last();
  await expect(sent).toContainText("Ji, kalo panjabi 1450 taka.");
  await expect(sent).toContainText("· WhatsApp");
  await expect(sent.getByText("Sent")).toBeVisible({ timeout: 20_000 });
});

test("a Messenger chat past 24 hours explains the human-agent reply", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/feedback?channel=MESSENGER");
  await page.getByRole("button", { name: /Order ta kobe pabo/ }).first().click();
  await expect(page.getByText(/this goes out as a staff reply, allowed for 7 days/)).toBeVisible();
});

test("a post comment can be answered publicly or privately", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/feedback?channel=FB_COMMENT");
  await page.getByRole("button", { name: new RegExp(`Karim ${RUN}`) }).click();
  const choice = page.getByRole("group", { name: "Reply on" });
  await expect(choice.getByRole("button", { name: "Public reply" })).toBeVisible();
  await choice.getByRole("button", { name: "Private message" }).click();
  await expect(page.getByText("Opens a Messenger chat with them — once per comment")).toBeVisible();
});

test("WhatsApp after 24 hours offers an approved template instead of free text", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/feedback?channel=WHATSAPP&status=all");
  await page.getByRole("button", { name: new RegExp(`Old ${RUN}`) }).click();
  await expect(page.getByText(/WhatsApp now allows only an approved template/)).toBeVisible();
  // This test store never calls Meta, so the account has no templates — the composer says how to add one.
  await expect(page.getByText(/No approved templates yet/)).toBeVisible();
  await expect(page.getByLabel("Your reply")).toHaveCount(0);
});

test("the Inbox fits a 375px phone with a thread open", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await adminLogin(page);
  await page.goto("/admin/feedback?channel=FB_COMMENT");
  await page.getByRole("button", { name: new RegExp(`Karim ${RUN}`) }).click();
  await expect(page.getByRole("heading", { name: /Comment on a post/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
