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

## 8. Owner, working partners and monthly profit shares (2026-10-21)

The owner settled B-2 for this business on 2026-10-21:

- **Abrarul Haque Asif** owns the business. He paid every cost from his own money and kept the Steadfast and EPS
  payouts.
- **Mehedi Hasan** is a working partner. He gets **20% of each month's net profit** for running the business. He puts
  in no capital and bears no loss: a loss month shares nothing, and the next month shares its whole profit.
- Both have been there since the business started (2026-08-01).

**Roles** (`Partner.role`)
- **OWNER** (one per business): the owner's accounts are the business's own **3100 Owner capital** and
  **3300 Drawings** (mapping `equity.owner_drawings`). They are never renamed. The owner keeps what is left and never
  has a share.
- **WORKING**: shares profit, has no capital. Gets their own 31xx / 32xx accounts.
- **INVESTOR**: the earlier register's default.

**The share** (`profitSharePct`, `shareFrom`, `lossRule`)
- It is stamped as confirmed (`shareConfirmedAt`, `shareConfirmedNote`) when it is set.
- Only `ZERO_IN_LOSS_MONTHS` runs. `CARRY_LOSSES` is refused until it is needed.

**Profit shares** (`ProfitShare`, `POST /equity/profit-shares/run`)
- Each finished month from the share start is shared once, in order, and only after the books have started
  (opening balances posted).
- The month's net profit is the income statement's own figure.
- Share = pct × profit, or 0 in a loss month.
- The share is posted (`finance.partner.profit_shared`): **Dr 3350 Profit shared with partners** (equity), **Cr the
  partner's current account**. Being equity, it does not change the profit it was computed from.
- A posted share is never edited (trigger). If a shared month's profit later changes, the next month's share carries
  a **correction**: what that month's share should be now, minus what was credited for it.
- A negative total is **carried**. Nothing is ever taken back from the partner.
- The running month is shown as an estimate and fixed when the month ends.

**Paying** (`POST /equity/partners/:id/pay`)
- A Treasury withdrawal from cash, bKash or bank against the partner's current account.
- The method (cash / bKash / Nagad / bank / other) and a note are kept.
- A payment can never be more than what is owed.

**The owner's money**
- `POST /equity/owner/money`: money put in is a deposit to owner capital; money taken out is a withdrawal to drawings.
- `GET /equity/owner/payouts` and `POST /equity/owner/payouts-taken`: every posted Steadfast or EPS payout he kept
  becomes a drawing from the account it was paid into, on the payout's date. This happens once per payout
  (idempotency key per settlement).
- A cost he paid from his own pocket is an expense with funding *capital*, as before (Expenses).

**Activity** (`GET /equity/partners/:id/activity`)
- Every posted line on the partner's two accounts, in date order, with running totals.
- Totals: put in, credited, taken out, and net.

**Page:** Finance › Payroll & partners › **Owner & partners**
- The owner's card: put in, taken out and net invested; payouts not yet marked as taken; month-by-month history.
- Each partner's card: owed, earned and paid; the running month's estimate; "Share N finished months";
  "Pay <name>"; month by month with corrections; history.
- Equity on the balance sheet, folded away.

Migration `20261123100000_partner_profit_share`. Routes: 7 (owner-only, `finance.sensitive`; authorization matrix
663). Tests: `finance-partner-profit.integration.test.ts` (6).
