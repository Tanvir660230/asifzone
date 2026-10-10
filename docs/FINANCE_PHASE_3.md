# Financial Core — Phase 3: Sales, Payments, Refunds, Returns & COGS

Status: implemented on branch `finance/phase-1-foundation`, on top of Phase 1 (`2a233db`) and Phase 2 (`ce4db08`).
Not committed.

Phase 3 connects commerce to the ledger. Sales, customer payments, refunds, returns, store credit and the cost of goods
sold reach the books as accounting events. They post through the Phase 1 engine, with the figures the dashboard's own
metrics engine produces. Courier and gateway payouts are recorded as settlements out of clearing accounts. Anything the
books will not guess, such as a missing cost, becomes a finance exception naming its source record.

## 1. Principles

- **One accounting engine.** Commerce posts only as `FinancialEvent`s processed by the Phase 1 event processor. Its
  rules write journals through `journal.service.ts` (`postJournalInTx`). There is no second ledger, posting path,
  balance store or journal abstraction.
- **One source of figures.** Revenue, refunds and COGS come from the dashboard engine's own producers
  (`orderContributions` in `packages/shared/src/metrics/aggregate.ts`), fed by the dashboard's own fact loader
  (`facts.repository.ts`). The ledger therefore reconciles to the dashboard order by order (§9).
- **Commerce is only read.** The projector, settlements and exceptions never write a commerce table. Order prices,
  taxes, discounts and saved order-line costs are never changed. A guard test enforces this.
- **Nothing is invented.** Courier fees and gateway fees are only what a settlement statement says. A missing
  historical cost stays missing. It is reported as an exception and booked only as an owner-approved estimate,
  labelled ESTIMATED, under an explicit cost policy.
- **Corrections are reversals.** Posted journals never change. A changed fact supersedes its earlier event with a
  reversal plus a new posting.
- **Rules name mapping keys, never accounts.** Every posting resolves through `AccountMapping` (§3).

## 2. The commerce projector (`commerce-accounting.service.ts`)

The projector computes the desired accounting state of each order from the engine's facts. It records whatever differs
from what is already in the books.

- **Semantic event keys:**
  - `order:<id>:recognition`
  - `…:reversal` (cancellation after recognition)
  - `…:payment:<paymentId>`
  - `…:refund:<refundId>`
  - `…:return:<movementId>`
  - `…:writeoff:<returnRequest>:<item>`
  - `…:credit:<entryId>`
- **Revisions:** a changed fact is recorded as `<key>#r<n>`, which `supersedes` the previous revision. The processor
  reverses the old journal and posts the new one in the same transaction. A fact that disappears gets a *void*
  revision, which reverses the old journal and posts nothing.
- **Exactly once:** the inbox is unique on (`sourceInstallId`, `eventKey`), so a retry, a concurrent sweep or a full
  rebuild records nothing new when nothing changed.
- **Opening date:** facts dated before the Financial Opening Date are skipped, because the opening balances carry them.
- **Sync:** `syncCommerce`
  - runs every 5 minutes (`jobs/finance-commerce-sync-cron.ts`), or on demand from Sales accounting.
  - takes a per-business try-lock, provisions the commerce accounts (§3) and checks that every key is mapped.
  - projects every order whose facts changed since the cursor, with a 10-minute overlap for late commits. `full`
    projects every order.
  - also projects customer-level credit entries and scans stock movements outside orders.
  - keeps its state in `FinanceSyncState`.
- **Multi-brand boundary:** events carry the installation's `sourceInstallId` and post to that installation's finance
  brand. No `brandId` is added to commerce tables, and commerce databases are not merged.

## 3. Accounts and mappings (`commerce-setup.service.ts`, `packages/shared/src/finance/accounts.ts`)

`ensureCommerceAccounting` is idempotent, advisory-locked and audited. It adds any missing template accounts and
mappings, marks sensitive accounts, and creates the clearing financial accounts.

| Mapping key | Account |
|---|---|
| `asset.receivable_trade` | 1510 Trade receivables (the order hub) |
| `asset.inventory` | 1610 Merchandise inventory |
| `liability.store_credit` | 2220 Store credit liability |
| `liability.store_credit_reserved` | 2225 Store credit reserved at checkout |
| `liability.refunds_payable` | 2230 Refunds payable |
| `liability.vat_output` | 2310 VAT output payable |
| `revenue.merchandise` | 4100 Merchandise sales |
| `revenue.shipping` | 4200 Shipping income |
| `revenue.price_adjustments` | 4250 Price adjustments |
| `revenue.returns_refunds` | 4300 Sales returns & refunds (contra) |
| `revenue.other_refunds` | 4310 Shipping & other refunds (contra) |
| `revenue.store_credit_returns` | 4320 Returns settled in store credit (contra) |
| `revenue.exchange_differences` | 4330 Exchange price differences |
| `cogs.goods` | 5100 Cost of goods sold |
| `cogs.inventory_shrinkage` | 5200 Inventory shrinkage & write-offs |
| `expense.courier_fees` | 6600 Delivery & courier |
| `expense.gateway_fees` | 6700 Payment gateway fees |
| `expense.settlement_adjustments` | 6950 Settlement adjustments |
| `clearing.cod` | financial account "COD collections (courier clearing)" (COURIER) |
| `clearing.gateway.sslcommerz` / `clearing.gateway.eps` | gateway clearing accounts (PAYMENT_GATEWAY) |
| `clearing.manual_receipts` | manual receipts clearing (OTHER) |

Mappings can be changed in Settings. Clearing keys accept only a financial account of a clearing kind.

## 4. Accounting events (`commerce-posting-rules.ts`)

| Event type | Journal |
|---|---|
| `commerce.order.recognised` | Dr receivable (order total). Cr 4100 merchandise, 2310 VAT, 4200 shipping (the remainder), 4250 adjustment. Dr 5100 / Cr 1610 for KNOWN cost (and approved ESTIMATED cost). |
| `commerce.order.recognition_reversed` | The mirror of the recognition (cancellation after recognition). |
| `commerce.payment.received` | Dr provider clearing / Cr receivable. COD → `clearing.cod`, SSLCommerz / EPS → their gateway clearing, MANUAL → `clearing.manual_receipts`, STORE_CREDIT → 2225 reserved. |
| `commerce.refund.completed` | Cash part: Dr receivable / Cr gateway clearing (gateway refund) or 2230 refunds payable. Revenue part, when the engine counts it: Dr 4300 / 2310 / 4310, Cr receivable. |
| `commerce.return.restocked` | Dr 1610 inventory / Cr 5100 COGS at the line's recorded cost. |
| `commerce.return.written_off` | Dr 5200 / Cr 1610 (a damaged return). |
| `commerce.store_credit.entry` | Issuance: the part owed on the order clears the receivable (from a replay of the order's own timeline), the rest goes to 4320. Use at checkout and release go through 2225. |
| `finance.stock.write_off_estimated` | Dr 5200 / Cr 1610 at an approved estimate for a stock write-off with no recorded cost. |

Each payload carries the valuation status (KNOWN / ESTIMATED / MISSING) of its cost lines. Lines of zero are skipped.
An exchange-replacement order uses 4330 as its hub, so the price difference and nothing else reaches revenue.

## 5. Clearing and settlements (`settlements.service.ts`)

- **Clearing:** a payment does not reach the bank directly. It sits in its provider's clearing account until a
  settlement moves it out.
- **A settlement:** one payout from one clearing account into one destination money account.
  - `gross = net + fees + adjustment`. Fees and adjustments are only what the statement shows, and an adjustment needs
    a reason.
  - Lines are matched to orders by order number, or by a gateway's `providerTransactionId`.
  - An unmatched line stays on the settlement and raises an `UNMATCHED_SETTLEMENT_LINE` exception.
- **Lifecycle:** DRAFT → POSTED (one TREASURY journal: Dr destination net, Dr fee expense, Dr/Cr 6950 adjustment,
  Cr clearing gross) → REVERSED.
  - Only a draft can be deleted.
  - A posted settlement is changed only by a reversal.
- **Entry:** manually (Idempotency-Key required) or from a statement CSV with a column mapping. Importing the same file
  again returns the same settlement.
- **Clearing position (`GET /clearing/:id`):** per order, collected minus settled. It lists open orders, oversettled
  orders (usually a refund not yet deducted) and unattributed amounts.

## 6. Cost states and finance exceptions (`finance-exceptions.service.ts`)

- **Cost states:**
  - KNOWN: the order line saved a cost. It posts.
  - MISSING: no cost was saved. It does not post. It raises a `MISSING_COST` exception with the catalog's current
    cost as a *suggestion*.
  - ESTIMATED: an owner-approved estimate for a missing cost. It posts, labelled ESTIMATED, and is reported apart from
    the dashboard's COGS.
- **Cost policy (`FinanceBusiness.costPolicy`):** `KNOWN_ONLY` (the default) or `APPROVED_ESTIMATES`. Estimates can
  be approved only under the second.
- **Exception kinds:**
  - `MISSING_COST`
  - `ORDER_TOTAL_MISMATCH`
  - `UNVALUED_STOCK_RECEIPT`
  - `UNVALUED_STOCK_WRITE_OFF`
  - `UNSUPPORTED_CREDIT_ENTRY`
  - `UNMATCHED_SETTLEMENT_LINE`
  - `ENGINE_MISMATCH`
- **Exception lifecycle:** each exception names its source record and order. It goes OPEN → ACKNOWLEDGED (it stays as
  it is) or RESOLVED (an approved estimate was posted). RESOLVED is final, and exceptions are never deleted (database
  trigger).

## 7. API (`/api/v1/finance`)

| Route | Permission |
|---|---|
| `GET /commerce/status`, `GET /commerce/orders/:id` | `finance.read` |
| `POST /commerce/setup` | `finance.configure` |
| `POST /commerce/sync`, `POST /commerce/orders/:id/sync` | `finance.reconcile` |
| `PUT /business/cost-policy` | `finance.configure` |
| `GET /exceptions` | `finance.read` |
| `POST /exceptions/:id/acknowledge` | `finance.reconcile` |
| `POST /exceptions/:id/approve-estimate` | `finance.post` |
| `GET /settlements`, `GET /settlements/:id`, `GET /clearing/:id` | `finance.read` |
| `POST /settlements`, `POST /settlements/import`, `DELETE /settlements/:id` | `finance.transact` |
| `POST /settlements/:id/post` | `finance.post` |
| `POST /settlements/:id/reverse` | `finance.reverse` |

Request schemas are in `packages/shared/src/schemas/finance-commerce.ts`.

## 8. Revenue, refunds, returns and store credit — behaviour

- **Recognition:**
  - An order is recognised when the engine realises it, dated the realisation date. A COD order is realised at its
    first delivery; any other order at its first successful payment, if that came before any cancellation.
  - Cancelling it afterwards posts the mirror reversal.
  - A change to a recognised order (a modification or line edit) supersedes the recognition.
- **COD and online payments:**
  - A COD payment clears the receivable into COD clearing when the payment is recorded.
  - A gateway payment does the same into its gateway clearing.
  - Settlements then move the money to the bank (§5).
- **Refunds:**
  - The cash part reduces the clearing account it came from (gateway) or becomes refunds payable (COD and manual).
  - The revenue part is booked to contra-revenue exactly when the dashboard's engine counts it, so net sales agree.
- **Returns:**
  - A restocked return puts inventory back at the line's recorded cost and reduces COGS.
  - A damaged return is written off to 5200.
- **Store credit:**
  - Credit issued against an order first settles what the order still owes.
  - Credit beyond that is contra-revenue 4320. The dashboard does not count store credit, so 4320 sits outside the
    reconciled revenue pair.
  - Credit used at checkout is reserved (2225) and cleared by the order's STORE_CREDIT payment.

## 9. Finance checks (`reconciliation.service.ts`)

There are twelve checks. The new ones:

| Check | What it proves |
|---|---|
| Revenue: dashboard vs ledger | 4100 merchandise sales − 4300 sales returns equal the engine's realised net sales (VAT-exclusive) for the period. A difference lists the orders. |
| COGS: dashboard vs ledger | KNOWN-valued 5100 equals the engine's COGS. It lists the orders and the open missing costs. |
| Commerce facts in the books | Every live fact's latest revision is posted. |
| No fact posted twice | No two live postings for one fact. |
| Clearing accounts | Per clearing account and order: paid in versus settled out. Money still in clearing is listed as in transit. A settlement for more than an order paid, or a settlement line with no order, is a difference. Refunds awaiting deduction are reported separately. |
| Order receivables | An order's receivable is zero once commerce says the order is settled. Orders where the books still show money owed either way are listed. |
| Open finance exceptions | Lists the open exceptions by kind. |

## 10. Schema, database invariants and UI

- **Migration `20261013100000_finance_phase3_commerce`** (additive only):
  - New models: `FinanceException`, `ClearingSettlement`, `ClearingSettlementLine`, `FinanceSyncState`.
  - New columns: `FinanceBusiness.costPolicy`, `LedgerAccount.isSensitive`.
  - New roles: `FINANCE_ADMIN`, `ACCOUNTANT`, `FINANCE_VIEWER`.
  - CHECK constraints: settlement and line amounts, and settlement status/journal consistency.
  - Triggers: a settlement is immutable once posted, its lines must sum at posting, and only a draft can be deleted.
    Exceptions are never deleted, their identity is immutable, and RESOLVED is final.
  - Audit triggers, and no TRUNCATE on any finance table.
- **UI (Finance module):**
  - **Sales accounting:** sync status, Sync now / Re-check everything, and an order's accounting trail.
  - **Settlements:** clearing positions, settlements, manual entry, CSV import, post / reverse / delete draft.
  - **Finance exceptions:** filter, acknowledge, approve estimate, and the cost policy.
  - **Finance checks:** run every check, with the orders behind any difference.
  - Team page: the finance roles can be assigned.

## 11. Finance roles and sensitive accounts (`packages/shared/src/permissions.ts`)

| Role | Finance permissions |
|---|---|
| OWNER | everything, including `finance.approve_high_value` and `finance.sensitive` |
| FINANCE_ADMIN | read, transact, post, reverse, reconcile |
| ACCOUNTANT | read, transact, reconcile (records but cannot post or reverse) |
| FINANCE_VIEWER | read |

- **Sensitive accounts:** 2410, 2520, 3100, 3200, 3300 and 6200 are marked `isSensitive`. Without `finance.sensitive`:
  - their rows in the chart, journals and trial balance are redacted. The trial balance folds them into one
    "Restricted accounts" row, so it still balances.
  - their ledgers return 403.
- **High-value approval:** a treasury movement over its account's threshold needs `finance.approve_high_value`, and
  the approver must be a different person from the requester.

## 12. Tests

- **`finance-commerce.integration.test.ts`** covers:
  - setup, recognition (COD, online, cancellation, retries and concurrent sweeps)
  - payments, refunds, returns, store credit
  - cost states and the cost policy
  - COD and gateway settlements (fee, adjustment, partial, unmatched, duplicate, reversal, CSV), and a refund after
    settlement
  - the ledger invariants, every finance check MATCHED, and a closed period
  - every finance role against every admin route
- **`finance-writers.guard.test.ts`:**
  - Phase 3 tables are written only by the finance domain.
  - The projector writes no commerce table.
  - Posting rules name no account id.
- **`authorization.integration.test.ts`:** the new routes are OWNER-only for the existing roles.

## 13. Not in Phase 3

- **Waiting on purchasing (a later phase):** suppliers / accounts payable, purchasing, and valuing non-order stock
  receipts. Those receipts raise `UNVALUED_STOCK_RECEIPT` exceptions only.
- **Out of scope:** weighted-average costing, payroll, loans, fixed assets, budgets, cap table, partner accounts and a
  tax engine.
- **Store-credit expiry:** commerce has no such fact to post.
