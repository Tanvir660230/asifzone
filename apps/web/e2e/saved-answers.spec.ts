import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";

// Messages › Saved answers (owner 2026-10-18): the Inbox learns answers from the team's replies, and an approved answer
// replies to the same question — however it is typed — without the AI. The e2e store has no Claude key, so every
// answer here comes from the library.

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const api = process.env.E2E_API_URL ?? "http://localhost:4000";
const RUN = Date.now().toString(36);
const SECRET = `e2e-lib-secret-${RUN}`;
const KEYS = { META_APP_SECRET: SECRET, WHATSAPP_PHONE_NUMBER_ID: "555777", WHATSAPP_ACCESS_TOKEN: `e2e-wa-${RUN}`, INBOX_AI_AUTOREPLY: "factual" };
const nowSec = () => Math.floor(Date.now() / 1000);
let seq = 0;
const waId = () => `88015${String(Date.now() + ++seq).slice(-8)}`;

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

/** A customer writes on WhatsApp (a real, signed webhook). Returns the thread id once it is in the Inbox. */
async function customerAsks(request: APIRequestContext, page: Page, from: string, name: string, text: string): Promise<string> {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "555777" }, contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id: `wamid.lib.${from}.${Date.now()}`, timestamp: String(nowSec()), type: "text", text: { body: text } }] } }] }],
  });
  const res = await request.post(`${api}/api/v1/webhooks/meta`, { data: raw, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` } });
  expect(res.status()).toBe(200);
  let id = "";
  await expect
    .poll(async () => {
      const list = await call<{ items: Array<{ id: string }> }>(page, `/api/v1/admin/conversations?status=all&search=${encodeURIComponent(name)}`);
      id = list.body.items[0]?.id ?? "";
      return id;
    })
    .not.toBe("");
  return id;
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

const created: string[] = [];
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await adminLogin(page);
  expect((await call(page, "/api/settings/integrations", "PATCH", { values: KEYS })).status).toBe(200);
  await page.close();
});
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await adminLogin(page);
  const list = await call<{ items: Array<{ id: string }> }>(page, `/api/v1/admin/conversations?status=all&pageSize=100&search=${RUN}`);
  for (const c of list.body.items) await call(page, `/api/v1/admin/conversations/${c.id}`, "DELETE");
  const answers = await call<{ suggested: Array<{ id: string; title: string }>; approved: Array<{ id: string; title: string }> }>(page, "/api/v1/admin/saved-answers");
  for (const a of [...answers.body.suggested, ...answers.body.approved]) if (created.includes(a.title) || a.title.includes(RUN)) await call(page, `/api/v1/admin/saved-answers/${a.id}`, "DELETE");
  await call(page, "/api/settings/integrations", "PATCH", { values: Object.fromEntries(Object.keys(KEYS).map((k) => [k, null])) });
  await page.close();
});

test("an answer written once replies to the same question, typed differently, without the AI", async ({ page, request }) => {
  await adminLogin(page);
  await page.goto("/admin/saved-answers");
  await page.getByRole("button", { name: "New answer" }).click();
  const title = `Shop kothay ${RUN}?`;
  created.push(title);
  await page.getByLabel("The question").fill(title);
  await page.getByLabel(/Other ways customers ask it/).fill("dokan kothay\nshowroom ache?");
  await page.getByLabel("Answer", { exact: true }).fill("Amader online shop:");
  await page.getByRole("button", { name: "Website" }).click();
  await expect(page.getByLabel("Answer", { exact: true })).toHaveValue("Amader online shop: {website}");
  await page.getByRole("switch", { name: "Send automatically" }).click();
  await page.getByRole("button", { name: "Save answer" }).click();
  await expect(page.getByRole("heading", { name: /In use/ })).toBeVisible();

  const id = await customerAsks(request, page, waId(), `Lima ${RUN}`, "dokan ta kothay bhai?");
  await page.goto(`/admin/feedback?status=all&open=${id}`);
  const reply = page.getByRole("list", { name: "Messages" }).getByRole("listitem").last();
  await expect(reply).toContainText("Saved answer · auto · WhatsApp", { timeout: 20_000 });
  await expect(reply).toContainText("Amader online shop: http");
});

test("the same answer given three times is learned and waits for approval", async ({ page, request }) => {
  await adminLogin(page);
  const questions = [`size chart ${RUN} ache?`, `${RUN} size chart ta diben`, `size chart ${RUN} pathan`];
  for (const [i, q] of questions.entries()) {
    const id = await customerAsks(request, page, waId(), `Learner${i} ${RUN}`, q);
    expect((await call(page, `/api/v1/admin/conversations/${id}/replies`, "POST", { channel: "WHATSAPP", body: "Size chart website er product page e ache, M L XL" })).status).toBe(201);
  }
  await page.goto("/admin/saved-answers");
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: /Learned — waiting for you/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const card = page.getByRole("listitem").filter({ hasText: RUN }).first();
  await expect(card).toContainText("Size chart website er product page e ache");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved — it answers this question from now on")).toBeVisible();
});

test("the page fits a 375px phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await adminLogin(page);
  await page.goto("/admin/saved-answers");
  await expect(page.getByRole("heading", { name: "Saved answers" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
