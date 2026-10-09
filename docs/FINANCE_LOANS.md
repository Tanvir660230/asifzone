# Financial Core — Loans (ERP programme E10)

Status: **implemented and verified (2026-10-09)**. Money borrowed from a bank or another lender. Partner loans wait for
the owner's partner and equity rules (blocker B-2).

## 1. Accounts

| Key | Default account |
|---|---|
| `liability.loans` | 2510 Bank loans (existing) |
| `liability.accrued_interest` | **2530 Accrued loan interest** |
| `expense.interest` | 8100 Interest expense (existing; now mapped) |

`LOAN_MAPPING_KEYS` are provisioned on first use.

## 2. The loan's life

| Step | Posting |
|---|---|
| **Drawdown** (`LN-001`) | Treasury DEPOSIT into cash, a bank or a wallet against `liability.loans`. Idempotent; account approval threshold applies. Records the lender, reference, principal, yearly rate, term, repayment type (equal instalments / equal principal) and first due date. |
| **Interest accrual** | A monthly run, **once the month has ended**, for every drawn loan. Interest is charged on each day's outstanding principal, actual/365, exact and half-even. A repayment reduces the balance from the day after it is paid. It posts ONE journal: Dr `expense.interest` / Cr `liability.accrued_interest` (each loan as party). Months run in order and post once; only the latest is reversed, and not after the interest it accrued has been paid. |
| **Repayment** | Pays **accrued interest first, then principal**: two Treasury WITHDRAWALs from the same account (against accrued interest, then the loan liability). Idempotent. Refused beyond what is owed. A repayment counts while its movements are posted, so reversing or rejecting them reopens what was paid. |
| **Planned schedule** | Annuity or equal principal, monthly from the first due date (the day is clamped to month end). The last instalment clears the balance. This is guidance; what is owed comes from the documents. |

What is owed is derived, never stored:

- outstanding principal = drawn − principal repaid;
- interest due = accrued − interest paid.

## 3. Check `loans.subledger`

The loans account equals posted drawdowns − posted principal repayments, and accrued interest equals posted accrual lines
− posted interest payments. So no loan money moves outside its loan.

## 4. API (`/api/v1/finance`)

| Route | Permission |
|---|---|
| `GET /loans` | `finance.read` |
| `POST /loans`, `POST /loans/:id/repayments` (Idempotency-Key) | `finance.transact`; the money movements post with `finance.post`, otherwise they wait for approval |
| `POST /loan-accruals` | `finance.post` |
| `POST /loan-accruals/reverse-latest` | `finance.reverse` |

That adds 5 routes, 531 admin routes in total.

**UI:** Finance → **Loans**:

- totals for principal owed, interest accrued and unpaid, and interest booked through which month;
- the accrual card: accrue the next ended month, or reverse the latest;
- one card per loan: owed, interest due, repaid, the next planned instalment, repayments, and the planned schedule;
- dialogs to record a loan and a repayment (the repayment dialog shows the interest / principal split before paying).

## 5. Database

Migration `20261027100000_finance_loans`:

| Invariant | Rule |
|---|---|
| L-1 | Values: positive principal, rate 0–100 %, term 1–600 months, first due after drawdown; each repayment part has its movement exactly when non-zero; months as `YYYY-MM`; one posted accrual run per month. |
| L-2 | Loans, repayments and accrual lines are append-only (only a loan's reference and notes change); a run only goes POSTED → REVERSED. Each `NEW` field reference sits under an `IF` on its table, because the guard is shared by four tables. |
| L-3 | Audited at commit; no TRUNCATE. |

## 6. Verified

- `finance-payables.integration.test.ts` +2 tests:
  - **Interest maths:** ৳120,000 at 12% for August's 31 days = ৳1,223.01. A mid-month repayment steps the balance.
  - **Planned schedules:** both types repay the principal exactly; a due day of the 31st falls on Feb 28.
  - **Drawdown, accrual and repayment** (with a replay of each):
    - the drawdown posts, and a replay returns the same loan;
    - future months and out-of-order months are refused;
    - a ৳11,000 repayment = ৳1,223.01 interest + ৳9,776.99 principal; overpaying is refused;
    - September accrues 1 day on ৳120,000 + 29 days on ৳110,223.01;
    - reversing the latest accrual and re-running it works;
    - `loans.subledger`, ledger integrity and treasury integrity match after every step.
- Browser QA (`finance_qa`):
  - LN-001 ৳500,000 at 11% over 24 months, received into City Bank on 2026-10-01; the planned instalment is ৳23,303.92;
  - a ৳25,000 repayment split ৳1,356.16 interest + ৳23,643.84 principal;
  - "Loans = loan documents" matches; 1440 and 375 px.
  - QA found that accruing a month before it ended locked out the rest of the month. Accrual is now limited to ended
    months.
  - That QA run accrued October 1–9 before the fix, which leaves October partly accrued in `finance_qa` (QA data only).

## 7. Limitations

- **One rate.** No variable rates or rate changes over a loan's life.
- **No fees.** Processing and loan fees are not modelled; record them as expenses.
- **No overdue tracking.** Overdue instalments are not tracked against the plan.
