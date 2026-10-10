# Financial Core — Payroll (ERP programme E8)

Status: **implemented and verified (2026-10-10)** as a **configurable structure**.

Blocker B-3 (the owner's payroll rules) still stands, so **no statutory rule is built in**: no income-tax slab, provident
fund rate or festival-bonus rule. The owner defines every component, its amount or percentage, and where it posts. When
the owner or an accountant confirms the rules, they are entered as components (or the components are adjusted); no code
change is needed for fixed amounts and percentages of basic.

## 1. Pay components

A component is one line of pay.

| Kind | Meaning | Posts to (default) |
|---|---|---|
| Earning | Paid to the employee: basic, allowances, bonus, overtime | an expense — `expense.salaries` (6200 Salaries & wages) |
| Deduction | Withheld from pay: tax, provident fund, advance recovery | a liability — `liability.payroll_deductions` (2420) |
| Employer contribution | The employer's cost on top: provident fund match | an expense (`expense.employer_contributions`, 6210) **and** a liability (2420) |

**How a component is calculated:**

- **Fixed per employee:** the amount is set on each employee.
- **Percentage of basic:** a default rate, which each employee can override.

**Rules:**

- The **basic salary** is the one fixed earning that percentages are of (at most one per business).
- Each component can name its own accounts: any postable expense, cost-of-sales or other-expense account, and any
  postable liability account. For example, tax withheld could go to 2320 Withholding tax payable.
- **Recovering an advance:** a deduction may instead credit a receivable it recovers, an account under 1500 Receivables
  such as 1520 Employee advances. The advance itself is paid as an ordinary withdrawal against 1520. Such a deduction is
  settled by the payslip and is never "paid over".
- Money accounts (cash, bank, wallet, clearing) are never payroll accounts; money moves only through Treasury.
- Once a component is on a payslip, its kind, calculation and basic flag can't change; create a new component instead.
  Its name, rate, accounts and active flag can still change.

**Accounts:** 2410 Salaries payable (already in the chart, now mapped to `liability.salaries_payable`), 2420 Payroll
deductions & contributions payable (new), 6200 (now mapped) and 6210 Employer payroll contributions (new). All are
sensitive (balances only with `finance.sensitive`). They are provisioned on first use, like the loans and fixed-assets
accounts.

## 2. Employees

An employee has a name, designation, department, phone, where their salary is paid (free text: bank account or bKash),
a joining date and, once they leave, a leaving date. Employees are never deleted.

**Pay structure:** the components the employee is paid, each with an amount (fixed) or an optional own rate
(percentage). Changing it affects future pay runs; a draft already made keeps its figures.

## 3. The monthly pay run

1. **Draft** (`POST /payroll/runs {periodKey, payDate?}`):
   - One live run per month (a database unique index; a reversed run frees the month). A month that hasn't started is
     refused.
   - A payslip is drafted for everyone employed in the month who has a pay structure.
   - **Proration:** joiners and leavers are prorated by calendar days (days employed ÷ days in the month). The default
     prorates every fixed amount; percentages follow the prorated basic. Half-even rounding to minor units.
   - The pay date defaults to the month's last day.
2. **Edit the draft:**
   - Change the days paid, which recalculates the payslip from the employee's pay.
   - Or set the lines themselves: add a one-off festival bonus or overtime, adjust a recovery.
   - Add or remove a payslip. Only someone with a pay structure who was employed that month can be added. Deductions
     above earnings are refused (net pay ≥ 0).
3. **Post** (`finance.post`): **one journal**, dated the month's last day (kind ADJUSTMENT, source `PayRun`):
   - Dr each earning's expense account, and each employer contribution's expense account.
   - Cr each deduction's and contribution's liability account.
   - Cr Salaries payable with **one line per employee** (party `Employee`).
   - After posting, payslips and lines are immutable (database guard).
4. **Pay** (`finance.transact`): the net pay of the chosen payslips (default: every unpaid one) leaves through **one
   Treasury WITHDRAWAL** from cash, a bank or a wallet, against Salaries payable.
   - Approval thresholds and the cash-box overdraft rule apply.
   - A payslip counts as paid while its movement is posted. Awaiting approval reserves it; rejected or reversed makes it
     unpaid again.
   - Idempotent by key.
5. **Reverse** (`finance.reverse`, with a reason): only while no payslip has a live payment. The journal is reversed on
   the same date (the month's last day), so the month nets to zero even when the run was posted before the month ended.
   The month can then be run again.

## 4. Paying deductions over (remittance)

**Withheld and owed** lists every liability account payroll uses, with its ledger balance.

**Pay over** (`POST /payroll/remittances`) records a Treasury WITHDRAWAL against that liability. It records the month
and a reference (challan or receipt number).

- It is never more than is owed, less remittances awaiting approval.
- Only payroll liability accounts are accepted.
- It is idempotent.

## 5. Checks and integrations

- **`payroll.subledger`:** Salaries payable equals the net pay of payslips on posted runs, less the payments whose
  movement is posted. It is NOT_APPLICABLE until something is posted.
- **Cash forecast:**
  - net pay of runs not yet paid, at their pay date (drafts labelled);
  - then, for each month end in the window without a run, the current staff's standard monthly net, labelled
    *estimate*.
- **When payroll starts:** the first pay run's month. Before any run, it is last month, or the books' opening month if
  later. Earlier months were paid outside payroll (as expenses) and are not asked for.
- **Alerts:**
  - *Payroll not run* (warning): a month since payroll started with people on the payroll and no posted run.
  - *Salaries due and not paid* (warning): posted runs past their pay date.
- **Month-end checklist:** a **Payroll posted** step. It is not needed when nobody was on the payroll that month, or
  the month is before payroll started.

## 6. API and permissions (`/api/v1/finance/payroll…`)

Salaries are sensitive. Reading and drafting need `finance.sensitive`; posting needs `finance.post`; reversing needs
`finance.reverse`; paying and remitting need `finance.transact`. All of these are owner-only.

| Route | Permission |
|---|---|
| `GET /payroll`, `GET /payroll/components`, `GET /payroll/employees`, `GET /payroll/runs/:id` | `finance.sensitive` |
| `POST /payroll/components`, `PATCH /payroll/components/:id`, `POST /payroll/employees`, `PATCH /payroll/employees/:id` | `finance.sensitive` |
| `POST /payroll/runs`, `DELETE /payroll/runs/:id`, `PATCH /payroll/runs/:id/payslips/:payslipId`, `POST` / `DELETE /payroll/runs/:id/employees/:employeeId` | `finance.sensitive` |
| `POST /payroll/runs/:id/post` | `finance.post` |
| `POST /payroll/runs/:id/reverse` | `finance.reverse` |
| `POST /payroll/runs/:id/pay`, `POST /payroll/remittances` | `finance.transact` |

That adds 17 routes, 556 admin routes in total.

**UI:** Finance → **Payroll** has three views:

- **Pay runs:**
  - next month to run, salaries unpaid, deductions withheld;
  - the runs, each opening a drawer with its payslips: edit, add or remove, post, pay, reverse;
  - withheld and owed, with *Pay over*.
- **Employees:** monthly gross, net and employer cost; add or edit with the pay structure.
- **Pay components.**

## 7. Database

Migration `20261029100000_finance_payroll`:

- **Tables:** `Employee`, `PayComponent`, `EmployeePayItem`, `PayRun`, `Payslip`, `PayslipLine`, `PayslipPayment`,
  `PayrollRemittance`.
- **P-1 values:**
  - a component's account shape matches its kind;
  - a fixed component has no rate, and a percentage one has a rate of 0–100;
  - one basic per business;
  - net = gross − deductions ≥ 0 on runs and payslips;
  - days paid are 0 to the days in the month;
  - one live run per month;
  - a posted run has its journal, and a reversed run has a reason.
- **P-2 guard:**
  - a run, its payslips and its lines change only while the run is a draft;
  - a posted run only becomes REVERSED, with its figures unchanged;
  - payments and remittances are append-only.
- **P-3:** audit at commit for employees, components, runs, payments and remittances; no TRUNCATE.

## 8. Verified

- `finance-payables.integration.test.ts` +2 tests:
  - **Calculation:** proration and percentage of a prorated basic, half-even, with an own rate (12.5%) overriding the
    default.
  - **A full month on the real database:**
    - The components provision 6200, 6210 and 2420. A percentage without a rate is refused, and so is a second basic.
    - **September:**
      - A full-month employee: 20,000 basic + 50% rent − 500 tax − 10% PF = net 27,500, employer PF 2,000.
      - A joiner on the 16th, prorated 15 of 30 days: net 21,000.
      - A duplicate run is refused. A ৳5,000 festival bonus added in the draft makes the run's net 53,500; deductions
        above earnings are refused.
      - The posted journal: Dr 6200 57,500, Dr 6210 3,500, Cr 2420 7,500, Cr 2410 53,500 (two employee lines), dated
        09-30.
      - Payslips are immutable after posting (database guard).
      - `payroll.subledger` matches before (53,500), between (21,000) and after (0) the payments. A replay is idempotent,
        a double payment is refused, and a paid run can't be reversed.
      - Remittance: 8,000 against 7,500 owed is refused, and so is a non-payroll account; 7,500 is remitted and 2420 is
        owed 0.
    - **October:**
      - Posted early and reversed on its own date. The forecast shows its unpaid net on 10-31, and the estimates use the
        standard monthly net (69,500).
      - Redrafted and deleted.
    - The month-end Payroll step is DONE for September, and every reconciliation check matched.
- `finance-commerce` set-up test: the sensitive accounts now include 2420 and 6210.
- Full API regression green; authorization matrix 556 routes.
- **Browser QA** (`finance_qa`, 1440 and 375 px, no horizontal overflow):
  - setup empty state; components created; an employee added through the modal (39,000 gross, 36,500 net);
  - a mid-month joiner (16 of 31 days, basic 20,645.16);
  - October drafted; a ৳12,500 festival bonus added in the payslip modal; posted; both payslips paid from City Bank;
  - `payroll.subledger`, `ledger.integrity` and `treasury.integrity` MATCHED;
  - ৳5,183.87 of the ৳9,748.39 withheld paid over (more than owed is refused in the form);
  - the forecast's salary estimates raised the *cash below zero* alert, as they should.

## 9. Limitations (waiting on B-3 or later)

- **No statutory calculators:** income-tax slabs, a provident-fund ceiling, and bonus eligibility by service length are
  entered as amounts or percentages by the owner.
- **No attendance or leave:** days paid are calendar days or entered by hand.
- **No payslip PDF or employee self-service.**
- **No advances register:** an advance is paid as a Money accounts withdrawal against 1520 Employee advances and recovered
  by a deduction component crediting 1520 (§1). There is no per-employee advance balance yet; the ledger of 1520 shows it.
