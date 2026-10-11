import { test, expect, type Browser, type Page } from "@playwright/test";

// Financial Core Phase 2 browser QA (docs/FINANCE_PHASE_2.md §10): money accounts, movements with approval / reversal /
// idempotent retry, account detail, CSV statement import, and a full bank reconciliation — through the UI, with every
// financial effect checked against the books (journals) and the financial audit trail through the API.
//
// It changes data: run it only against a disposable QA database (never production or a shared database), with the books
// of that database free to be set up by it. E2E_API_URL must point at the API the web app talks to. Screenshots go to
// QA_SHOTS when set.

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const OWNER = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!" };
const APPROVER = { email: process.env.QA_APPROVER_EMAIL ?? "approver@example.com", password: process.env.QA_APPROVER_PASSWORD ?? "ChangeMe123!" };
const STAFF = { email: process.env.QA_STAFF_EMAIL ?? "staff@example.com", password: process.env.QA_STAFF_PASSWORD ?? "ChangeMe123!" };
const NAV = { timeout: 30_000 };
const RUN = Date.now().toString(36);
const names = { bank: `City Bank QA ${RUN}`, cash: `Cash box QA ${RUN}`, wallet: `bKash QA ${RUN}` };

test.describe.configure({ mode: "serial" });
test.skip(({ browserName }) => browserName !== "chromium", "desktop Chromium only");

async function shot(page: Page, name: string) {
  if (process.env.QA_SHOTS) await page.screenshot({ path: `${process.env.QA_SHOTS}/${name}.png`, fullPage: true });
}

async function login(browser: Browser, who: { email: string; password: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/, NAV);
  return page;
}

/** An authenticated finance API call from the page's session (cookies + CSRF header), for setup and for checking the books. */
async function api(page: Page, method: string, path: string, data?: unknown, headers: Record<string, string> = {}) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "csrf_token")?.value;
  const res = await page.request.fetch(`${API}/api/v1/finance${path}`, { method, data, headers: { ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...headers } });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

async function accountByName(page: Page, name: string) {
  const { body } = await api(page, "GET", "/financial-accounts");
  return (body.financialAccounts as Array<{ id: string; name: string; currentBalance: number; ledgerAccount: { id: string } }>).find((a) => a.name === name)!;
}

async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text, visible: true }).or(page.getByRole("alert").filter({ hasText: text, visible: true })).first()).toBeVisible({ timeout: 15_000 });
}

/** Opens a movement dialog from the accounts page and fills it. Account selects take ids; counter accounts their label. */
async function movement(page: Page, button: string, fill: { from?: string; to?: string; account?: string; direction?: "IN" | "OUT"; counter?: string; date: string; amount: string; description: string; reference?: string; reason?: string }) {
  // Admin V2: the four kinds of movement sit behind one "Record movement" menu
  await page.getByTestId("record-movement").click();
  await page.getByRole("menuitem", { name: button, exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  if (fill.from) await dialog.locator("#mv-from").selectOption(fill.from);
  if (fill.to) await dialog.locator("#mv-to").selectOption(fill.to);
  if (fill.account) await dialog.locator("#mv-account").selectOption(fill.account);
  if (fill.direction) await dialog.locator("#mv-direction").selectOption(fill.direction);
  if (fill.counter) {
    await expect(dialog.locator("#mv-counter option", { hasText: fill.counter })).toHaveCount(1);
    await dialog.locator("#mv-counter").selectOption({ label: fill.counter });
  }
  await dialog.locator("#mv-date").fill(fill.date);
  await dialog.locator("#mv-amount").fill(fill.amount);
  await dialog.locator("#mv-description").fill(fill.description);
  if (fill.reference) await dialog.locator("#mv-reference").fill(fill.reference);
  if (fill.reason) await dialog.locator("#mv-reason").fill(fill.reason);
  return dialog;
}

let owner: Page;
let approver: Page;
const ids: Record<"bank" | "cash" | "wallet", string> = { bank: "", cash: "", wallet: "" };

test.beforeAll(async ({ browser }) => {
  owner = await login(browser, OWNER);
  approver = await login(browser, APPROVER);
  // The books (Phase 1 configuration, no Phase 2 screen): an opening date and posted opening balances, if not set yet.
  const business = await api(owner, "GET", "/business");
  expect(business.status).toBe(200);
  if (!business.body.business.openingDate) expect((await api(owner, "PATCH", "/business", { openingDate: "2026-07-01" })).status).toBe(200);
  if (business.body.openingBalancesStatus !== "POSTED") {
    const accounts = (await api(owner, "GET", "/accounts")).body.accounts as Array<{ id: string; code: string }>;
    const petty = await api(owner, "POST", "/financial-accounts", { kind: "CASH", name: `Petty cash ${RUN}` });
    await api(owner, "PUT", "/opening-balances/lines", { lines: [{ category: "CASH", financialAccountId: petty.body.id, side: "DEBIT", amount: 1000 }, { category: "CAPITAL", accountId: accounts.find((a) => a.code === "3100")!.id, side: "CREDIT", amount: 1000 }] });
    expect((await api(owner, "POST", "/opening-balances/post")).status).toBe(200);
  }
});

test("money accounts: create with details, opening balance waits for a second owner, edit permitted fields", async () => {
  await owner.goto("/admin/finance/accounts");
  await expect(owner.getByRole("heading", { name: "Money accounts" })).toBeVisible(NAV);

  await owner.getByRole("button", { name: "New account" }).click();
  let d = owner.getByRole("dialog");
  await d.locator("#fa-kind").selectOption("BANK");
  await d.locator("#fa-name").fill(names.bank);
  await d.locator("#fa-provider").fill("City Bank PLC");
  await d.locator("#fa-reference").fill("****9876");
  await d.locator("#fa-title").fill("Asif Zone Ltd");
  await d.locator("#fa-branch").fill("Gulshan");
  await d.locator("#fa-threshold").fill("50000");
  await d.locator("#fa-opening").fill("100000");
  await d.locator("#fa-opening-date").fill("2026-07-31");
  await d.getByTestId("create-account").click();
  await toast(owner, "its opening balance waits for approval");

  for (const [kind, name] of [["CASH", names.cash], ["MOBILE_WALLET", names.wallet]] as const) {
    await owner.getByRole("button", { name: "New account" }).click();
    d = owner.getByRole("dialog");
    await d.locator("#fa-kind").selectOption(kind);
    await d.locator("#fa-name").fill(name);
    if (kind === "MOBILE_WALLET") await d.locator("#fa-reference").fill("01700000000");
    await d.getByTestId("create-account").click();
    await toast(owner, `${name} created`);
  }
  ids.bank = (await accountByName(owner, names.bank)).id;
  ids.cash = (await accountByName(owner, names.cash)).id;
  ids.wallet = (await accountByName(owner, names.wallet)).id;
  expect((await accountByName(owner, names.bank)).currentBalance).toBe(0); // nothing moves before approval

  // Four eyes: the requester can't approve their own opening balance; the second owner can.
  const pending = owner.getByTestId("pending-approvals");
  await expect(pending).toContainText("100,000");
  await shot(owner, "01-accounts-pending-approval");
  await pending.getByRole("button", { name: "Approve" }).click();
  await toast(owner, "must be approved by someone other than the person who requested it");
  await approver.goto("/admin/finance/accounts");
  await approver.getByTestId("pending-approvals").getByRole("button", { name: "Approve" }).click();
  await toast(approver, "Approved and posted");
  expect((await accountByName(owner, names.bank)).currentBalance).toBe(100000);

  // Edit: branch and approval amount change; type stays fixed.
  await owner.goto(`/admin/finance/accounts/${ids.bank}`);
  await owner.getByTestId("edit-account").click();
  d = owner.getByRole("dialog");
  await expect(d.locator("#fa-kind")).toBeDisabled();
  await d.locator("#fa-branch").fill("Banani");
  await d.locator("#fa-threshold").fill("40000");
  await d.getByTestId("save-account").click();
  await toast(owner, `${names.bank} updated`);
  const edited = (await api(owner, "GET", `/financial-accounts/${ids.bank}`)).body;
  expect(edited).toMatchObject({ branch: "Banani", approvalThreshold: 40000, accountTitle: "Asif Zone Ltd", accountReference: "****9876", kind: "BANK", openingBalance: 100000, currentBalance: 100000 });
  await expect(owner.getByText("Banani branch")).toBeVisible();
  await shot(owner, "02-account-detail-edited");
});

test("money movements: deposit, withdrawal, transfers, adjustment, overdraft refused, threshold rejection, idempotent retry, reversal", async () => {
  await owner.goto("/admin/finance/accounts");
  let d = await movement(owner, "Deposit", { to: ids.cash, counter: "3100 Owner capital", date: "2026-08-02", amount: "20000", description: "Owner top-up" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "Deposit of");
  d = await movement(owner, "Withdrawal", { from: ids.cash, counter: "3300 Drawings", date: "2026-08-03", amount: "3000", description: "Owner drawings" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "Withdrawal of");

  // Bank → cash transfer; its request is captured to replay it exactly as a retrying browser would.
  d = await movement(owner, "Transfer", { from: ids.bank, to: ids.cash, date: "2026-08-05", amount: "5000", description: "Cash for the shop", reference: "CHQ-1001" });
  const [request] = await Promise.all([owner.waitForRequest((r) => r.url().includes("/movements/transfer") && r.method() === "POST"), d.getByTestId("submit-movement").click()]);
  await toast(owner, "Transfer of");
  d = await movement(owner, "Transfer", { from: ids.bank, to: ids.wallet, date: "2026-08-10", amount: "2000", description: "Float to bKash" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "Transfer of");
  d = await movement(owner, "Adjustment", { account: ids.cash, direction: "IN", counter: "7900 Miscellaneous income", date: "2026-08-12", amount: "50", description: "Cash count surplus", reason: "Counted 50 more than the books" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "Adjustment of");

  const before = { cash: (await accountByName(owner, names.cash)).currentBalance, bank: (await accountByName(owner, names.bank)).currentBalance, wallet: (await accountByName(owner, names.wallet)).currentBalance };
  expect(before).toEqual({ cash: 22050, bank: 93000, wallet: 2000 });

  // The retry: same Idempotency-Key, same body → the first transfer comes back; nothing moves twice.
  const replay = await owner.request.fetch(request.url(), { method: "POST", data: request.postData()!, headers: { "Content-Type": "application/json", "Idempotency-Key": request.headers()["idempotency-key"]!, "X-CSRF-Token": request.headers()["x-csrf-token"]! } });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).replayed).toBe(true);
  expect((await accountByName(owner, names.cash)).currentBalance).toBe(22050);

  // Cash can't go below zero.
  d = await movement(owner, "Withdrawal", { from: ids.cash, counter: "3300 Drawings", date: "2026-08-13", amount: "999999", description: "Too much" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "can't go below zero");
  await d.getByRole("button", { name: "Cancel" }).click();

  // Above the threshold (40,000): waits; the second owner rejects; nothing moves.
  d = await movement(owner, "Transfer", { from: ids.bank, to: ids.cash, date: "2026-08-14", amount: "45000", description: "Large cash draw" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "waiting for approval");
  await approver.goto("/admin/finance/accounts");
  await approver.getByTestId("pending-approvals").getByRole("button", { name: "Reject" }).click();
  await toast(approver, "Rejected — nothing moved");
  expect((await accountByName(owner, names.bank)).currentBalance).toBe(93000);

  // Reversal from the account page: the adjustment is undone by a mirror journal.
  await owner.goto(`/admin/finance/accounts/${ids.cash}`);
  await owner.getByRole("tab", { name: "Movements" }).click();
  const adjRow = owner.getByRole("row").filter({ hasText: "Cash count surplus" });
  await adjRow.getByRole("button", { name: "Reverse" }).click();
  await toast(owner, "updated by a journal");
  await expect(adjRow).toContainText("reversed");
  expect((await accountByName(owner, names.cash)).currentBalance).toBe(22000);
  await shot(owner, "03-cash-movements");
});

test("account detail: the ledger's running balance is the account balance; references and statuses are shown", async () => {
  await owner.goto(`/admin/finance/accounts/${ids.cash}`);
  const balanceCard = owner.getByTestId("account-balances").locator("div", { hasText: /^Balance/ }).first();
  const shown = (await balanceCard.locator("p").nth(1).textContent())!.trim();
  await owner.getByRole("tab", { name: "Ledger" }).click();
  const rows = owner.locator("table tbody tr");
  await expect(rows.last()).toBeVisible();
  await expect(rows.last().locator("td").last()).toHaveText(shown);
  const ledger = (await api(owner, "GET", `/financial-accounts/${ids.cash}/ledger`)).body;
  expect(ledger.closingBalance).toBe(22000);
  expect(ledger.lines.map((l: { kind: string }) => l.kind)).toEqual(["TREASURY", "TREASURY", "TREASURY", "TREASURY", "REVERSAL"]);
  await owner.getByRole("tab", { name: "Movements" }).click();
  await expect(owner.getByRole("row").filter({ hasText: "Cash for the shop" })).toContainText("CHQ-1001");
  await expect(owner.getByRole("row").filter({ hasText: "Large cash draw" })).toContainText("rejected");
  await shot(owner, "04-cash-ledger");
});

const AUGUST = ["Date,Description,Debit,Credit,Balance", "05/08/2026,Transfer to cash,5000.00,,95000.00", "10/08/2026,bKash transfer,2000.00,,93000.00", "15/08/2026,Service charge,120.00,,92880.00", "20/08/2026,Interest,,30.00,92910.00", "31/02/2026,Broken row,10.00,,0"].join("\n");
const OVERLAP = ["Date,Description,Debit,Credit,Balance", "15/08/2026,Service charge,120.00,,92880.00", "20/08/2026,Interest,,30.00,92910.00", "25/08/2026,Customer NPSB,,500.00,93410.00"].join("\n");

test("CSV statement import: mapping, validation, invalid rows, import, duplicate and overlapping files", async () => {
  await owner.goto(`/admin/finance/accounts/${ids.bank}`);
  await owner.getByRole("tab", { name: "Statement lines" }).click();
  await owner.getByTestId("open-import").click();
  let d = owner.getByRole("dialog");
  await d.locator("#st-file").setInputFiles({ name: "city-aug.csv", mimeType: "text/csv", buffer: Buffer.from(AUGUST) });

  // A mapping that names a column the file doesn't have is reported, not guessed.
  await d.locator("#st-map-balance").fill("Running");
  await d.getByTestId("preview-import").click();
  await expect(d.getByText('Column "Running" (balance) isn\'t in the header')).toBeVisible();
  // An invalid mapping (a signed amount AND debit / credit) is refused by validation.
  await d.locator("#st-map-balance").fill("Balance");
  await d.locator("#st-map-amount").fill("Debit");
  await d.getByTestId("preview-import").click();
  await toast(owner, "Validation failed");
  await d.locator("#st-map-amount").fill("");

  await d.getByTestId("preview-import").click();
  await expect(d.getByTestId("import-preview")).toContainText("5 row(s) · 4 new · 0 already imported · 1 not readable");
  await expect(d.getByText(/Line 6: "31\/02\/2026" isn't a DD\/MM\/YYYY date/)).toBeVisible();
  await shot(owner, "05-import-preview");
  await d.getByTestId("confirm-import").click();
  await toast(owner, "4 line(s) imported · 0 already there · 1 not readable");

  // The same file again: everything is already there — nothing to import.
  await owner.getByTestId("open-import").click();
  d = owner.getByRole("dialog");
  await d.locator("#st-file").setInputFiles({ name: "city-aug.csv", mimeType: "text/csv", buffer: Buffer.from(AUGUST) });
  await d.getByTestId("preview-import").click();
  await expect(d.getByTestId("import-preview")).toContainText("0 new · 4 already imported");
  await expect(d.getByTestId("confirm-import")).toBeDisabled();
  expect((await api(owner, "POST", "/statement-imports", { financialAccountId: ids.bank, fileName: "city-aug.csv", csv: AUGUST, mapping: { date: "Date", description: "Description", debit: "Debit", credit: "Credit", balance: "Balance" }, options: { dateFormat: "DD/MM/YYYY", amountConvention: "POSITIVE_IS_MONEY_IN", hasHeader: true, skipRows: 0 } })).body.replayed).toBe(true);
  await d.getByRole("button", { name: "Cancel" }).click();

  // An overlapping export adds only its new row.
  await owner.getByTestId("open-import").click();
  d = owner.getByRole("dialog");
  await d.locator("#st-file").setInputFiles({ name: "city-aug-late.csv", mimeType: "text/csv", buffer: Buffer.from(OVERLAP) });
  await d.getByTestId("preview-import").click();
  await expect(d.getByTestId("import-preview")).toContainText("1 new · 2 already imported");
  await d.getByTestId("confirm-import").click();
  await toast(owner, "1 line(s) imported · 2 already there");
  await expect(owner.getByTestId("statement-line")).toHaveCount(5);
  expect((await accountByName(owner, names.bank)).currentBalance).toBe(93000); // statement lines never post
  await shot(owner, "06-statement-lines");
});

test("bank reconciliation: auto-match, partial match, unmatch, difference, explicit adjustments, completion, frozen history", async () => {
  // The books' side of the 25 Aug customer transfer: 300 was recorded, the bank shows 500.
  await owner.goto("/admin/finance/accounts");
  const d = await movement(owner, "Deposit", { to: ids.bank, counter: "3100 Owner capital", date: "2026-08-25", amount: "300", description: "Customer transfer (part)" });
  await d.getByTestId("submit-movement").click();
  await toast(owner, "Deposit of");

  await owner.goto("/admin/finance/reconciliation");
  await owner.locator("#rc-account").selectOption(ids.bank);
  await owner.locator("#rc-start").fill("2026-08-01");
  await owner.locator("#rc-end").fill("2026-08-31");
  await owner.locator("#rc-open").fill("100000");
  await owner.locator("#rc-close").fill("93410");
  await owner.getByTestId("start-reconciliation").click();
  await expect(owner).toHaveURL(/\/admin\/finance\/reconciliation\/[a-z0-9]+$/, NAV);
  const runId = owner.url().split("/").pop()!;
  await expect(owner.getByText("Not reconciled yet")).toBeVisible();
  let live = (await api(owner, "GET", `/bank-reconciliations/${runId}`)).body.live;
  expect(live).toMatchObject({ statementGap: 0, ledgerBalance: 93300, difference: 110, unmatchedCount: 5, canComplete: false });
  await expect(owner.getByTestId("reconciliation-figures")).toContainText("110");
  await shot(owner, "07-reconciliation-start");

  await owner.getByRole("button", { name: "Auto-match" }).click();
  await toast(owner, "2 line(s) matched automatically");

  // Partial match: the 500 statement line against the 300 recorded; unmatch keeps history; re-match; resolve the 200.
  const lineRow = (text: string) => owner.getByTestId("reconciliation-line").filter({ hasText: text });
  await lineRow("Customer NPSB").getByRole("button", { name: "Resolve" }).click();
  let m = owner.getByTestId("match-dialog");
  await m.getByTestId("match-candidates").getByRole("button", { name: "Match" }).first().click();
  await toast(owner, "Partly matched");
  await expect(m).toContainText("Unmatched");
  await m.getByRole("button", { name: "Unmatch" }).click();
  await toast(owner, "Match removed — kept in the history");
  await m.getByTestId("match-candidates").getByRole("button", { name: "Match" }).first().click();
  await toast(owner, "Partly matched");
  await expect(m).toContainText("Unmatched ৳200"); // the dialog shows the new remainder at once, not the one before the match
  await expect(m.locator("#adj-counter option", { hasText: "7900 Miscellaneous income" })).toHaveCount(1);
  await m.locator("#adj-counter").selectOption({ label: "7900 Miscellaneous income" });
  await m.locator("#adj-reason").fill("Customer paid 200 more than invoiced — per bank statement");
  await shot(owner, "08-partial-match-adjust");
  await m.getByTestId("post-adjustment").click();
  await toast(owner, "posted and matched");

  for (const [text, counter, reason] of [["Service charge", "8200 Bank & financing charges", "Monthly service charge"], ["Interest", "7100 Interest income", "Interest credited"]] as const) {
    await lineRow(text).getByRole("button", { name: "Resolve" }).click();
    m = owner.getByTestId("match-dialog");
    await expect(m.locator("#adj-counter option", { hasText: counter })).toHaveCount(1);
    await m.locator("#adj-counter").selectOption({ label: counter });
    await m.locator("#adj-reason").fill(reason);
    await m.getByTestId("post-adjustment").click();
    await toast(owner, "posted and matched");
  }

  live = (await api(owner, "GET", `/bank-reconciliations/${runId}`)).body.live;
  expect(live).toMatchObject({ statementGap: 0, ledgerBalance: 93410, difference: 0, unexplainedDifference: 0, unmatchedCount: 0, adjustmentCount: 3, canComplete: true });
  await owner.getByLabel("Notes").fill("August reconciled in browser QA");
  await owner.getByTestId("complete-reconciliation").click();
  await toast(owner, "Reconciliation completed");
  await expect(owner.getByRole("alert").filter({ hasText: "Reconciled" }).or(owner.getByText("August reconciled in browser QA")).first()).toBeVisible();
  await expect(owner.getByTestId("complete-reconciliation")).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await shot(owner, "09-reconciliation-completed");

  // Frozen: the completed run and its matches can't change.
  const detail = (await api(owner, "GET", `/bank-reconciliations/${runId}`)).body;
  expect(detail.reconciliation).toMatchObject({ status: "COMPLETED", difference: 0, matchedCount: 5, unmatchedCount: 0, adjustmentCount: 3 });
  const aMatch = detail.statementLines[0].matches.find((x: { status: string }) => x.status === "ACTIVE");
  const tryUnmatch = await api(owner, "POST", `/bank-matches/${aMatch.id}/unmatch`, { reason: "late edit" });
  expect([tryUnmatch.status, tryUnmatch.body.details.code]).toEqual([409, "BANK_LINE_RECONCILED"]);
  expect((await api(owner, "POST", `/bank-reconciliations/${runId}/abandon`, { reason: "rewrite history" })).body.details.code).toBe("RECONCILIATION_CLOSED");
  await owner.goto("/admin/finance/reconciliation");
  await expect(owner.getByTestId("reconciliation-row").filter({ hasText: names.bank })).toContainText("completed");
  await owner.goto(`/admin/finance/accounts/${ids.bank}`);
  await owner.getByRole("tab", { name: "Statement lines" }).click();
  await expect(owner.getByTestId("statement-line").filter({ hasText: "reconciled" })).toHaveCount(5);
  await shot(owner, "10-bank-statement-reconciled");
});

test("every mutation left its journal and its financial audit records; the books balance", async () => {
  const movements = (await api(owner, "GET", "/movements?pageSize=200")).body.movements as Array<{ id: string; status: string; amount: number; journalEntryId: string | null; reversalJournalEntryId: string | null; fromAccount: { name: string } | null; toAccount: { name: string } | null }>;
  const mine = movements.filter((m) => [m.fromAccount?.name, m.toAccount?.name].some((n) => n && n.includes(RUN)));
  expect(mine.length).toBe(11);
  for (const m of mine) {
    if (m.status === "POSTED" || m.status === "REVERSED") {
      const j = (await api(owner, "GET", `/journals/${m.journalEntryId}`)).body;
      expect(j, m.id).toMatchObject({ status: "POSTED", kind: "TREASURY", totalDebit: m.amount, totalCredit: m.amount, sourceId: m.id });
    } else expect(m.journalEntryId, m.id).toBeNull();
    if (m.status === "REVERSED") expect((await api(owner, "GET", `/journals/${m.reversalJournalEntryId}`)).body).toMatchObject({ kind: "REVERSAL", status: "POSTED" });
    const audit = (await api(owner, "GET", `/audit?entityType=TreasuryMovement&entityId=${m.id}`)).body;
    expect(audit.total, m.id).toBeGreaterThanOrEqual(2); // the request, then its posting / approval / rejection
  }
  expect(mine.map((m) => m.status).sort()).toEqual(["POSTED", "POSTED", "POSTED", "POSTED", "POSTED", "POSTED", "POSTED", "POSTED", "POSTED", "REJECTED", "REVERSED"]);
  for (const entityType of ["BankTransaction", "BankTransactionMatch", "StatementImport", "BankReconciliation", "FinancialAccount"]) {
    expect((await api(owner, "GET", `/audit?entityType=${entityType}`)).body.total, entityType).toBeGreaterThan(0);
  }
  expect((await api(owner, "GET", "/trial-balance")).body.balanced).toBe(true);
  const checks = (await api(owner, "POST", "/reconciliation/run", { checks: ["ledger.integrity", "treasury.integrity"] })).body.results as Array<{ status: string }>;
  expect(checks.map((c) => c.status)).toEqual(["MATCHED", "MATCHED"]);
});

test("permissions: staff can't see or call finance", async ({ browser }) => {
  const staff = await login(browser, STAFF);
  await staff.goto("/admin/finance/accounts");
  await expect(staff.getByText("Finance is limited to the owner")).toBeVisible(NAV);
  await expect(staff.getByRole("link", { name: "Money accounts" })).toHaveCount(0);
  expect((await api(staff, "GET", "/financial-accounts")).status).toBe(403);
  expect((await api(staff, "POST", "/movements/transfer", {}, { "Idempotency-Key": "staff-try-00000001" })).status).toBe(403);
  await shot(staff, "11-staff-denied");
});
