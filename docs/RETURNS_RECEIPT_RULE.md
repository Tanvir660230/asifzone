# Returns: restock only at receipt (Goods awaiting return)

Blueprint P0.4 — owner decisions Q5 = A, Q13 = C, Q13b = B, Q-A (account 1620), Q-B (14 / 30 days, ৳1,000), Q-C
(write-off, no automatic charge). Design: blueprint tab 11. One rule for every store; it is **off** until that store's
owner turns it on.

## 1. The switch

`FinanceBusiness.returnsReceiptRuleEffectiveAt` — NULL = off (every return restocks at approval, as before). The owner sets
it from a business date, today or later (never backdated), on Returns & refused parcels › Parcels to receive, or
`PATCH /api/v1/finance/business { returnsReceiptRuleEffectiveDate }` (finance.configure). Turning it on provisions account
**1620 Goods awaiting return** (asset, under 1600) and its mapping `asset.goods_awaiting_return`; it is refused before the
books have an opening date. Clearing it turns the rule off for returns agreed from then; what is already awaited can still
be received or written off.

Before turning it on (tab 11 §7, tab 5 §7): restore a private copy of the store's latest backup, migrate with the rule off,
compare closed-month statements, trial balance, partner shares and balances to the minor unit, then set the date on the
copy and replay the open month. Closed months and posted shares are never touched: the rule only affects returns agreed
after its date.

## 2. What changes while it is on

| Path (tab 11 §1) | At the agreement | Later |
|---|---|---|
| R1 order moved to Returned (staff or an approved RETURN request) | units agreed back, no stock moves | Receive on the order |
| R2 partial delivery reconciled | refused units agreed back; damage is recorded at receipt | Receive on the order |
| R3 exchange approved | replacement ships; the original is agreed back | Receive on the order |
| R4 parcel cancelled after shipping | unchanged (receive-return, as today) | — |
| R5 item return on the order page | "here at the shop" → agreed and received in one step (S12); "still with the customer" → agreed only | Receive on the order |

Each agreement is a `ReturnExpectation` (one per order line per agreement) and moves `OrderItem.awaitingReturnQuantity`
(and `returnedQuantity`) up. Receive moves units to `restockedQuantity` with a RETURN movement linked to the expectation
(damaged ones then leave as DAMAGED). A unit is always exactly one of: with the customer, awaiting return, back in stock,
or written off as never returned (`returnLostQuantity`) — enforced by conditional updates and a CHECK constraint.

- **Never returned (S7):** only `returnLossDays` (30) after the agreement, every open unit of that agreed line at once,
  with a reason ("Customer kept the item" for an exchange original, Q-C). At or above `countLossApprovalThreshold`
  (৳1,000), or with no recorded cost, only someone holding `inventory.approve` (the owner).
- **Withdrawn (S8):** an item return nothing of which came back yet, with no store credit or refund recorded for it;
  the request ends REJECTED. A Returned order is closed and can't be reopened — write off what never comes back.
- **COMPLETED:** a request all of whose agreed units were received or written off.
- **Follow-up:** lines out ≥ `returnFollowUpDays` (14) are overdue on Returns & refused parcels and Home.

## 3. The books (tab 11 §4)

| | Entry | When |
|---|---|---|
| S1 agreement | Dr 1620 Goods awaiting return / Cr COGS | the agreement (first open month if closed) |
| S2 received good | Dr Inventory / Cr 1620 | the receipt |
| S3 received damaged | S2, then Dr Shrinkage / Cr Inventory | the receipt |
| S5 exchange | S1 for the original; the replacement's cost Dr COGS / Cr Inventory at its delivery | |
| S7 never returned | Dr Shrinkage / Cr 1620 | the write-off |
| S8 withdrawn | S1 and the sales return reversed (void revisions) | the withdrawal |

Every amount is the line's recorded unit cost (or its approved estimate). The sales return (revenue) is unchanged: at the
agreement, as before. The dashboard engine counts a returned unit at the agreement too (METRICS_REGISTRY §3), so books and
dashboard COGS agree. Reconciliation check `returns.goods_awaiting_return`: 1620 = Σ (agreed − received − written off) ×
unit cost, per order; a DIFFERENCE keeps the month from Final.

## 4. Code

`modules/returns/goods-awaiting-return.service.ts` (receive, write-off, withdraw, list), `modules/inventory/inventory.service.ts`
(`expectOrderLineReturns`, `receiveExpectedUnits` — the only writers of the counters), the five paths in
`order.service.ts`, `return-request.service.ts`, `order-adjustments.service.ts`; postings in `commerce-posting-rules.ts`
and `commerce-accounting.service.ts`; set-up and check in `domain/finance/returns-accounting.service.ts`. Tests:
`domain/finance/returns-receipt-rule.integration.test.ts` (S1–S13, concurrency, replay, switch on/off).
