import { readFileSync } from "node:fs";
import { test, expect, type Browser, type Page } from "@playwright/test";

// Financial Core Phase 3 browser QA (docs/FINANCE_PHASE_3.md §10): commerce reaching the books (sync, an order's trail,
// idempotent re-sync), a missing cost resolved by an approved estimate, a COD settlement (idempotent save, post, clearing
// position, reversal), the finance checks against the dashboard engine, and the finance roles — through the UI, with
// every effect checked through the API.
//
// It changes data: run it only against a disposable QA database whose commerce facts were made for it. QA_P3_FIXTURE is a
// JSON file naming three delivered orders: `cod` (COD, costed), `online` (EPS, costed), `missing` (COD, no cost).

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: PASSWORD };
const VIEWER = { email: process.env.QA_VIEWER_EMAIL ?? "viewer@example.com", password: PASSWORD };
const ACCOUNTANT = { email: process.env.QA_ACCOUNTANT_EMAIL ?? "accountant@example.com", password: PASSWORD };
const NAV = { timeout: 30_000 };
const RUN = Date.now().toString(36);
type Fixture = Record<"cod" | "online" | "missing", { id: string; number: string; total: number }>;
const fx: Fixture = process.env.QA_P3_FIXTURE ? JSON.parse(readFileSync(process.env.QA_P3_FIXTURE, "utf8")) : (null as never);

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "desktop Chromium only");
test.skip(!process.env.QA_P3_FIXTURE, "needs QA_P3_FIXTURE (a disposable QA database with seeded orders)");

async function shot(page: Page, name: string) {
  if (process.env.QA_SHOTS) await page.screenshot({ path: `${process.env.QA_SHOTS}/${name}.png`, fullPage: true });
}

async function login(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/admin\/login/, NAV);
  return page;
}

async function api(page: Page, method: string, path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "csrf_token")?.value;
  const res = await page.request.fetch(`${API}/api/v1/finance${path}`, { method, data, headers: csrf ? { "X-CSRF-Token": csrf } : {} });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text, visible: true }).or(page.getByRole("alert").filter({ hasText: text, visible: true })).first()).toBeVisible({ timeout: 20_000 });
}

type TrailEvent = { eventKey: string; status: string; journalEntry: { number: number; reversedBy: { number: number } | null } | null };
const trail = async (page: Page, orderId: string) => (await api(page, "GET", `/commerce/orders/${orderId}`)).body.events as TrailEvent[];
const committedEvents = async (page: Page) => {
  const s = (await api(page, "GET", "/commerce/status")).body;
  return Object.values(s.events as Record<string, number>).reduce((a, b) => a + b, 0);
};

let owner: Page;
let codClearing = "";
let bank: { id: string; currentBalance: number };

test.beforeAll(async ({ browser }) => {
  owner = await login(browser, OWNER);
  const business = (await api(owner, "GET", "/business")).body;
  expect(business.business.openingDate, "the QA books must have an opening date").toBeTruthy();
  expect(business.costPolicy).toBe("KNOWN_ONLY");
});

test("sales accounting: Sync now brings the delivered orders into the books; syncing again records nothing", async () => {
  await owner.goto("/admin/finance/sales");
  await expect(owner.getByRole("heading", { name: "Sales accounting" })).toBeVisible(NAV);
  await owner.getByTestId("sync-now").click();
  await toast(owner, /order\(s\) checked/);
  const events = await committedEvents(owner);
  expect(events).toBeGreaterThan(0);

  // The COD order: recognised at delivery, its COD payment into COD clearing — each with a posted journal.
  const cod = await trail(owner, fx.cod.id);
  for (const k of ["recognition", "payment:"]) {
    const e = cod.find((x) => x.eventKey.includes(`:${k}`));
    expect(e, k).toBeTruthy();
    expect(e!.status, k).toBe("POSTED");
    expect(e!.journalEntry?.number, k).toBeTruthy();
  }
  // Re-sync (and a full re-check): exactly once — nothing new is recorded.
  await owner.getByTestId("sync-now").click();
  await toast(owner, /0 event\(s\) recorded/);
  await owner.getByRole("button", { name: "Re-check everything" }).click();
  await toast(owner, /0 event\(s\) recorded/);
  expect(await committedEvents(owner)).toBe(events);

  await owner.getByLabel("Order number").fill(fx.cod.number);
  await owner.getByRole("button", { name: "Show", exact: true }).click();
  await expect(owner.getByTestId("order-trail")).toContainText(`order:${fx.cod.id}:recognition`);
  await shot(owner, "p3-sales-accounting");
});

test("exceptions: a missing cost is never invented — an approved estimate posts only under the estimates policy", async () => {
  await owner.goto("/admin/finance/exceptions");
  const row = owner.getByTestId("exception-row").filter({ hasText: fx.missing.number });
  await expect(row).toBeVisible(NAV);
  await expect(row.getByRole("button", { name: "Approve estimate" })).toBeDisabled();
  const before = await trail(owner, fx.missing.id);
  const recognition = before.find((e) => e.eventKey === `order:${fx.missing.id}:recognition#r0`)!;
  expect(recognition.status).toBe("POSTED");
  await shot(owner, "p3-exceptions-open");

  await owner.getByRole("button", { name: "Allow approved estimates" }).click();
  await toast(owner, "Cost policy changed");
  await row.getByRole("button", { name: "Approve estimate" }).click();
  const dialog = owner.getByRole("dialog");
  await dialog.locator("#ex-unit").fill("300");
  await dialog.locator("#ex-note").fill("QA supplier quote");
  await dialog.getByTestId("confirm-exception").click();
  await toast(owner, /Estimate approved/);
  await expect(owner.getByTestId("exception-row").filter({ hasText: fx.missing.number })).toHaveCount(0);

  // The recognition is superseded (reversed + reposted with the ESTIMATED cost), never edited.
  const after = await trail(owner, fx.missing.id);
  const old = after.find((e) => e.eventKey === recognition.eventKey)!;
  expect(old.journalEntry?.reversedBy?.number).toBeTruthy();
  const revised = after.find((e) => e.eventKey === `order:${fx.missing.id}:recognition#r1`);
  expect(revised?.status).toBe("POSTED");
  await owner.locator('select[aria-label="Status"]').selectOption("RESOLVED");
  await expect(owner.getByTestId("exception-row").filter({ hasText: fx.missing.number })).toBeVisible();
  await shot(owner, "p3-exceptions-resolved");
  // Back to the default policy.
  expect((await api(owner, "PUT", "/business/cost-policy", { costPolicy: "KNOWN_ONLY", reason: "QA back to default" })).status).toBe(200);
});

test("settlements: a COD payout with the statement's fee — idempotent save, post, clearing cleared, reversal reopens it", async () => {
  const accounts = (await api(owner, "GET", "/financial-accounts")).body.financialAccounts as Array<{ id: string; kind: string; name: string; currentBalance: number; isActive: boolean }>;
  codClearing = accounts.find((a) => a.name === "COD collections (courier clearing)")!.id;
  bank = accounts.find((a) => a.kind === "BANK" && a.isActive)!;
  const open = async () => ((await api(owner, "GET", `/clearing/${codClearing}`)).body.openOrders as Array<{ orderId: string; open: number }>).find((o) => o.orderId === fx.cod.id)?.open ?? 0;
  expect(await open()).toBe(fx.cod.total);

  await owner.goto("/admin/finance/settlements");
  const fill = async () => {
    await owner.getByTestId("new-settlement").click();
    const d = owner.getByRole("dialog");
    await d.locator("#st-from").selectOption(codClearing);
    await d.locator("#st-to").selectOption(bank.id);
    await d.locator("#st-date").fill(new Date().toISOString().slice(0, 10));
    await d.locator("#st-ref").fill(`QA-STF-${RUN}`);
    await d.getByLabel("Order number 1").fill(fx.cod.number);
    await d.getByLabel("Amount 1").fill(String(fx.cod.total));
    await d.getByLabel("Fee 1").fill("60");
    await expect(d.getByTestId("settlement-net")).toContainText(`paid out ৳${(fx.cod.total - 60).toLocaleString("en-US")}`);
    await d.getByTestId("save-settlement").click();
  };
  await fill();
  await toast(owner, "Draft saved");
  await fill(); // the same statement again: replayed, not doubled
  await toast(owner, "Already recorded");
  const row = owner.getByTestId("settlement-row").filter({ hasText: `QA-STF-${RUN}` });
  await expect(row).toHaveCount(1);
  await row.getByTestId("post-settlement").click();
  await toast(owner, "Settlement posted");
  await expect(row).toContainText("posted");

  expect(await open()).toBe(0);
  const bankAfter = (await api(owner, "GET", `/financial-accounts/${bank.id}`)).body.currentBalance as number;
  expect(Math.round((bankAfter - bank.currentBalance) * 100) / 100).toBe(fx.cod.total - 60);
  await owner.getByLabel("Clearing account").selectOption(codClearing);
  await expect(owner.getByTestId("clearing-balance")).toBeVisible();
  await shot(owner, "p3-settlements-posted");

  await row.getByRole("button", { name: "Reverse" }).click();
  await owner.getByRole("dialog").locator("#rev-reason").fill("QA reversal");
  await owner.getByRole("dialog").getByRole("button", { name: "Reverse" }).click();
  await toast(owner, "Settlement reversed");
  expect(await open()).toBe(fx.cod.total);
  expect((await api(owner, "GET", `/financial-accounts/${bank.id}`)).body.currentBalance).toBe(bank.currentBalance);
});

test("finance checks: revenue and COGS agree with the dashboard engine; nothing posted twice; the ledger balances", async () => {
  await owner.goto("/admin/finance/checks");
  await owner.getByTestId("run-checks").click();
  for (const key of ["ledger.integrity", "revenue.dashboard_vs_ledger", "cogs.dashboard_vs_ledger", "commerce.facts_posted", "commerce.duplicates", "events.unposted"])
    await expect(owner.getByTestId(`check-${key}`)).toContainText("matches", { timeout: 30_000 });
  expect((await api(owner, "GET", "/trial-balance")).body.balanced).toBe(true);
  await shot(owner, "p3-checks");
});

test("roles: a finance viewer reads but cannot act and never sees sensitive balances; an accountant records but cannot post", async ({ browser }) => {
  const viewer = await login(browser, VIEWER);
  await viewer.goto("/admin/finance/sales");
  await expect(viewer.getByRole("heading", { name: "Sales accounting" })).toBeVisible(NAV);
  await expect(viewer.getByTestId("sales-status")).toBeVisible();
  await expect(viewer.getByTestId("sync-now")).toHaveCount(0);
  await viewer.goto("/admin/finance/settlements");
  await expect(viewer.getByTestId("settlement-row").first()).toBeVisible(NAV);
  await expect(viewer.getByTestId("new-settlement")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Reverse" })).toHaveCount(0);
  expect((await api(viewer, "POST", "/commerce/sync", {})).status).toBe(403);
  const tb = (await api(viewer, "GET", "/trial-balance")).body;
  expect(tb.balanced).toBe(true);
  expect((tb.rows as Array<{ code: string; name: string }>).some((r) => r.name.startsWith("Restricted accounts"))).toBe(true);
  expect((tb.rows as Array<{ code: string }>).some((r) => r.code === "3100")).toBe(false);
  const capital = ((await api(owner, "GET", "/accounts")).body.accounts as Array<{ id: string; code: string }>).find((a) => a.code === "3100")!;
  expect((await api(viewer, "GET", `/accounts/${capital.id}/ledger`)).status).toBe(403);
  await shot(viewer, "p3-viewer-settlements");

  const accountant = await login(browser, ACCOUNTANT);
  await accountant.goto("/admin/finance/settlements");
  await expect(accountant.getByTestId("new-settlement")).toBeVisible(NAV);
  const draft = await api(accountant, "POST", "/settlements", undefined);
  expect(draft.status).toBe(400); // validation, not permission: an accountant may record
  const reversed = (await api(owner, "GET", "/settlements")).body.settlements as Array<{ id: string; status: string }>;
  expect((await api(accountant, "POST", `/settlements/${reversed[0]!.id}/post`, {})).status).toBe(403);
  expect((await api(accountant, "POST", `/settlements/${reversed[0]!.id}/reverse`, { reason: "nope" })).status).toBe(403);
  await expect(accountant.getByTestId("post-settlement")).toHaveCount(0);
});

test("team: the finance roles can be assigned", async () => {
  await owner.goto("/admin/team");
  await expect(owner.getByRole("row").filter({ hasText: "accountant@example.com" })).toContainText("Accountant", NAV);
  await expect(owner.getByRole("row").filter({ hasText: "viewer@example.com" })).toContainText("Finance viewer");
  await owner.getByRole("button", { name: "Invite admin" }).click();
  const role = owner.getByRole("dialog").locator("#role");
  for (const value of ["FINANCE_ADMIN", "ACCOUNTANT", "FINANCE_VIEWER"]) await expect(role.locator(`option[value="${value}"]`)).toHaveCount(1);
  await shot(owner, "p3-team-invite-roles");
});
