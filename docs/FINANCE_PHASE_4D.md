# Financial Core — Phase 4D: Purchase orders, goods receipts and supplier returns

Status: **implemented and verified (2026-10-09).** It builds on 4C (`29e6ad1`) and follows `FINANCE_PHASE_4.md` §2,
decisions 2, 5, 6, 13, 16 and 21, and the proposal §8, §9 and §20.

```
Supplier → Purchase order (commitment, posts nothing) → Goods receipt (stock + value in; Dr inventory / Cr 2115 GRNI)
                                                      → Supplier return (stock out at the average; Dr 2115 / Cr inventory)
Supplier invoice (GRNI → AP, matching), payments and allocation are 4E / 4F.
```

## 1. Documents and lifecycles

Each lifecycle is enforced by a database trigger (P-1). Only drafts are deleted.

| Document | States | Notes |
|---|---|---|
| Purchase order | DRAFT → SUBMITTED → APPROVED → PARTIALLY_RECEIVED ↔ RECEIVED; CLOSED; CANCELLED | Lines can be edited only in DRAFT. Received and returned quantities are **derived** by triggers. An order can be cancelled only before anything is received; after that it is closed. |
| Goods receipt (GRN) | DRAFT → POSTED → REVERSED | A posted receipt is immutable. A reversal records only its own stock movement. |
| Supplier return | DRAFT → APPROVED → SHIPPED; CANCELLED | Lines are frozen once approved. Shipping writes the stock movement and the value. |

Numbers come from `FinanceSequence`: PO-000001, GRN-000001, RTN-000001.

## 2. Rules

- **Purchase order lines**
  - STOCK lines must be stock-tracked variants (decision 6, `PURCHASE_UNTRACKED`).
  - NON_STOCK lines must name an active EXPENSE or COGS account that takes postings.
- **Suppliers:** a supplier on hold or inactive takes no new orders. An inactive supplier takes no receipts.
- **Approval** (`purchasing.approve`):
  - `FinanceBusiness.purchaseApprovalThreshold`: at or above it, the approver must not be the order's creator. Null
    means no separation, which suits a single-owner business.
  - Settings: `PATCH /purchasing/settings` (`finance.configure`).
- **Receipt unit cost:**
  - normally the order line's net price plus the **non-recoverable** part of its tax per unit (integer, half-even).
    Recoverable tax is recovered at the invoice (4E).
  - A receipt without an order states the actual cost.
- **Accepted vs rejected:** only accepted units become stock. Rejected units are recorded with no value.
- **Over-receipt:** received beyond `ordered × (1 + overReceiptTolerancePct)` needs `purchasing.approve` and a reason.
  It is recorded on the receipt.
- **Receipt without a purchase order** (decision 2) needs:
  - a reason (`directReason`);
  - evidence;
  - posting by an approver (`directApprovedByAdminId`, CHECK P-5).
- **Costing gate (D-P1):** receipts and returns *post* only once inventory costing is active (`COSTING_NOT_ACTIVE`).
  They can be drafted before that. Each line's variant must be costed — `recordDocumentMovements` refuses unvalued
  movements.
- **Reversal** (`purchasing.approve`, with a reason):
  - The units leave at the receipt's own unit cost (SNAPSHOT outflow).
  - The receipt's journal is reversed through a void revision `grn:<id>#r1` that supersedes `#r0`.
  - It is refused if any of the receipt's units are on an approved or shipped return, or if the stock is no longer
    there (409).
- **Returns:**
  - A line referencing a receipt line can't exceed what that receipt accepted, net of other approved or shipped returns
    (checked at create and at approve).
  - Shipping values the units at the running average. The return's value is exactly what the books take out of
    inventory.

## 3. Quantity, value and the books in one transaction

`inventory.service.recordDocumentMovements` is the one entry point for stock moved by a document. It:
- locks the variants in id order;
- takes guarded deltas (an outflow never goes below zero);
- writes `PURCHASE_RECEIPT` / `PURCHASE_RETURN` movements;
- values them with `LedgerOwner = DOCUMENT`.

The costing engine posts only cost adjustments, such as deficit cover, through `inventory.valued`. The document posts the
book value the engine returns:

| Event | Key | Posting (supplier as party) |
|---|---|---|
| `purchasing.goods_received` v1 | `grn:<id>#r0` (void `#r1`) | Dr `asset.inventory` / Cr `liability.grni` |
| `purchasing.return_shipped` v1 | `preturn:<id>#r0` | Dr `liability.supplier_returns` / Cr `asset.inventory` |

New check **`purchasing.grni`**: GRNI balance = Σ posted receipts − Σ shipped returns (invoices from 4E). It also
requires every `purchasing.*` event to be posted.

## 4. API (`/api/v1/purchasing`)

| Routes | Permission |
|---|---|
| `GET /variants` (lookup), `GET /purchase-orders[/:id]`, `GET /goods-receipts[/:id]`, `GET /returns[/:id]` | `purchasing.read` |
| `POST /purchase-orders`, `PATCH /:id`, `DELETE /:id`, `/:id/submit`, `/:id/return-to-draft`, `/:id/cancel`; `POST /returns`, `DELETE /returns/:id`, `/returns/:id/reopen`, `/returns/:id/cancel` | `purchasing.manage` |
| `/purchase-orders/:id/approve`, `/:id/close`, `/goods-receipts/:id/reverse`, `/returns/:id/approve` | `purchasing.approve` |
| `POST /goods-receipts`, `DELETE /goods-receipts/:id`, `/goods-receipts/:id/post`, `/returns/:id/ship` | `purchasing.receive` |
| `PATCH /settings` | `finance.configure` |

There are 26 routes, giving 452 admin routes in total. STAFF orders and receives; approvals stay with OWNER and
FINANCE_ADMIN.

UI: Finance →
- Purchase orders (list; create with stock and service lines; detail with lifecycle actions and receiving);
- Goods receipts (post, reverse, receipt without an order);
- Supplier returns (from receipt lines; approve; ship).

## 5. Database (migration `20261017100000_finance_phase4d_purchasing`)

| Invariant | Rule |
|---|---|
| P-1 | Lifecycle transitions are enforced; final states are immutable. |
| P-2 | Lines are frozen outside DRAFT, except each posting's own columns. |
| P-3 | Received and returned quantities are maintained only by triggers on receipt and return status changes. A direct write is refused. |
| P-4 | Positive quantities. `value = accepted × unit cost`. A STOCK line ⇔ a variant; a NON_STOCK line ⇔ an expense account. |
| P-5 | A posted receipt without an order has a reason and an approver. |
| P-6 | An audit entry at commit for every document change; no TRUNCATE. |

Variants referenced by purchasing documents are protected from deletion (FK Restrict). `PurchaseOrder.currency` is a
document snapshot; the store-identity guard allowlists it.

## 6. Verification

- `finance-purchasing-documents.integration.test.ts` (9 tests): real opening balances, then the real cutover, then:
  - **orders:** untracked goods and suppliers on hold refused; draft editing; frozen lines and derived quantities (DB);
    approval permission and creator separation above the threshold;
  - **receipts:** a draft before costing that can't post; a concurrent post that posts once and replays once; a unit
    cost including non-recoverable tax (120 + 10.80); the average; the Dr/Cr journal with the supplier as party; the
    order status;
  - **over-receipt** needs an approver and a reason;
  - **receipt without an order:** untracked goods refused; approver only;
  - **reversal** at the receipt's cost, then immutable;
  - **close vs cancel**;
  - **returns:** cap; approval; shipped at the average; derived returned quantity; idempotent; a receipt with returns
    can't be reversed;
  - every step: `purchasing.grni`, `inventory.valuation_vs_ledger`, `inventory.quantity_vs_valuation`,
    `inventory.valuation_postings`, `ledger.integrity` and `events.unposted` all MATCHED.
- Updated tests: authorization matrix (452 routes, +5 owner-only), the writer guard (cutover + 4D tables), the Phase 1
  check count (17), and the store-identity allowlist.
- Browser QA (`finance_qa`, 1440 and 375 px) ran the whole flow through the UI:
  1. order;
  2. submit;
  3. approve;
  4. receive 18 accepted / 2 rejected → "partly received";
  5. return 3 from that receipt → ship (৳2,649.06 = 3 × moving average 883.02);
  6. all six checks "matches".
