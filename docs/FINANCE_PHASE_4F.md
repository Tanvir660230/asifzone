# Financial Core — Phase 4F: Supplier payments and allocations

Status: **implemented and verified (2026-10-09)**. Builds on Phase 2 Treasury (`FINANCE_PHASE_2.md`) and on 4E supplier
invoices (`FINANCE_PHASE_4E.md`). This phase implements locked decisions 14 and 15 (`FINANCE_PHASE_4.md` §2):

- payables are derived from journal lines with the supplier as party;
- payments go through Treasury with the minimum new movement kind.

## 1. Paying a supplier

A payment is a Treasury movement of the new kind **`SUPPLIER_PAYMENT`**:

- Dr trade payables (2110), with the supplier as party;
- Cr the money account.

It takes everything a money movement already has:

- **an Idempotency-Key**, so a repeated request returns the same payment;
- **the account's approval threshold** — a payment at or over it waits for a second person;
- **the rule for paying without `finance.post`** — it waits for approval;
- **the overdraft rule** — cash and wallets can't go below zero;
- **reversal** by a mirror journal, refused while a bank statement line is matched to it;
- **bank reconciliation**, because the payment is an ordinary posting on the money account.

Rules specific to supplier payments:

- A supplier is paid from **cash, a bank or a mobile wallet** only. Gateway, courier and other clearing accounts hold
  customers' money in transit, so they are refused.
- The generic Treasury endpoints can't create this kind. Only `POST /purchasing/supplier-payments` can.

## 2. Allocations

A `SupplierAllocation` sets part of a payment — or of a posted credit note — against a posted bill of the same supplier.

- **No journal.** The payment, the credit and the bill already sit on the payables account for that supplier; an
  allocation only records which bill they settle.
- **When a bill counts as settled.** A bill's outstanding amount is its total less the ACTIVE allocations from *posted*
  payments and credit notes. Allocations from a payment still waiting for approval are *reserved*: they block
  over-allocation but settle nothing until the payment posts.
- **Advances.** Whatever part of a payment is not allocated is an advance on the supplier's account. It can be allocated
  to a bill later, and so can an unused credit note.
- **Release, not delete.** An allocation is released with a reason; it is never edited or deleted. Rejecting or
  reversing a payment releases its allocations in the same transaction.
- **Voiding documents.** A bill or credit note with ACTIVE allocations can't be voided — release them first.

## 3. The supplier's account

`GET /purchasing/suppliers/:id/account` returns:

- **The statement.** Every posting on the payables account with this supplier as party — the ledger itself, so it always
  agrees with the books — with a running balance.
- **Open bills.** Each with total, settled, amount in payments awaiting approval, outstanding and still allocatable.
- **Advances and credit notes** not yet allocated.
- **The balance.** It can be negative, meaning the supplier owes you.

The payables ageing (4E) now shows outstanding bills by days past due, less unallocated credits and advances. Its
balance equals the payables account.

## 4. Checks

`payables.subledger`: the trade-payables account equals posted bills − posted credit notes − posted supplier payments.
This holds in total and for each supplier party. Reversed payments net to zero, because the payment journal and its
reversal both post.

## 5. API (`/api/v1/purchasing`)

| Route | Permission |
|---|---|
| `POST /supplier-payments` (Idempotency-Key header) | `ap.manage`; posting it also needs `finance.post`, otherwise it waits for approval |
| `POST /supplier-allocations`, `POST /supplier-allocations/:id/release` | `ap.manage` |
| `GET /suppliers/:id/account` | `ap.read` |

These are 4 new routes, for 505 admin routes in total.

Approving, rejecting and reversing a payment use the existing `/finance/movements/:id/approve|reject|reverse` routes.

**UI**

- **Finance → Payables:** each supplier links to their **account page**, which has:
  - a "Pay supplier" dialog: choose the money account, date, reference and amount, and tick the bills to settle (part
    payments allowed; any excess is kept as an advance);
  - open bills;
  - "Set against a bill" for advances and credit notes;
  - the statement.
- **The bills list** shows "paid in full" or the amount still owed on each bill.

## 6. Database

The migrations are split in two, because Postgres can't use an enum value in the transaction that adds it:

- `20261024100000_finance_phase4f_payment_kind` adds the enum value;
- `20261024100100_finance_phase4f_payments` adds everything else.

| Invariant | Rule |
|---|---|
| F-1 | Shape: a supplier payment leaves a money account, against an account (payables), naming its supplier. No other kind names a supplier. The movement guard also keeps the supplier immutable. |
| F-2 | An allocation has a positive amount from exactly one source (payment or credit note); a released one carries its time and reason. |
| F-3 | Lifecycle: created ACTIVE against a posted bill of the same supplier, from a live payment or a posted credit note of that supplier; only released afterwards; never deleted. |
| F-4 | Never over-allocated, checked at commit: per bill, per payment and per credit note. |
| F-5 | Audited at commit; no TRUNCATE. |

## 7. Verified

- `finance-payables.integration.test.ts`, +4 tests (10 in all):
  - **Payment.** A ৳1,200 payment settles ৳1,000 + ৳200 of two bills. A replay with the same key returns the same
    payment. The balance is ৳300 and the statement agrees.
  - **Refusals.** Over-allocating a bill is refused, and so is overdrawing a cash box; nothing is created either way.
  - **Advance.** A ৳500 advance leaves the balance at −৳200 and shows in the ageing. ৳300 of it was allocated, then the
    allocation released; allocations are immutable, and a settled bill can't be voided.
  - **Credit note, approval, reject and reverse:**
    - a credit-note allocation adds no journal;
    - a clerk's payment waits for approval, reserving but not settling, and a racing over-allocation is refused;
    - rejecting it releases its allocations; reversing a payment re-opens its bills.
  - Every check MATCHED after each step.
- Treasury, finance and payables suites re-run after the last changes: 62 / 62.
- Full API regression: 110 files, 1299 / 1299.
- Web: tsc, eslint and vitest (35) pass.
- **Browser QA** (`finance_qa`):
  - created "City Bank current" with ৳100,000 opening;
  - paid Dhaka Caps ৳15,000 against the ৳20,600 bill (CB-TRF-5521), leaving ৳5,600 owed;
  - the statement shows the bill and the payment;
  - payables, money movements and ledger checks all match;
  - 1440 and 375 px, no overflow.

## 8. Limitations / next

- **Cheque lifecycle.** A cheque is a payment on the date it is recorded; there is no post-dated cheque register yet.
- **Supplier refunds:** done (2026-10-10). A new movement kind `SUPPLIER_REFUND` brings money a supplier pays back into
  cash, a bank or a wallet: Dr the account / Cr trade payables, with the supplier as party.
  - **Source:** exactly one advance payment or unapplied credit note. A live refund reduces what is left of that source,
    like an allocation does; reversal restores it.
  - **Rules:** never more than is left; idempotent; approval thresholds apply.
  - **Database:** checks the shape, and that the source belongs to the same supplier.
  - **Reports:** `payables.subledger` and the ageing count posted refunds.
  - **UI:** the supplier page has *Refund received* (`POST /purchasing/supplier-refunds`, `ap.manage`).
- **Releasing allocations in the UI:** done (2026-10-10). The supplier page lists what is set against which bill, with *Release* (and a reason).
