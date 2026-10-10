# Financial Core — Ledger workspace and financial statements (ERP programme E6)

Status: **implemented and verified (2026-10-09)**.

- **Phase 1 already served:** the chart, journals (draft / post / reverse / correct, idempotent), periods, the trial
  balance and account ledgers through `/api/v1/finance`.
- **This phase adds:** the financial statements, and the admin pages for all of it.

## 1. Statements (`domain/finance/statements.service.ts`)

They are computed from POSTED journal lines, using the same per-account sums as the trial balance
(`ledger.service.accountSums`). So they always agree with it.

| Statement | Route | What it shows |
|---|---|---|
| Income statement | `GET /finance/statements/income?from&to&brandId` | revenue − cost of goods sold = **gross profit** − operating expenses = **operating profit** + other income − other expenses = **net profit**. The prior period of the same length sits alongside. Gross margin %. |
| Balance sheet | `GET /finance/statements/balance-sheet?asOf&brandId` | Assets; liabilities; equity. Profit not yet closed to retained earnings is its own equity line ("Current earnings"), so the sheet balances whenever the books do (`balanced`). |
| Cash flow (indirect) | `GET /finance/statements/cash-flow?from&to&brandId` | Net profit + the change in every other balance-sheet account over the period, by section (below). The result is the change in money accounts. `reconciles` = the statement explains that change exactly. |

**How the statements are built**

- **Cash-flow sections:** operating (working capital), investing (the fixed-asset group, 18xx), financing (loans 25xx
  and equity).
- **Money accounts:** every ledger account behind a money account — cash, bank, wallets, gateway and courier clearing.
- **Grouping:** accounts are grouped under their top-level group (the child of the type's root group).
- **Restricted accounts:** for viewers without `finance.sensitive`, ownership, partner and payroll accounts fold into one
  restricted line per section. The totals stay exact and nothing is attributed — the trial balance does the same.

Permission: `finance.read`. These are 3 routes, 514 admin routes in total.

## 2. Pages (Finance)

- **Financial statements** (`/admin/finance/statements`):
  - Income / Balance sheet / Cash flow / Trial balance, with a period (or "as at" date).
  - Total cards; a ✓ line saying what the statement agrees with (balanced, explains money ৳X → ৳Y, debits = credits).
  - Section tables with subtotals (gross, operating and net profit; cash from operations) and the prior period.
  - CSV export of every view.
- **Ledger** (`/admin/finance/ledger`):
  - The chart of accounts by type, with balances and type totals; search; hide accounts with no balance.
  - Group headers.
  - Restricted accounts show "owner only".
  - Clicking an account opens its ledger: dates, opening and closing balance, each posting with a running balance.
- **Journals** (`/admin/finance/journals`):
  - Every entry in the books (automatic and manual), filtered by status, kind and dates; expand for the lines.
  - **Manual journal:** date, description, reference, lines (account, debit or credit, memo) with a live debit / credit
    check. Save as a draft, or post (`finance.post`). It is idempotent per dialog.
  - Drafts: post or delete. Posted manual entries: reverse with a reason (`finance.reverse`).

## 3. Verified

- `finance-payables.integration.test.ts` +1 test, on the full purchasing / payables chain:
  - the balance sheet balances, and its assets equal the trial balance's assets;
  - the income statement's net profit equals the P&L accounts in the trial balance, and the prior period precedes the
    period;
  - current earnings appear in equity;
  - the cash flow reconciles: the money change is +৳4,500 (৳5,000 funding − ৳500 advance; the reversed payment nets
    out);
  - a viewer without `finance.sensitive` gets the same totals.
- Authorization matrix: 514 routes.
- Browser QA (`finance_qa`):
  - **Income:** net profit ৳492 = cost adjustments −৳548 and production loss ৳56.
  - **Balance sheet:** balances at ৳387,742.94.
  - **Cash flow:** explains money going ৳0 → ৳85,000 (bank ৳100,000 funding − ৳15,000 supplier payment).
  - **Trial balance:** balanced.
  - **Manual journal:** posting is disabled while unbalanced. "October rent accrued" ৳1,000 (Dr 6100 / Cr 2900) was
    posted, shows in the Rent ledger, and the balance sheet still balances.
  - Pages fine at 1440 and 375 px.

## 4. Limitations / next

- **No year-end close.** Profit accumulates in "Current earnings" until a closing entry moves it to retained earnings.
  Periods can be soft-closed or closed through the existing periods API; there is no closing-entry wizard yet.
- **No brand selector in the pages.** The brand filter is in the API.
- **Corrections in the UI:** done (2026-10-10). A posted manual journal has *Correct*: its lines are prefilled and a reason is required; saving reverses the original and posts the corrected entry (kind CORRECTION) in one step.
