# Financial Core — Partners & equity, foundation (ERP programme E11)

Status: **foundation implemented and verified (2026-10-10)**.

Blocker B-2 (signed partner agreements) still stands. So **nothing is computed from a share**: no profit distribution,
no capital rules, no sweat equity. When the agreement is signed, those become the rest of E11. What does not depend on
the agreement is built.

## 1. Partner register

A partner has a number (PT-01), name, phone, email, *partner since*, *left on*, notes, and two optional notes about the
agreement:

- **Share discussed (%):** always marked *unconfirmed*; `shareConfirmed` is `false` until B-2.
- **Agreement reference.**

The page warns when the shares noted don't add up to 100%. Nothing else uses them.

**Accounts:** adding a partner creates **their own two accounts**: sensitive, system, postable equity accounts under
3000 Equity, with the first free code.

| Account | Code | For |
|---|---|---|
| Partner capital — *name* | 3101–3199 | What the partner put in |
| Partner current — *name* | 3201–3299 | What they take out (drawings) and, once agreed, their profit share |

**Rules:**

- A partner keeps their accounts and is never deleted (database guard). A partner who leaves gets a *left on* date.
- Renaming a partner renames both accounts. Every change is audited.

## 2. Money in and out

There is no new posting kind. A partner's contribution is a **Treasury deposit** into cash, a bank or a wallet against
their capital account. A drawing is a **Treasury withdrawal** against their current account. Both are entered in Money
accounts, with the usual approval thresholds, overdraft rule, idempotency and reversal. These are facts about money, not
the agreement's rules.

## 3. Balances and the equity summary (`GET /finance/equity?asOf=`)

- **Per partner:** capital, current and total, as credit balances of their accounts in posted entries up to `asOf`. A
  negative current account means more drawn than credited.
- **Totals and agreed shares:** the sum of the shares noted, for partners who have not left.
- **Equity:** the **balance sheet's own equity section** for the same date (owner capital, partner accounts, retained
  earnings, opening balance equity, and the profit not yet closed). The page and the balance sheet always agree.

## 4. API and permissions

| Route | Permission |
|---|---|
| `GET /equity` | `finance.sensitive` |
| `POST /equity/partners`, `PATCH /equity/partners/:id` | `finance.configure` (creates and renames accounts) |

That adds 3 routes, 559 admin routes in total.

**UI:** Finance → **Partners & equity**:

- the agreement notice;
- total equity, partners' capital and current accounts;
- a card per partner with a link to each account's ledger (the Ledger page now opens `?account=<id>`);
- the balance sheet's equity lines;
- add or edit a partner.

## 5. Database

Migration `20261030100000_finance_partners`: `Partner` (unique per business and number; capital and current accounts
unique and different).

- **Q-1 values:** the name is not blank, *left on* ≥ *partner since*, share 0–100.
- **Q-2:** a partner is never deleted and keeps their accounts; changes are audited at commit; no TRUNCATE.

## 6. Verified

- `finance-payables.integration.test.ts` +1 test:
  - Two partners get 3101 / 3201 and 3102 / 3202 (equity, sensitive, system, under 3000). A duplicate name and a leaving
    date before joining are refused.
  - Deposits of 100,000 and 50,000 and a withdrawal of 8,000 give balances of 100,000 / −8,000 and 50,000 / 0; totals
    are 150,000, −8,000 and 142,000; agreed shares add to 100.
  - Equity total = the balance sheet's equity, and the partner lines appear in it.
  - A rename renames the accounts. Deleting a partner is refused by the database. Every check matched.
- Full API regression: 110 files, 1314 / 1314. Authorization matrix: 559 routes.
- Browser QA (`finance_qa`, 1440 and 375 px, no horizontal overflow):
  - two partners added in the modal (60% and 40%, unconfirmed);
  - capital of ৳200,000 and ৳120,000 deposited to City Bank, and a ৳15,000 drawing;
  - the cards show 200,000 / −15,000 and 120,000 / 0;
  - total equity ৳640,335.84 equals the balance sheet, which is balanced;
  - the 3201 ledger link opens the drawing.

## 7. Waiting on B-2

- **Profit distribution:** closing the year's profit to partners' current accounts by the agreed shares.
- **Capital rules:** minimum capital, interest on capital, and salary to partners.
- **Sweat equity, vesting, a partner leaving** (settlement of their accounts).
- **Partner loans** (2520) as a partner's sub-ledger.
