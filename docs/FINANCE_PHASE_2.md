# Financial Core — Phase 2: Cash, Bank, Wallets & Reconciliation

Status: implemented on branch `finance/phase-1-foundation` on top of the Phase 1 commit `2a233db`. Not committed.
Phase 3 (sales, COGS, refunds) has not started.

Phase 2 adds the treasury layer to the Phase 1 ledger. Money accounts get bank, wallet and gateway details. Money moves
only as recorded movements that post journals through the central posting service. Statement lines from banks, wallets
and gateways are imported and matched to the books, and bank reconciliations compare a statement period with the books.

## 1. Principles

- **One account system.** Phase 2 extends Phase 1's `FinancialAccount`; there is no second account model.
- **Balances come from the ledger.** No table stores a balance. An account's balance is the sum of the posted journal
  lines on its ledger account. A guard test fails if a balance column is ever added.
- **Every money effect is a journal** posted by `journal.service.ts` (`postJournalInTx`, kind `TREASURY`).
- **Statement lines are evidence, not postings.** Importing or entering a statement line never changes the books.
- **Reconciliation never changes a balance silently.** A difference is matched, left outstanding with a reason, or
  resolved by an explicit adjustment journal. The original lines stay as they were.

## 2. Financial accounts

Kinds: Cash, Bank, Mobile wallet (bKash, Nagad, …), Payment gateway, Courier COD, Other.

Each account has a name, kind, provider/institution, account reference (masked number, merchant or wallet id), account
title and branch (banks), currency, brand scope (`brandId`, or none for business level), status, free-form metadata,
an optional approval threshold, and timestamps.

- **Current balance** is the ledger balance.
- **Opening balance** is the account's line in the posted opening-balance batch (Phase 1), plus a posted
  `OPENING_FUNDING` movement for an account opened after the books started (debit the account, credit Opening balance
  equity). An account can have at most one live opening funding.
- **No credentials.** Metadata keys that look like secrets (password, PIN, OTP, token, key, CVV, …) are refused.
- An account can't be deactivated while it has a balance, a pending movement, or an open reconciliation.

## 3. Money movements (`TreasuryMovement`)

| Kind | Journal |
|---|---|
| DEPOSIT, OPENING_FUNDING, ADJUSTMENT IN | Dr the account · Cr the counter account |
| WITHDRAWAL, ADJUSTMENT OUT | Dr the counter account · Cr the account |
| TRANSFER | Dr the destination · Cr the source (no revenue, no expense) |

Cash deposits to a bank and bank withdrawals to cash are transfers.

Rules:
- **Idempotent.** Every movement request needs an `Idempotency-Key`. A repeat returns the same movement (`replayed`);
  different content under the same key is a 409. The key is held under an advisory lock, so concurrent repeats create
  one movement.
- **Counter accounts** must be postable and active. They can never be revenue or COGS (sales and their cost arrive from
  orders in Phase 3), and never a money account (that is a transfer).
- **Transfers never cross brands.** Moving money between brands needs inter-brand accounts, which don't exist yet.
- **No overdraft** on cash and mobile-wallet accounts. The check runs under a per-account lock, so concurrent
  withdrawals can't overdraw together. Banks and gateways may go negative.
- **Approval.** A movement at or above an account's approval threshold, or requested by someone without
  `finance.post`, waits as `PENDING_APPROVAL` and moves nothing. A `finance.post` holder approves (posts) or rejects it.
  For a threshold approval, the approver must be a different person from the requester.
- **Reversal** posts a mirror journal through the movement (`REVERSED`). It is refused while a statement line is matched
  to the movement. A treasury journal can't be reversed directly through the generic journal API
  (`JOURNAL_OWNED_BY_MOVEMENT`), so a movement and its journal never disagree.
- Every change is audited in its own transaction (Phase 1 audit trail).

## 4. Statement lines and matching

A `BankTransaction` records date, value date, reference, description, debit (money out), credit (money in), signed
amount, currency, external id, statement balance, source (MANUAL / CSV_IMPORT), account and status.

- **Manual lines** are idempotent by the bank's transaction id, or by the `Idempotency-Key`. Only an untouched manual
  line can be deleted.
- **Statuses:** UNMATCHED, PARTIALLY_MATCHED, MATCHED, ADJUSTMENT_REQUIRED, RECONCILED. The database derives both the
  status and `matchedAmount` from the active matches, so they can't drift.
- **Matching** (`BankTransactionMatch`) pairs a statement line with a posted ledger line on the same account, in the
  same direction (money in ↔ debit). Matches can be partial in both directions. The database refuses matching either
  side beyond its amount, using row locks so concurrent matches are safe. Each match records date, user, amount,
  reference, reconciliation run and any adjustment movement.
- **Unmatching** marks a match REMOVED. Matches are never deleted, and a reconciled line's matches are final.
- **Candidates** lists ledger lines on the account with an open remainder, exact amount and nearest date first.
- **Explicit adjustment:** `POST /bank-transactions/:id/adjust` posts an ADJUSTMENT movement for the line's unmatched
  remainder against a chosen account (bank charges, interest income, …) and matches it to the line. It is idempotent per
  line. If the movement needs approval, it stays pending and is matched after approval.

## 5. Statement CSV import

- **Column mapping** is configurable: date, value date, description, reference, debit + credit **or** one signed amount
  (either sign convention), balance, external id. Columns are named by header or by 1-based position, with
  "lines before the header" for letterheads. Seven date formats are supported.
- **Amounts** may carry `৳`/BDT/Tk, thousands separators, parentheses or Dr/Cr suffixes.
- **Preview** shows new rows, rows already imported, and unreadable rows before anything is written.
- **Idempotent twice over:**
  - the same file (by sha256) returns the earlier import;
  - each row has a dedupe key — the external id, or a content hash plus its occurrence number within the file — that is
    unique per account. Overlapping exports add only unseen rows, and two genuinely identical rows in one file both stay.
- Unreadable rows are reported and never guessed. Each `StatementImport` record is append-only.
- No bank-specific integrations are built; the importer is the generic path for future statement sources.

## 6. Bank reconciliation (`BankReconciliation`)

A run covers one account over a statement period, with the statement's opening and closing balances.

| Figure | Definition |
|---|---|
| statement gap | opening + Σ statement lines in the period − closing (must be 0: the statement is complete) |
| difference | closing − ledger balance at period end (reported as is) |
| outstanding (books) | unmatched remainders of posted lines on the account, from the reconciliation start to period end |
| unmatched (statement) | unmatched remainders of statement lines in that window that aren't reconciled |
| unexplained difference | (ledger − closing) − (outstanding − unmatched); must be 0 |

The reconciliation start is the first completed run's start date. Lines before it are covered by that run's opening
statement balance. A statement line matched to a ledger line dated after the period end counts as unmatched for that
period.

**Completing** requires a zero statement gap, every statement line of the period fully matched, and zero unexplained
difference. Outstanding items, such as a deposit in transit, are allowed and counted. On completion, the period's lines
become RECONCILED (final) and the run is frozen.

**History:**
- Each run snapshots account, period, statement balances, ledger balance, difference, matched / unmatched / outstanding /
  adjustment counts, status, user and timestamps.
- Completed and abandoned runs never change, and runs are never deleted.
- Completed runs of an account never overlap and chain: the next run starts the day after the previous one ended, with
  its closing balance.
- One run per account can be in progress.

Example: if the bank says ৳100,000 and the books say ৳98,000, the run reports a ৳2,000 difference and lists the
unmatched items. Each item is matched, or resolved with an explicit adjustment journal. The books are never overwritten.

## 7. API (`/api/v1/finance`, all OWNER-only `finance.*` permissions)

| Route | Permission |
|---|---|
| `GET /financial-accounts[?brandId&kind]`, `GET /financial-accounts/:id`, `GET /financial-accounts/:id/ledger` | read |
| `POST /financial-accounts` (details, optional opening balance), `PATCH /financial-accounts/:id` | configure |
| `POST /movements/{deposit,withdrawal,transfer,adjustment,opening-funding}` (Idempotency-Key required) | transact |
| `GET /movements`, `GET /movements/:id` | read |
| `POST /movements/:id/approve`, `/reject` | post |
| `POST /movements/:id/reverse` | reverse |
| `GET /bank-transactions`, `/:id`, `/:id/candidates` | read |
| `POST /bank-transactions`, `DELETE /bank-transactions/:id` | transact |
| `POST /bank-transactions/:id/{match,flag,adjust}`, `POST /bank-matches/:id/unmatch` | reconcile |
| `POST /statement-imports/preview`, `POST /statement-imports`; `GET /statement-imports` | transact; read |
| `GET /bank-reconciliations`, `/:id`; `POST /bank-reconciliations`, `/:id/{auto-match,complete,abandon}` | read; reconcile |

## 8. Database invariants (migrations `20261012100000_finance_phase2_treasury`, `20261012100100_finance_bank_match_derivation`)

| | Invariant |
|---|---|
| T-1 | Movement amount > 0. The movement's shape fits its kind. POSTED/REVERSED ⇔ journal (and reversal journal). One live opening funding per account. Statement amounts are consistent (one side, amount = credit − debit, matched ≤ amount, reconciled ⇒ fully matched). One reconciliation in progress per account. |
| T-2 | A movement is immutable except its status. Status only moves PENDING → POSTED/REJECTED and POSTED → REVERSED. A movement is never deleted. |
| T-3 | A statement line's financial fields never change. Its status and `matchedAmount` are derived from active matches. RECONCILED is final. Only an untouched manual line can be deleted. |
| T-4 | A match is on the same account and business, to a posted line, in the same direction, and never beyond either side's amount (row-locked). It is never deleted; it only changes ACTIVE → REMOVED, and never once reconciled. |
| T-5 | Imports are append-only. Reconciliations are frozen once completed or abandoned and never deleted. A run completes only with zero unexplained difference and zero statement gap, and completed periods never overlap. |
| T-6 | Audit atomicity (Phase 1 F-6) on every Phase 2 table. |
| T-7 | TRUNCATE is refused on every Phase 2 table. |

The reconciliation framework (Phase 1 §9) gains `treasury.integrity`. It checks that every posted or reversed movement
has its posted journal (or reversal) of its exact amount, and that no statement line's matched amount differs from its
matches.

## 9. Tests

- `statement-parser.test.ts`: date formats, amount formats, mapping by header and by position, letterhead and footer
  rows, dedupe keys (occurrence, stability, external id), sign conventions, the credential rule, the statement-line rule.
- `finance-treasury.integration.test.ts` (real Postgres):
  - accounts with details, credential refusal, opening funding with four-eyes approval;
  - deposit / withdrawal / adjustment idempotency;
  - overdraft and counter-account rules;
  - transfers bank ↔ cash ↔ bKash with only asset lines;
  - five concurrent identical transfers producing one movement;
  - concurrent withdrawals unable to overdraw;
  - reversal and the owned-journal block;
  - threshold approval and rejection;
  - database immutability of movements;
  - brand and business isolation;
  - CSV preview and import, re-import, and overlapping import;
  - import and statement-line immutability;
  - manual gateway lines;
  - candidates, full, partial and concurrent matching, unmatch history, direction and over-match refused by both the
    service and the database;
  - derived matched amount;
  - the ADJUSTMENT_REQUIRED flag;
  - a full August reconciliation (auto-match, two explicit adjustments, a deposit in transit, completion, frozen
    history);
  - chaining, incomplete statement, abandoned history;
  - an unexplained difference blocked, then resolved by an explicit adjustment;
  - audit coverage and atomicity;
  - OWNER-only permissions;
  - ledger balance integrity and drift detection.
- Guards: Phase 2 tables are written only in `domain/finance`; no balance column exists; treasury posts only through
  `postJournalInTx`.

## 10. UI (minimal, for verification)

- `/admin/finance/accounts`: accounts with opening and current balances, the pending-approval queue, deposit /
  withdrawal / adjustment / transfer dialogs, and new account.
- `/admin/finance/accounts/[id]`: balances; ledger, movements (approve / reject / reverse) and statement-line tabs;
  CSV import with mapping and preview; manual line; the match dialog (candidates, partial match, unmatch, flag,
  adjustment).
- `/admin/finance/reconciliation`: history and start form.
- `/admin/finance/reconciliation/[id]`: live figures or frozen snapshot, statement lines, outstanding items,
  auto-match, complete / abandon.

The pages live under the existing Finance module next to Payments. They are visible only with `finance.read`, so STAFF
keeps seeing Payments only.

## 11. Not in Phase 2

- Sales, COGS, refunds and any order or inventory accounting (Phase 3).
- Gateway fee or settlement-timing assumptions.
- Provider-specific bank or wallet integrations.
- Inter-brand transfers.
- Cached balances.
- The executive Finance dashboard.
