# Financial Core — Alerts and month-end close (ERP programme E14)

Status: **implemented and verified (2026-10-10)**.

Nothing here is stored. Every alert and checklist step is computed from the books when asked. Each names how many
records it concerns and links to the page where it is fixed, so it **clears by itself** once the cause is fixed.

## 1. Alerts (`GET /finance/alerts`)

| Alert | Severity | Fixed on |
|---|---|---|
| Financial events failed to post | critical | Sales accounting |
| Finance checks show a difference (latest run of each check DIFFERENCE / ERROR) | critical | Finance checks |
| Cash is forecast to go below zero (13-week forecast) | critical | Budgets & cash |
| Financial events waiting to post (> 15 min) | warning | Sales accounting |
| Money movements waiting for approval (count, amount) | warning | Money accounts |
| Open finance exceptions (count, amount) | warning | Finance exceptions |
| Supplier bills overdue (count, open amount) | warning | Payables |
| Recurring costs overdue (last three months) | warning | Expenses |
| Depreciation not run for an ended month | warning | Fixed assets |
| Loan interest not accrued for an ended month | warning | Loans |
| Supplier bills due within 7 days | info | Payables |
| Production orders received in full, not closed | info | Production order(s) |
| Months ended (more than 5 days ago) but not closed | info | Month-end checklist |
| Finance checks not run in the last 7 days | info | Finance checks |

**Ordering:** alerts are sorted critical → warning → info.

**Figures:** the money figures for bills and recurring costs come from the cash forecast, so the two pages always agree.

**The Finance badge** in the sidebar counts the critical and warning alerts. It is fetched only for admins with
`finance.read`.

## 2. Month-end close (`GET /finance/month-end?month=YYYY-MM`, default last month)

The steps, in the order an accountant works through them:

1. **Every financial event is posted:** none failed or still waiting, dated up to the month end.
2. **Money movements approved or rejected:** none dated in the month is waiting.
3. **Recurring costs recorded:** every commitment period due in the month is paid or awaiting approval.
4. **Supplier bills entered and posted:** no draft bill dated in the month.
5. **Bank and wallet accounts reconciled:** a completed reconciliation to the month end or later.
   - Required for each bank or wallet account that had movements by then.
6. **Depreciation run:** a posted run for the month.
   - Not needed if no asset depreciates in that month.
7. **Loan interest accrued:** a posted accrual for the month.
   - Not needed when no loan is outstanding.
8. **Finance exceptions reviewed:** no open exception.
9. **Finance checks match:** every check was run after the month ended, and none shows a difference.

Each step is DONE, TODO (with a link to the fix) or NOT_APPLICABLE.

**Ready:** when nothing is TODO and the month has ended.

**Closing the month:** the page closes it through the existing period routes (`POST /finance/periods/:id/close |
reopen`, permission `finance.period_close`).

- A reason is required and audited.
- A month can be closed with steps still open; the page says how many.
- A closed month can be reopened (with a reason) to correct a mistake.
- A month nothing was posted into has no period and nothing to close.

**UI:** Finance → **Needs attention** (first in the module): the *Alerts* and *Month-end close* views. The month-end view
has a month picker and shows the period status (Open / Soft-closed / Closed / Nothing posted).

## 3. API

| Route | Permission |
|---|---|
| `GET /alerts`, `GET /month-end` | `finance.read` |

That adds 2 routes, 539 admin routes in total. The period routes already existed.

## 4. Hardening in this phase

- **Permission review:**
  - every finance route is in the authorization matrix (539 routes, each with exactly one permission);
  - the new routes are owner-only, like all finance reads;
  - the web gains the `finance.period_close` capability, so the close button shows only to those allowed.
- **Date boundary:** the statements test computed "today" in UTC. Between 00:00 and 06:00 in Dhaka that is the previous
  day, so cash dated by business date fell outside the range. It now uses the business date (`businessToday`).

## 5. Verified

- `finance-payables.integration.test.ts` +2 tests:
  - **Alerts:**
    - every alert has a count > 0, a link under `/admin/` and an action;
    - they are ordered by severity, and the counts add up;
    - a supplier payment awaiting approval raises the approvals alert (+1), and rejecting it clears it;
    - the overdue-bills alert equals the forecast's overdue bill lines (count and amount).
  - **Month-end (2026-09):**
    - the steps come in order; events are posted, depreciation run and interest accrued (DONE);
    - the checks step matches the latest runs, and the recurring-costs step matches the commitment schedule;
    - `open` and `ready` are consistent; October is not ended;
    - closing September removes it from the "months not closed" alert, and reopening restores it.
- Browser QA (`finance_qa`), 1440 and 375 px, no horizontal overflow:
  - **Alerts:** cost-data completeness (critical — the known opening-estimate items) and the overdue August and
    September rent (৳60,000). Finance badge 2.
  - **Month-end:**
    - September: nothing posted, so "Nothing posted"; shop rent not recorded; checks differ.
    - October: not ended yet, and City Bank not reconciled.

## 6. Limitations

- **Pull only.** Alerts are computed on request; nothing is emailed or pushed. A notification channel could be added when
  the owner chooses one.
- **Thresholds are fixed:** 15 minutes for events, 7 days for bills due soon and stale checks, 5 days before an unclosed
  month is mentioned.

## 7. Home queue and month-end (blueprint P1.2, P0.7, P1.6)

- **Every alert is on Home.** Home's work queue (`/admin/dashboard`, `ActionCenter`) lists every finance alert from
  `GET /api/v1/finance/alerts`, each linking to its fixing page, next to the operational items (pending COD over 48 h,
  duplicate purchases, stock waiting, parcels and returns to receive). The old Needs attention page only forwards:
  `/admin/finance/attention?view=month-end&month=…` → Books › Month-end with its month, anything else →
  `/admin/dashboard?queue=finance#work-queue`. It is no longer in the menu.
- **Unpaid by Steadfast** (`courier.unpaid`) can be snoozed by the owner until a date on Money › Courier & gateway ›
  Steadfast check (`FinanceBusiness.courierUnpaidSnoozedUntil`, inclusive; finance.configure). After the date it shows again.
- **Month-end steps 10–11** (Q16, Q-E): *payouts* — every courier and gateway payout dated in the month is posted;
  *ads* — every non-archived campaign with spend this or last month has every day recorded (spend, or a confirmed zero).
  A month is **Final** only when it is CLOSED and every step is done; months closed before the rule's effective date stay Final.
- **Returns not back** (owner decision D-OO1, Order Operations): returns and refused parcels the courier reported that
  haven't arrived after `returnNotBackDays` are on the Orders queues and the daily courier check.
