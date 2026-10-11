# Financial Core — Fixed assets and depreciation (ERP programme E9)

Status: **implemented and verified (2026-10-09)**.

## 1. Accounts

New template accounts and mapping keys (`FIXED_ASSET_MAPPING_KEYS`). They are provisioned on first use, and the owner can
re-map any of them.

| Key | Default account |
|---|---|
| `asset.fixed_assets` | 1810 Equipment & machinery (existing) |
| `asset.accumulated_depreciation` | 1890 Accumulated depreciation (existing; now mapped) |
| `expense.depreciation` | 6850 Depreciation (existing; now mapped) |
| `income.asset_disposal_gain` | **7300 Gain on disposal of assets** |
| `expense.asset_disposal_loss` | **8300 Loss on disposal of assets** |

## 2. The register

Registering an asset records what the books already hold. Its cost is on its asset account (an 18xx asset account
that takes postings; not inventory, receivables, tax or a money account), put there by:

- a supplier bill line (4E allows asset accounts on expense lines);
- a money movement;
- the opening balances.

`reclassifyFromAccountId` posts one journal that moves the cost there from where it was first booked (Dr asset / Cr that
account).

Each asset (`FA-0001`) records:

- name, category, location, custodian and serial number;
- acquisition date, cost and residual value;
- useful life in months, counted from the first depreciated month;
- the method: straight line, or declining balance with a yearly rate;
- the first depreciated month (`YYYY-MM`, the acquisition month by default);
- opening accumulated depreciation, for assets carried in from before the books;
- the source (supplier invoice, money movement, opening balance, other) with a reference.

The cost and depreciation basis are fixed once a run has used them.

## 3. Depreciation

`monthlyCharge` is pure and exact (half-even):

- **Straight line:** (cost − residual − opening depreciation) ÷ life, each month. The last month takes the rest.
- **Declining balance:** book value × yearly rate ÷ 12. The last month of life takes the rest down to the residual.
- It is never below the residual value.

A **run** covers one month for every asset in use and posts **one journal**: Dr `expense.depreciation` / Cr
`asset.accumulated_depreciation`, each asset as party. Rules:

- Runs go **month after month**. A month posts once (a partial unique index allows one live run per month); a repeat
  returns the same run.
- Future months are refused. Closed periods are refused by the journal service.
- Only the **latest** run is reversed, and not after one of its assets was disposed.
- An asset registered after a run starts after that month; enter what it carried before as opening depreciation.

## 4. Disposal

Sold, scrapped or lost; final. Depreciation must have run up to the month before, and not for the disposal month. One
journal:

- Cr the asset account at cost;
- Dr accumulated depreciation (what the asset carried);
- Dr the money account (cash, bank or wallet) for any proceeds;
- the difference to the book value goes to the disposal gain or loss account.

The asset leaves both accounts at zero.

## 5. Check `fixed_assets.register`

- Each account holding fixed assets equals the cost of the assets in use on it.
- Accumulated depreciation equals their opening depreciation plus the posted runs.
- So no asset is booked without being registered, or depreciated outside a run.
- The check is not applicable until an asset exists.

## 6. API (`/api/v1/finance`)

| Route | Permission |
|---|---|
| `GET /fixed-assets` (register, totals, next run, runs) | `finance.read` |
| `POST /fixed-assets`, `PATCH /fixed-assets/:id` | `finance.transact` |
| `POST /fixed-assets/:id/dispose`, `POST /depreciation-runs` | `finance.post` |
| `POST /depreciation-runs/reverse-latest` | `finance.reverse` |

That adds 6 routes, 526 admin routes in total.

**UI:** Finance → **Fixed assets** shows:

- cost, depreciated so far, book value and next month's charge;
- the monthly run card (run the next month, or reverse the latest);
- the register (book value, monthly charge, "until" month, method), including disposed assets on request;
- the runs;
- the register and dispose dialogs (the dispose dialog shows the gain or loss before confirming).

## 7. Database

Migration `20261026100000_finance_fixed_assets`:

| Invariant | Rule |
|---|---|
| A-1 | Values: cost > 0, residual within cost, life 1–1200 months, a declining rate exactly for that method, opening depreciation within cost − residual, months as `YYYY-MM`; disposed assets carry date, journal, proceeds and result. One posted run per month. Lines are positive. |
| A-2 | An asset's cost and depreciation basis are fixed once a posted run used it. A disposed asset is final. An asset with depreciation or a disposal is never deleted. |
| A-3 | Runs and lines are append-only; a run only goes POSTED → REVERSED. |
| A-4 | Audited at commit; no TRUNCATE. |

## 8. Verified

- `finance-payables.integration.test.ts` +2 tests:
  - **Charge maths:** straight line, the last month's remainder, declining balance, the residual cap.
  - **A laptop billed by a supplier to 1830, registered:**
    - the register matches;
    - runs 2026-08 and 2026-09 post in order; out-of-order is refused; a replay returns the same run;
    - the basis is fixed after depreciation.
  - **Shelving reclassified from 6900:** it must start after the last run; the register still matches.
  - **Reverse and re-run** the latest month.
  - **Totals:** cost ৳72,000, depreciated ৳5,000, book value ৳67,000.
  - **Disposal:** the laptop is sold for ৳50,000 against a book value of ৳55,000, a ৳5,000 loss. Future dates and missing
    proceeds accounts are refused. The register matches, and the run can no longer be reversed.
- Full API regression: 110 files, 1305 / 1305. Authorization matrix: 526 routes.
- Browser QA (`finance_qa`):
  - an "Embroidery machine" billed at ৳120,000 to 1810 (BILL-000002), registered with ৳12,000 residual over 60 months;
  - October's run posts ৳1,800, leaving a book value of ৳118,200;
  - Finance checks: "Fixed-asset register = ledger" matches;
  - 1440 and 375 px.

## 9. Limitations

- **Full months only.** Depreciation is by whole months, with no part-month convention.
- **No revaluation or impairment.** Neither is supported yet.
- **Proceeds through Treasury:** done (2026-10-10). The disposal journal debits 1530 *Asset sale proceeds receivable*; a Treasury deposit into the chosen money account (against 1530, idempotent, approval thresholds apply) brings the money in and is linked to the asset. While a deposit awaits approval, the buyer still owes it on 1530.
