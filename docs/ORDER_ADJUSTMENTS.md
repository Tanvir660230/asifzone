# Order Adjustments — free delivery, modifications, store credit, returns, payment links

**Status:** implemented 2026-10-06 (backend foundation + Product Builder field + minimal customer/admin surfaces). The full
Orders UI redesign is deliberately **not** part of this phase.
**Builds on:** [PAYMENT_LEDGER.md](PAYMENT_LEDGER.md), [PRICING_PIPELINE.md](PRICING_PIPELINE.md),
[ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md), [INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md),
[BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md) (D11–D16 added for this phase).

No second pricing, payment, inventory, refund, return or exchange system was added. Every change goes through the
existing writers: the canonical quote (`buildQuote`), the payment ledger (`payment-ledger.service.ts`, the only writer of
`Payment`/`Refund`/`paymentStatus`), the inventory service (the only stock writer), the order state machine
(`applyOrderTransition`), `ReturnRequest`, the outbox, and the existing idempotency patterns.

---

## 1. What existed, what was missing

| Area | Existed | Gap closed here |
|---|---|---|
| Shipping | Zones, free-over threshold, FREE_SHIPPING coupon (`engines/shipping.ts`) | No product-level free delivery |
| Order changes | Price adjustment, detail edits, partial-delivery reconciliation | No way to change items/quantities/variants after placement |
| Money | `Payment` (gateway/COD/MANUAL), `Refund` (REQUESTED→COMPLETED), derived `paymentStatus` | No store credit; no partial-payment status; `PaymentSession` had **no amount** — settlement compared the gateway's amount to `order.total`, so any total change made a live attempt unsettleable |
| Cancellation | Admin T6 transition; "cancelled but paid" refund queue | No customer self-cancel; no way to keep a prepaid amount as store balance |
| Returns | Whole-order RETURN request → RETURNED; EXCHANGE → replacement order (D6) | No item-level return on a delivered order ("kept 1 of 3") with allocated value |
| Payment collection | Retry-payment for a PENDING online order | No admin-generated payment link; no difference/partial payment |
| Credit ledger | None (only `RewardPointsEntry`, loyalty points) | New `CustomerCreditEntry` ledger |

## 2. Product-level free delivery (D11)

`Product.freeDelivery` (boolean, default off) → `CatalogVariant.freeDelivery` → `QuoteLine.freeDelivery` →
`OrderItem.freeDeliverySnapshot`. Exposed in the Product Builder, *Pricing & Inventory → Shipping*.

**Rule (all-or-nothing, deterministic).** Shipping is waived when **every purchasable line** in the cart is a
free-delivery product. Waiver precedence, recorded as `shipping.waivedReason`:

1. `COUPON` — a FREE_SHIPPING coupon applies
2. `FREE_DELIVERY` — every line is free-delivery
3. `FREE_OVER` — merchandise after discounts reaches the zone threshold (all lines count, free-delivery ones included)

| Cart | Result |
|---|---|
| All lines free-delivery | free (`FREE_DELIVERY`) |
| No free-delivery line | zone fee (unless coupon / threshold) |
| Mixed | **full zone fee** — one free-delivery item never frees the whole order; no pro-rata fee |
| Free-delivery item + FREE_SHIPPING coupon | free (`COUPON`) |
| Mixed cart over the free-over threshold | free (`FREE_OVER`) |
| Only normal product removed (order change) | becomes free |
| Normal product added to a free-delivery order | zone fee charged |

`PRICING_VERSION` 2 → 3. The final fee is always computed server-side (storefront cart, checkout, quote endpoints, admin
manual order, order modification — all call `buildQuote`). A placed order keeps its own shipping snapshot; a kept line in
a later modification keeps its own `freeDeliverySnapshot`, so flipping the product flag never changes an existing order.

## 3. Order modification

Service: `modules/orders/order-modification.service.ts`. Record: `OrderModification` (before snapshot, priced plan,
money outcome, actor, idempotency key, status `APPLIED | AWAITING_PAYMENT | SUPERSEDED | CANCELLED | EXPIRED`).
`Order.revision` increments on every applied change.

### 3.1 Who may change what, by status (`orderModificationBlocker`, shared)

| Status | Customer | Admin |
|---|---|---|
| PENDING, CONFIRMED | items, quantities, variants, recipient & address | same |
| PROCESSING, PACKED | — (being prepared) | same as above |
| any, courier booked | — | unlink the booking first |
| SHIPPED | — | — → cancel (T6) or wait for delivery |
| DELIVERED, PARTIALLY_DELIVERED | — | item-level return (§8), exchange (§9), refund / store credit |
| RETURNED, REFUNDED, CANCELLED | — | financial reconciliation only (refund or store credit of what is owed) |

A settled or shipped order is never rewritten to pretend it held something else.

### 3.2 What the client may send

The desired final cart (`variantId`, `quantity`) and optional recipient/address. Never a price, subtotal, discount,
shipping fee, tax, total, stock or payment status — the schema has no such fields.

### 3.3 Pricing a change (`quoteOrderModification`)

- **Kept units keep their snapshot price** (flash price included). When a quantity is reduced, the cheapest units are
  kept first (a reduction never costs the customer a flash price), ties by row id.
- **New units are priced today** (live flash sales, quota re-checked under lock).
- **Bundles** follow today's rules (automatic promotion — any fresh cart would get it too).
- **Coupon (D14):** the order's original coupon is re-checked only for its cart conditions (minimum order, scope,
  minimum quantity); its time window, usage limit and per-customer limits were satisfied at placement and the order already
  counts as one redemption. It is **never worth more than the coupon discount the order had when first placed** (the cap
  comes from the first modification's `before` snapshot), so repeated editing can't ratchet a discount up. If the changed
  cart no longer qualifies, the coupon is dropped, its usage released once (`couponReleasedAt`, D7 style), and **it is not
  restored** by a later change.
- **Shipping** from today's zones and the free-delivery rule; address changes re-resolve the zone.
- **Tax** from the order's own snapshot (`taxMode`, rates) — never today's settings.
- The admin `priceAdjustment` already on the order is carried into the new total.

### 3.4 Applying (atomic)

One transaction under the order row lock: re-price inside the transaction, compare to the confirmed `previewToken`
(409 `MODIFICATION_CHANGED` + fresh preview on mismatch), take new stock first (guarded — 409 `INSUFFICIENT_STOCK`), then
release removed units (`releaseModifiedUnits`, CANCELLATION movements on the order), rewrite lines/totals, release a
dropped coupon, bump `revision`, close every open payment request (§11), settle the money difference (§4). Any failure rolls
everything back. `Idempotency-Key` makes a retried apply return the same modification.

### 3.5 Money outcome (paid orders) — D12

`held = paid − refunded − credited` (from the ledger, never from `order.total`).

| Case | Rule |
|---|---|
| **A** new total > held, online money already received | `AWAITING_PAYMENT`: the order is untouched. The priced plan is stored. A payment session/link collects exactly the difference; its **verified** settlement applies the plan in the settlement transaction. An initiated payment changes nothing. If the plan can no longer be applied when the money arrives (order changed, no longer editable, an added item sold out — checked under row locks *before* writing), the change is `CANCELLED`, the payment stands, and what it overpays goes to the customer's store balance. Nothing is oversold. |
| A, COD or nothing paid yet | applied now; the difference is simply due (courier collects; `codToCollect` follows) |
| A, admin `collectDifferenceLater` | applied now, leaving `PARTIALLY_PAID` (staff collect it: manual payment, payment link) |
| **B** new total < held | applied now; the excess becomes store credit (`ORDER_MODIFICATION`), or a REQUESTED refund for an order without a customer account. The original Payment is untouched. |
| **C** equal | applied; no money moves |

## 4. Store credit ledger (D13)

`CustomerCreditEntry` — append-only, single writer `domain/credit/customer-credit.service.ts` (architecture guard). The
balance is **Σ amount**, derived; there is no balance column. Each row: customer, signed amount, currency, type, reason,
order, source (type + id), payment (for spends), created-by admin, server-derived **unique idempotency key**, timestamp.

| Type | Sign | Source |
|---|---|---|
| CANCELLATION | + | paid order cancelled (customer self-cancel) |
| ORDER_MODIFICATION | + | change lowered the total below what was held; or a paid change that couldn't be applied |
| RETURN | + | item-level return / approved return settled as credit |
| EXCHANGE | + | exchange downgrade (D15) |
| REFUND_TO_CREDIT | + | staff moved an order's refund due to store balance |
| ORDER_PAYMENT | − | balance spent on an order (or reserved for a gateway checkout) |
| ORDER_PAYMENT_RELEASED | + | a gateway checkout's reservation given back (failed / cancelled / expired) |

DB integrity: CHECK (only ORDER_PAYMENT negative, never zero); a trigger refuses any change to customer/type/amount/
currency/key; the only update is linking a reserved spend to the order/payment it became (set once).

**Locking.** Every spend takes the Customer row lock with `SELECT … FOR NO KEY UPDATE` and re-sums. (`FOR UPDATE`
deadlocks against the KEY SHARE lock that an order insert's customer FK check takes — found by the concurrency test.)
Lock order is always Order → Customer.

**Policy (D13, owner-requested defaults):** store-use only — no cash withdrawal, no transfer between customers, no
expiry. Usable on any order the account holder places (storefront, or a staff-entered order for that customer), for
merchandise and shipping, together with coupons, and as a partial payment with COD or a gateway paying the rest. Spending
is only ever the **signed-in account's own** balance — never a guest matched by phone.

## 5. Payment / refund / credit separation

| Concept | Record | Meaning |
|---|---|---|
| Payment | `Payment` (SUCCEEDED) | money received for the order; STORE_CREDIT payments are a tender (credit spent), excluded from cash metrics (`payments_received`, `collected_cash`) |
| Refund | `Refund` | money actually sent back |
| Credit | `CustomerCreditEntry` (issuance) | money owed back, moved to store balance |

Ledger engine changes (`engines/payment-ledger.ts`): new inputs `credits` and `returned` (item-level returns, §8).
`netPaid = paid − refunded − credited`; `refundable` excludes credited money (**no double compensation**: once credited it
can't be refunded, and vice versa — `checkCreditIssue` caps credit at `refundDue`); `amountDue = (total − returned) −
(paid − credited)` for an **open** order (a later increase collects credited money again) and `(total − returned) − paid`
for a **closed** one (CANCELLED / RETURNED / REFUNDED — a credited cancellation owes nothing; corrected 2026-10-06 in the
stabilization pass, where the open-order formula had made a cancelled, credited order show its whole total as still due). New statuses: **PARTIALLY_PAID** (some money received, some due) and **CREDITED** (everything received
moved to store balance). `PARTIALLY_REFUNDED` now means "part of what was received went back, as refund or credit".

Example — paid ৳3,000, customer cancels: Payment ৳3,000 (unchanged) · Refund ৳0 · Credit +৳3,000 · status CREDITED ·
refundable ৳0. A later gateway refund of that money is refused unless the credit is first reversed (not built — no
business rule asks for it yet).

## 6. Store credit at checkout

`useStoreCredit: true` (a choice, never an amount). COD / manual order: one STORE_CREDIT payment of
`min(balance, balance due)` in the order's own transaction; COD collects the rest. Online: the covered part is **reserved**
(an ORDER_PAYMENT entry keyed to the gateway session) and the session's amount is `total − credit`; settlement turns the
reservation into the order's STORE_CREDIT payment; failure/cancel/expiry releases it. If credit covers the whole order no
gateway is involved and the order is placed paid and CONFIRMED. A late success after a release re-spends what the balance
allows; any shortfall stays due (PARTIALLY_PAID) — never invented.

## 7. Cancellation after payment

`POST /api/customers/me/orders/:id/cancel` — own order, PENDING/CONFIRMED, no courier booking. In one transaction: T6
(stock and coupon usage come back), waiting changes cancelled, open links/sessions closed, then `refundDue` → CANCELLATION
credit (key `credit:order:<id>:cancellation`). Repeats change nothing. The "cancelled but paid" alert is suppressed
because nothing is owed any more. Staff cancellations keep the existing flow; staff can then use **Move to store
balance** (`POST /api/orders/:id/store-credit`, REFUND_TO_CREDIT) or record a refund.

## 8. Item-level return (the "kept 1 of 3" parcel)

`POST /api/orders/:id/returns` (`returns.manage`) — DELIVERED, or a reconciled PARTIALLY_DELIVERED. Per line: quantity
returned and whether it can be restocked. Value per unit = the line's **allocated** value: `(price × qty − allocated bundle
− allocated coupon) × returned/qty` (+ its share of merchandise VAT for tax-exclusive orders) — never today's price, never
plain `price × qty`. Effects: RETURN movements (+`returnedQuantity`, idempotent per line), unsellable units then written
off as DAMAGED (not attributed to the order, INV-3 preserved), an APPROVED `ReturnRequest` with `lines` JSON (what came
back, restocked, written off, value), compensation **STORE_CREDIT** (default) / **REFUND** (REQUESTED) / **NONE** (points
reversed, D8), timeline note with the admin. The original lines, prices and total are never rewritten — the ledger nets
the returned value out (`returned` input). Every unit back → the order moves to RETURNED through the state machine.
Duplicates: Idempotency-Key replay; returning the same units twice → 409.

## 9. Exchange (D15)

Unchanged mechanics (D6, `createExchangeOrder`): current effective price, replacement taken from stock before the original
is put back, all in the approval transaction (out of stock → 409, nothing changes). New: the downgrade difference goes to
**store credit by default**; staff may pick `compensation: "REFUND"` (the previous REQUESTED refund) or `"NONE"`. Higher
price: the replacement order's total is the difference (COD, or a payment link). Same price: settled at zero.

## 10. Coupon summary (D14)

Re-check cart conditions only · capped at the original coupon discount · dropped → usage released once, never restored ·
FREE_SHIPPING follows the coupon · historical allocation of kept lines is recomputed for the new cart (the `before`
snapshot keeps the old one).

## 11. Payment links (D16)

`PaymentLink`: 256-bit random token, stored as SHA-256 hash (lookup) + AES-GCM ciphertext (`lib/secret-box.ts`, so staff
can copy/re-send it); status `ACTIVE | USED | EXPIRED | CANCELLED`; amount, currency, purpose (`ORDER_BALANCE` |
`MODIFICATION`), the **order revision** it was priced against, expiry (1 h – 30 days, default 3 days), creator/canceller.
One ACTIVE link per order (partial unique index); regenerating cancels the previous one.

- **Amount authority:** the ledger's balance due, or the waiting modification's difference — never a browser number.
  With store credit or partial payments, only the remainder is requested.
- **Stale links:** any applied change, cancellation or payment closes ACTIVE links in the same transaction; opening a link
  re-checks expiry, order status, revision and the current amount due and refuses a mismatch. A link never pays a
  different amount than it showed.
- **A link never creates a Payment.** `POST /api/pay/:token/start` opens a normal gateway `PaymentSession` with
  `amount = link.amount` and `paymentLinkId`; only the verified settlement (callback/IPN/reconciliation, idempotent per
  session) writes the Payment through the ledger, marks the link USED and (for MODIFICATION) applies the change — once.
- **States:** unpaid → link → initiated (no change) → succeeded (Payment, USED) / failed (session FAILED, link still
  ACTIVE) / expired (EXPIRED) / order cancelled or changed (CANCELLED) / already paid (generation refused, "nothing due").
- **Public view** shows order number, first name, items, amount, expiry, enabled methods — no address, phone, email or ids.
  Rate-limited; `/pay` is disallowed in robots.txt; responses `Cache-Control: no-store`.
- **Sending:** `send: ["SMS","EMAIL"]` at generation or later; recorded as outbox intents (consumer
  `customer-payment-link`), committed with the link; the consumer skips a link that is no longer ACTIVE. One centralized
  template (`packages/shared/src/payment-link-messages.ts`): order reference, amount due, link, expiry.
- **Audit:** generation, sending and cancellation write order timeline notes; attempts are listed per link.
- **Multi-brand:** links, credit entries and modifications hang off `Order`/`Customer` and carry their currency; when a
  store/brand dimension is added it is inherited through those rows — no Asif-Zone-specific logic.

## 12. API

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/orders/:id/modifications/preview` · `POST …/modifications` · `GET …/modifications` | orders.manage / read | admin change (preview → apply; `collectDifferenceLater`) |
| `POST /api/orders/:id/returns` · `GET …/returns` | returns.manage / orders.read | item-level return |
| `POST /api/orders/:id/store-credit` | refunds.manage | refund due → store balance |
| `GET/POST /api/orders/:id/payment-links` · `POST …/:linkId/cancel` · `POST …/:linkId/send` | orders.read / payments.record | links |
| `GET /api/customers/admin/:id/store-credit` | customers.read | a customer's balance + history |
| `GET /api/customers/me/store-credit` | customer | own balance + history |
| `POST /api/customers/me/orders/:id/modifications/preview` · `POST …/modifications` · `GET …/modifications` | customer | own order change |
| `POST /api/customers/me/orders/:id/modifications/:modId/pay` | customer | pay a waiting change's difference |
| `POST /api/customers/me/orders/:id/cancel` | customer | self-cancel (+ store credit) |
| `GET /api/pay/:token` · `POST /api/pay/:token/start` | public (token) | payment link page |
| `POST /api/orders` | as before | + `useStoreCredit`; may return `{ order }` (fully credit-paid online checkout) |
| `POST /api/orders/:id/returns/preview` | returns.manage | read-only: what an item return would value and credit (same `valueItemReturn` the command uses) — Orders UI phase 2 |
| `GET /api/return-requests/:id/exchange-preview` | returns.manage | read-only: what approving an exchange would do (same `priceExchange` approval uses) — Orders UI phase 2 |

Errors use the existing envelope: `ORDER_NOT_EDITABLE`, `MODIFICATION_CHANGED` (+ `preview`), `INSUFFICIENT_STOCK`,
`INSUFFICIENT_STORE_CREDIT`, `CREDIT_EXCEEDS_REFUND_DUE`, `ORDER_NOT_CANCELLABLE`, `RETURN_NOT_ALLOWED`,
`RETURN_EXCEEDS_OUTSTANDING`, `PAYMENT_LINK_NOT_ALLOWED`, `PAYMENT_LINK_INACTIVE`, `MODIFICATION_NOT_PAYABLE`.

## 13. Schema (migration `20261008100000_order_adjustments_store_credit_payment_links`, additive)

`Product.freeDelivery` · `OrderItem.freeDeliverySnapshot` · `Order.revision` · `PaymentSession.amount / paymentLinkId /
orderModificationId` · `ReturnRequest.lines / compensation / compensationAmount / idempotencyKey` · new
`CustomerCreditEntry`, `OrderModification`, `PaymentLink` · enums `PaymentStatus += PARTIALLY_PAID, CREDITED`,
`PaymentProvider += STORE_CREDIT`, `CustomerCreditType`, `OrderModificationStatus`, `OrderEditorType`,
`PaymentLinkStatus`, `PaymentLinkPurpose` · raw: one ACTIVE link per order, one AWAITING_PAYMENT change per order, credit
sign CHECK, credit immutability trigger. No existing row is rewritten. Cron (`payment-reconciliation`, every 5 min) also
expires unpaid waiting changes and expired links.

## 14. Invariants & tests

| ID | Invariant | Test |
|---|---|---|
| CR-1 | only customer-credit.service.ts writes CustomerCreditEntry | `customer-credit-writer.guard.test.ts` |
| CR-2 | credit issued ≤ refund due | engine + integration (cap, refund-to-credit) |
| CR-3 | credited money is not refundable (no double compensation) | engine + integration |
| CR-4 | balance never negative; concurrent spends can't overspend | integration (3 concurrent checkouts) |
| CR-5 | every credit/spend idempotent per key | integration (repeat cancel, double-click credit, failed session twice) |
| OM-1 | a change is atomic: failure leaves the order as it was | integration (sold-out variant) |
| OM-2 | a paid order's increase applies only after verified payment | integration (Case A, wrong amount refused) |
| OM-3 | no oversell when the paid change can't be fulfilled | integration (sold out before payment) |
| OM-4 | stale preview refused; retried apply idempotent | integration |
| FD-1 | free delivery all-or-nothing; history unchanged | engine matrix + integration |
| PLK-1 | a link never pays a stale amount; never creates a Payment by itself; settles once | integration |
| RT-1 | item return value = allocated value; units can't be returned twice | integration |

Test files: `lib/order-adjustments-engine.test.ts` (21), `modules/orders/order-adjustments.integration.test.ts` (32),
`domain/credit/customer-credit-writer.guard.test.ts` (2). Existing tests changed only where this phase intentionally changed
behaviour: partial receipt is now `PARTIALLY_PAID` (was `UNPAID`); `PRICING_VERSION` 3; admin route count 311; three
exchange-downgrade tests now pass `compensation: "REFUND"` explicitly (store credit is the new default).

## 15. Orders UI phase 2 (2026-10-06)

The UI is a layer over the endpoints above; it computes no amount. Shared pieces live in `apps/web/components/orders/adjustments/`
(change-order flow hook, line editor, product/variant picker, address editor, modification summary, money-outcome line) and
are used by both the customer page `/account/orders/[id]/change` and the staff "Change order" dialog. Staff also get "Record
return" (per-line returning / damaged quantities, server preview, Store credit / Refund owed / Nothing), a "Changes & returns"
section with the change history and a change waiting for payment, payment links for exactly a waiting change's difference
(`MODIFICATION` purpose), the exchange preview with Store Balance / refund choice on the Return Requests page, and an
activity timeline that separates Payment, Refund, Store credit, Payment link and Order change. Customers get the change flow,
"pay the difference" for a waiting change, cancellation, the Store Balance page (`/account/store-balance`), the return outcome
on their order, and a product-page "Free delivery" indicator. Eligibility uses the shared guards the API enforces; error codes
map to follow-up actions in `apps/web/lib/order-adjustment-errors.ts` (a re-priced change is shown again, never applied).

Known gaps (no rule invented): there is no endpoint to withdraw a change waiting for payment — it is replaced by a newer change
or expires after 48 h; customers don't see an exchange's price difference before requesting it (staff do, on review); the
Store Balance history returns the latest 50 entries (no pagination yet); extra units of an item already on the order become
a separate line priced today (by design — kept units keep their price), so an item can appear on two lines.

## 16. Not done in this phase (UI phase)

Done in §15 except: admin customer-drawer balance (API ready: `GET /api/customers/admin/:id/store-credit`), staff
cancel-with-credit in one step, reversing a credit to allow a cash refund.
