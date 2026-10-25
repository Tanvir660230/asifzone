# Financial Core — Expenses and recurring commitments (ERP programme E7)

Status: **implemented and verified (2026-10-09)**.

## 1. Expenses

An **expense** is an operating cost paid from a cash, bank or wallet account. It is recorded as a Treasury
**WITHDRAWAL**:

- Dr the expense account / Cr the money account.
- Idempotent per request key.
- The money account's approval threshold applies.
- Cash and wallets can't overdraw.
- It is reversed like any money movement.

The `Expense` record adds what the movement doesn't say: **cost behaviour** (FIXED / VARIABLE), payee, description,
reference, evidence, and the commitment period it pays (`EXP-000001`). Its state is its movement's state: awaiting
approval, paid, rejected or reversed.

- The expense account must be an EXPENSE or OTHER_EXPENSE account that takes postings.
- It is paid from cash, a bank or a wallet only; clearing accounts are refused.
- A cost bought **on credit** is a supplier bill (Phase 4E), not an expense.

## 2. Recurring commitments

A **recurring commitment** — rent, salaries, a subscription — has:

- an account, an amount and a frequency (monthly, quarterly or yearly);
- a due day of the month (1–28) and a start / optional end date;
- a cost behaviour (default FIXED), a payee and a default money account.

It **posts nothing**: it is a schedule.

**The schedule**

- Each due period (key `YYYY-MM`) is:
  - **PAID** once an expense paying it is posted;
  - **AWAITING APPROVAL** while that payment waits;
  - otherwise **OVERDUE** (due date passed) or **DUE**.
- Paying a period records an expense with the commitment's account, amount, behaviour, payee and money account as
  defaults.
- A period is paid at most once at a time, checked under the commitment's row lock. A rejected or reversed payment
  reopens the period.
- Paying ahead (a future period) is allowed. A period that isn't on the schedule is refused.
- Editing a commitment changes it from now on: periods already paid keep the amount their expense paid.

## 3. Summary and break-even

`GET /finance/expenses/summary?from&to` returns:

- posted expenses of the period by account, split fixed / variable;
- the **fixed monthly commitments** (each active FIXED commitment normalised to a month);
- the period's **gross margin %** (from the income statement);
- **break-even monthly revenue** = fixed monthly costs ÷ gross margin. This is null while there are no sales with a
  margin.

## 4. API (`/api/v1/finance`)

| Route | Permission |
|---|---|
| `GET /expenses`, `GET /expenses/summary`, `GET /commitments` | `finance.read` |
| `POST /expenses` (Idempotency-Key), `POST /commitments`, `PATCH /commitments/:id` | `finance.transact`; the payment posts with `finance.post`, otherwise it waits for approval |

That adds 6 routes, 520 admin routes in total.

## 5. Database

Migration `20261025100000_finance_expenses`:

| Invariant | Rule |
|---|---|
| X-1 | Values: positive amounts; due day 1–28; end ≥ start; a period key (`YYYY-MM`) exactly on expenses that pay a commitment. |
| X-2 | An expense is immutable and never deleted (reverse its payment). |
| X-3 | Its movement is a WITHDRAWAL of the same amount against the expense's own account, in the same business. |
| X-4 | Audited at commit; no TRUNCATE. |

## 6. Verified

- `finance-payables.integration.test.ts` +2 tests:
  - **Schedule maths:** monthly and quarterly periods, with start and end dates.
  - **Paying the rent commitment:**
    - September paid and posted with the commitment's defaults; a replay returns the same expense;
    - paying September again is refused; paying ahead is allowed; a period before the start is refused;
    - an ad-hoc variable expense posts; expenses are immutable.
  - **Schedule and summary:** the schedule shows PAID; fixed monthly ৳2,000; the summary totals are fixed ৳4,000 +
    variable ৳300.
  - **Reversal:** reversing September's payment reopens it (OVERDUE). Ledger checks match.
- Authorization matrix: 520 routes.
- Browser QA (`finance_qa`):
  - "Shop rent" ৳30,000 monthly from 2026-08-01, paid from City Bank;
  - the schedule shows Aug and Sep overdue and Oct–Jan due;
  - paying October gives EXP-000001 paid, and October shows paid;
  - fixed costs ৳30,000 a month; break-even shows "—" because QA has no sales with a margin;
  - 1440 and 375 px.

## 7. Limitations / next

- **Payroll** (salaries by employee, deductions, payslips) is E8 and needs the owner's rules (blocker B-3). A salary can
  be a recurring commitment meanwhile.
- **Tax on expenses.** Input VAT is not split on expenses; use a supplier bill when the tax must be recovered.

## 6. Expenses from a file (2026-10-25)

Finance › Expenses › **From a file** (`POST /api/v1/finance/expenses/import/preview|commit`, `finance.transact`,
`expense-import.service.ts`): the owner's history — SMS recharges, rent, salaries, packaging, ad top-ups — as a CSV
(Excel › Save as › CSV, or pasted). Columns, by header name: **date** (2026-09-05 or 05/09/2026), **category** (an
expense account's code or name), **amount** (taka sign, commas and Bengali digits are read), **paid from** (a cash, bank or
wallet account's name, or `owner` — owed back to the owner — or `owner capital`), and optionally payee, description,
reference.

- **Check the file** writes nothing: each row is Ready, *looks already recorded* (same category, date and amount — and
  payee when given) or has its problem named (unknown category or account, before the books start, in the future, not
  an amount). Nothing is guessed or created: a missing category is added first (**New category**, the next free 6xxx
  account under the usual heading).
- **Record** posts the ready rows (and the likely duplicates only if the owner ticks them), each exactly as a hand-typed
  expense — the same approval threshold, reversal and audit. The key is the file and the row, so the same file twice
  records nothing new.
- SMS recharges recorded this way (category SMS) feed the SMS card: recharged, used from the provider balance readings,
  days left.
