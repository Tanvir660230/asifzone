# Financial Core — Phase 1: Financial Foundation

Status: implemented on branch `finance/phase-1-foundation` (base `p1/foundations` @ `f879c16`). Phase 2 has not started.

The Financial Core is the books of the **business**. It is a double-entry general ledger with a chart of accounts,
financial accounts, monthly periods and an accounting-event inbox. Every journal goes through one posting service.
The database enforces the accounting invariants, and a transactional financial audit trail records every change.

## 1. Decisions this phase implements (Phase 0)

| Ref | Decision | Where |
|---|---|---|
| F0-1 | One business, several brands. Each brand's commerce data stays in its own database (no merge, no `brandId` on commerce tables). Finance identifies the brand at the financial boundary. | §2 |
| F0-2 | Finance reuses the dashboard's revenue moment and definition (metrics registry `realised_net_sales`) and the dashboard's recorded COGS (`cogs`). It does not define a second revenue. An automated check compares the dashboard with the ledger. | §9 |
| F0-3 | The books start from opening balances at a configurable **Financial Opening Date**, not from replaying incomplete order history. Costs are never invented: KNOWN / ESTIMATED / MISSING / OPENING_BALANCE. | §8 |
| F0-9 | Built in a separate worktree (`C:/dev/asifzone-finance`) on top of `p1/foundations`. Other sessions' uncommitted work is untouched. | — |

## 2. Business, brands, installations

- `FinanceBusiness` is the business whose books these are. It holds the base currency, the timezone, the fiscal-year
  start month (default July, Bangladesh) and the Financial Opening Date. The installation's business key comes from
  `FINANCE_BUSINESS_KEY` (default `main`).
- `FinanceBrand` is a reporting identity *within* the business. A brand that runs as its own installation records
  that installation's `INSTALL_ID`.
- On first use, the installation bootstraps its business. One transaction, serialised by an advisory lock, creates
  the business row, this installation's brand, the default chart and its mappings, each with an audit entry
  (`finance-context.ts`).
- Brand-level views filter on a line's brand (the line's own `brandId`, else its entry's). The business-level
  (consolidated) view is the unfiltered ledger. Every ledger read takes an optional `brandId`.

## 3. Chart of accounts and mappings

- `LedgerAccount` is a tree. Group accounts (`isPostable = false`) only sum their children. Type, normal balance and
  postability are fixed once the account has lines (trigger F-8).
- The default template (`packages/shared/src/finance/accounts.ts`) is ready for Bangladesh: cash, banks,
  bKash/Nagad, gateway and courier COD clearing, VAT, payroll, loans, equity, revenue, COGS, operating expenses.
- Posting code never names an account. It names a **mapping key** (`ACCOUNT_MAPPING_KEYS`), and the business's
  `AccountMapping` row resolves it. The owner can remap keys. `group.*` keys point to the parent under which a
  financial account's own ledger account is created.

## 4. Journals — the central posting service

### 4.1 One writer

`journal.service.ts` is the only code that writes `JournalEntry` / `JournalLine`. `finance-audit.ts` is the only
writer of `FinanceAuditEntry`. Only `domain/finance/` writes finance tables. Code outside Finance reaches the ledger
through financial events or the Finance API. `finance-writers.guard.test.ts` enforces all of this.

### 4.2 Lifecycle

A journal is created as DRAFT and posted by a status change, which assigns a gapless per-business number. Once
posted it is immutable. Corrections follow **Original → Reversal → Corrected entry**: `reverseJournal` posts a
mirror image, and `correctJournal` posts the reversal and the corrected entry in one transaction. A reversal can't be
reversed. Each original allows at most one reversal and one correction (unique columns).

### 4.3 Dates and periods

- Nothing posts before the opening date. Opening balances post exactly on it.
- Periods are calendar months, created on demand, with status OPEN, SOFT_CLOSED or CLOSED. Only `finance.period_close`
  holders post into a SOFT_CLOSED period. Nothing posts into a CLOSED period (database trigger). A period with drafts
  can't close.
- If an event's financial date falls in a CLOSED period, the event posts on the first day of the next period that
  isn't closed, with a reference naming the original date. Closed books are never reopened implicitly.

### 4.4 Idempotency

Every system posting carries an idempotency key, unique per business: `request:<Idempotency-Key>`,
`event:<installId>:<eventKey>`, `reversal:<id>`, `correction:<id>`, `opening:<batchId>`. The key is locked with an
advisory lock and stored with a content fingerprint. A true repeat returns the existing entry (`replayed: true`). A
different request under the same key gets `409 IDEMPOTENCY_KEY_REUSED`.

### 4.5 Money

Amounts are stored as `Decimal(18,2)` in the business currency. In code they are integer minor units, converted
only in `finance-values.ts`. The API takes and returns major units with at most 2 decimals. Phase 1 supports one
currency per business.

### 4.6 Financial audit trail

`FinanceAuditEntry` records the actor (type, admin id, readable label), action, entity, entity id, before/after,
reason, source type/reference, correlation id, timestamp and the writing transaction's id (`txId`). It is written
inside the transaction of the change it records. It is separate from the generic, best-effort `AuditLog`, and the
Finance routes opt out of that log.

### 4.7 Database invariants (migrations `20261011100000`, `…100100`, `…100200`)

| | Invariant |
|---|---|
| F-1 | CHECKs: exactly one positive side per line; non-negative totals; opening amounts positive; a MISSING inventory item has value 0 and no unit cost. |
| F-2 | A journal becomes POSTED only if it has ≥ 2 lines, Σ debit = Σ credit > 0, totals equal its lines, accounts are active, postable and of the same business, the date is inside its period, the period isn't CLOSED, the date is on or after the opening date, opening balances are on the opening date, and it has a number and postedAt. Checked by the status change (on the new row) and again at commit. |
| F-3 | A posted journal and its lines can't be updated or deleted. A journal can't be inserted as POSTED. |
| F-4 | Lines only on active, postable accounts of the journal's business. |
| F-5 | Nothing posts into a CLOSED period. |
| F-6 | **Audit atomicity:** at commit, every inserted/updated/deleted business, brand, account, mapping, financial account, period, journal and opening batch row needs an audit entry from the same transaction (`txId`), or the commit fails. |
| F-7 | The audit trail is append-only. |
| F-8 | Account type, normal balance and postability are fixed once it has lines. |
| F-9 | Posted opening balances (batch, lines, inventory items) are frozen. |
| F-10 | `TRUNCATE` of any ledger table is refused (TRUNCATE fires no row triggers). |
| — | A POSTED financial event is final. An event's identity and payload never change. |

`SET LOCAL finance.maintenance_purge = 'on'` disables these for one transaction. It exists for test databases only;
the guard test forbids it in application code.

**Prisma and commit-time errors.** F-2 (second pass) and F-6 are deferred triggers that run at COMMIT. Prisma 5's
interactive transactions don't report a COMMIT failure: the database rolls back, but `$transaction` resolves. Every
Finance transaction therefore goes through `financeTransaction()` (`finance-tx.ts`), which ends with
`SET CONSTRAINTS ALL IMMEDIATE` so these checks fail inside the callback. A guard test enforces this.

## 5. Accounting events

```
producer transaction ── recordFinancialEvent(tx, envelope) ──► FinancialEvent (unique (sourceInstallId, eventKey))
                                                          └──► OutboxEvent "finance-event-post" (same transaction)
outbox worker (retried, FAILED surfaced) ──► processFinancialEvent(id):
    lock event → posting rule (type@version) → postJournalInTx (key = event identity) → event POSTED   (one transaction)
```

**Envelope** (`packages/shared/src/finance/events.ts`, contract `finance.event` v1): business key, brand key,
source `{installId, system, entityType, entityId}`, event `{type, version, key, occurredAt}`, `financialDate`,
`currency` and `payload`. Today the only producer is this installation. A future remote brand installation can send
the same envelope over an authenticated channel without changes to the accounting core. Remote sync is **not**
implemented.

Exactly-once posting comes from at-least-once delivery:
- the inbox row is unique per event identity;
- processing holds the row lock;
- a POSTED event is final (trigger);
- the journal's idempotency key and `financialEventId` are both unique.

A redelivery with different content is never posted twice and is reported as an error.

**Posting rules** are registered per `(type, version)` and only name mapping keys. Phase 1 ships no commerce rules
(they come in Phase 3). An event without a rule is kept FAILED with `NO_POSTING_RULE`, can be retried, and is never
dropped.

## 6. Admin API — `/api/v1/finance`

| Method | Path | Permission |
|---|---|---|
| GET / PATCH | `/business` (settings, opening date) | read / configure |
| GET / POST / PATCH | `/accounts`, `/accounts/:id` | read / configure |
| GET | `/accounts/:id/ledger?from&to&brandId` | read |
| GET / PUT | `/mappings`, `/mappings/:key` | read / configure |
| GET / POST / PATCH | `/financial-accounts`, `/financial-accounts/:id` | read / configure |
| GET / POST | `/periods`, `/periods/:id/{soft-close,close,reopen}` | read / period_close |
| GET / POST / PUT / DELETE | `/journals`, `/journals/:id` (drafts; POST honours `Idempotency-Key`) | read / transact |
| POST | `/journals/:id/post` | post |
| POST | `/journals/:id/reverse`, `/journals/:id/correct` | reverse |
| GET | `/trial-balance?from&to&brandId` | read |
| GET / POST | `/events`, `/events/:id/retry` | read / reconcile |
| GET / PUT / POST | `/opening-balances`, `/opening-balances/{lines,inventory}`, `/opening-balances/inventory/prefill`, `/opening-balances/post` | read / transact / post |
| GET / POST | `/reconciliation/checks`, `/reconciliation/runs`, `/reconciliation/run` | read / reconcile |
| GET | `/audit?entityType&entityId` | read |

Errors use the standard envelope with a stable `details.code`, e.g. `JOURNAL_INVALID`, `PERIOD_CLOSED`,
`IDEMPOTENCY_KEY_REUSED` or `FINANCE_INVARIANT`.

## 7. Permissions

`finance.read`, `finance.transact`, `finance.post`, `finance.reverse`, `finance.configure`, `finance.period_close`,
`finance.reconcile`. All are OWNER-only until a finance role is decided (F0-5). STAFF gets 403 on every Finance route.

## 8. Opening balances

There is one batch per business. It is edited as a DRAFT, then posted once as a single OPENING_BALANCE journal dated
on the opening date. After that, the batch and the opening date are frozen.

- **Lines** cover cash, bank and mobile-wallet/payment accounts (each must name its financial account), receivables,
  payables, loans, fixed assets, capital and other assets, liabilities or equity. Each line has a side, amount,
  optional party and brand. The category must match the account type.
- **Opening inventory** is one row per SKU with quantity, unit cost or valuation amount, valuation status
  (KNOWN / ESTIMATED / MISSING), method, source, valuation date, confidence and notes. MISSING items are valued at 0,
  can't carry a cost, and are reported as unvalued quantity.
  - The prefill starts from current stock and the catalog's typed cost price, marked **ESTIMATED / LOW** confidence
    (not purchase-verified), or MISSING when there is no cost.
  - The valued total posts to `asset.inventory` with valuation status OPENING_BALANCE.
- The difference goes to **Opening balance equity**, so the journal balances by construction.

## 9. Reconciliation

Each check compares a ledger figure with the existing authoritative figure. Comparisons are exact in minor units.
Every run is kept as a `ReconciliationRun` with its audit entry. Checks run on demand (`POST /reconciliation/run`)
and daily at 03:30 (`jobs/finance-reconciliation-cron.ts`). The daily run is a no-op until an opening date exists,
and differences are logged as warnings.

| Check | Compares |
|---|---|
| `ledger.integrity` | Every posted journal balances; the trial balance balances. |
| `revenue.dashboard_vs_ledger` | Dashboard `realised_net_sales` (same call the dashboard makes, fresh) vs ledger merchandise sales − sales returns, for this installation's brand, from the opening date. |
| `cogs.dashboard_vs_ledger` | Dashboard `cogs` (order-line cost snapshots; coverage of missing costs reported) vs ledger COGS for this brand. |
| `events.unposted` | Financial events FAILED, or RECEIVED for more than 15 minutes. |
| `cost.completeness` | Opening inventory items and posted journal lines whose cost is ESTIMATED or MISSING. These are the financial records affected by incomplete cost data. |

Until Phase 3 registers the commerce posting rules, sales don't reach the ledger. Any dashboard revenue or COGS after
the opening date therefore shows as a **DIFFERENCE**, and the check says why. This is deliberate: nothing is hidden.

## 10. Tests

- `finance-engine.test.ts`: balancing rules, reversal, trial balance, fingerprint, chart template, periods/fiscal
  years, event envelope, the opening-inventory MISSING rule.
- `finance-writers.guard.test.ts`: single writers, no posting from outside Finance, transactions only through
  `financeTransaction`, no maintenance purge in application code.
- `finance.integration.test.ts` (real Postgres):
  - permissions (401/403/200);
  - bootstrap with audit;
  - the opening-date rule;
  - opening balances with KNOWN/ESTIMATED/MISSING inventory;
  - the service and the database refusing unbalanced, group-account and directly-POSTED journals;
  - idempotent drafts, posting and reversal;
  - events delivered many times, including concurrently, posting once;
  - FAILED events kept;
  - a late event moved past a closed period;
  - posted-journal immutability (update, delete, lines, TRUNCATE);
  - correction flow;
  - audit atomicity (no commit without audit; a failed operation leaves no audit; append-only);
  - period close/soft-close/reopen;
  - reconciliation detecting an exact revenue difference.

## 11. Not in Phase 1

Commerce posting rules (sales, refunds, COD settlement, gateway fees). Expenses, payroll, loans, suppliers, fixed-asset
depreciation. Financial statements beyond the trial balance. Year-end close. Multi-currency. Remote brand installations
sending events. A Finance UI.
