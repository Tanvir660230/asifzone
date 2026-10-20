# Owner's books

Status: **implemented 2026-10-21** on `feat/owner-books` (P1–P6 below). The design sections that follow are kept as the
specification; §14 records what was built, the decisions taken without the owner's answers, and what is left.

The owner asked for a complete, professional way to keep the shop's books: what was bought (caps in bulk, attar
chemicals, packaging), what was sold, Steadfast and EPS payouts, ad spend, cash held by different people, owner
investment and withdrawals, and costs that are consumed over time. This blueprint extends the existing Financial Core
(`docs/FINANCE_PHASE_*.md`, `docs/MASTER_ERP_FINANCE_MANUFACTURING_BLUEPRINT.md`). It adds no second ledger.

## 0. Findings that shaped the design (local mirror of production, snapshot 2026-10-05)

| Finding | Consequence |
|---|---|
| 0 of 99 variants have a cost price; the 4C valuation cutover (B-1) never ran | No COGS, no profit. The cutover with per-SKU unit costs is the first gate (§10, P0). |
| No `FinanceBusiness` row: books never started; 0 expenses | Opening date and opening balances are P0. |
| 13 PARTIALLY_DELIVERED COD orders (৳18,256) all `UNPAID` | The amount the courier actually collected must come from Steadfast (§3.4). |
| 68 PACKED (8 older than 14 days), 30 PENDING since 2026-09-11, 10 courier status `unknown` | Stale-parcel and lost-parcel handling (§3.5). |
| 233 DELIVERED vs 222 Steadfast `delivered` | Orders delivered outside Steadfast must be marked as such (§3.6). |
| Stock history: ADJUSTMENT ×198 (+213), RESTOCK ×33 (+243), no purchase receipts | Back-valuing every historical stock-in is unreliable → open the books at a recent date (§9). |
| Steadfast API: `status_by_cid` returns only `delivery_status`; `get_balance` returns `current_balance`; a payments list/detail API exists per the unofficial SDK (`payments.list()`, `payments.get(id)` → `consignments[{consignment_id, amount}]`), but the field set is unconfirmed | Payout import is API-first with a statement-file fallback (§3.2). Verify fields against the live key before building. |
| EPS provider only initialises and verifies; no settlement API | EPS settles by statement import + a fee-rate card (§4). |
| Treasury thresholds and production-cost approval require a **different** approver | A single owner can't approve their own production costs today → approval policy decision (§12 Q1). |

## 1. Principles (inherited, non-negotiable)

1. **One ledger.** Every taka posts as a `FinancialEvent` through the Phase 1 processor and `journal.service.ts`.
   New features add facts and posting rules, never balances of their own.
2. **Mapping keys, not account ids.** Every new posting resolves through `AccountMapping`.
3. **Facts in, journals out, corrections by revision.** New event keys are semantic and idempotent
   (`<key>#r<n>` supersedes). Posted journals never change.
4. **Estimates are labelled and trued up.** An estimate (courier charge, gateway fee, planned ad spend) posts under its
   own revision and is replaced by the actual when the statement/API arrives. The difference goes to the same
   expense account as the estimate, never to equity.
5. **Money moves only through Treasury** (deposit, withdrawal, transfer, settlement). Stock moves only through
   `inventory.service` + `costing.service`.
6. **Installation-scoped.** Asif Zone and Nasihamart each keep their own books; nothing is brand-specific in code.
7. **Period lock respected.** A true-up that lands after a period is closed posts in the open period.

## 2. Money map — who holds what (P1)

**Accounts (existing `FinancialAccount`, set up in P0):**

| Account | Kind | Notes |
|---|---|---|
| Cash — Owner | CASH | `custodianAdminId` = owner (new nullable column) |
| Cash — Manager (one per person holding cash) | CASH | custodian = that staff user |
| Each bank account | BANK | |
| bKash / Nagad (merchant and personal used for business) | MOBILE_WALLET | |
| Steadfast COD | COURIER (exists: `clearing.cod`) | |
| EPS | PAYMENT_GATEWAY (exists) | |
| Meta ad account (one per ad account) | new kind `AD_PLATFORM` | Balance = paid in − spent; positive = prepaid asset, negative = owed (§5.3) |

**New behaviour:**

- **Custodian.** A cash account belongs to a person. The money map groups balances by person and by place.
- **Handover = TRANSFER with receipt confirmation.** The sender records it; it stays `AWAITING_RECEIPT`
  (moves nothing) until the receiving custodian confirms. Rejection needs a reason. This reuses the movement's
  pending/approve mechanism with the receiver as the required approver.
- **Cash count.** A custodian records a physical count per cash account. The difference posts to a new
  `expense.cash_over_short` (6970 Cash over/short) with a reason. Counts are listed with who counted.
- **Owner paid from own pocket.** An expense can be paid "by owner personally": Cr 2120 *Owner paid on behalf of
  business* (existing account). Later it is either reimbursed (Treasury withdrawal against 2120) or converted to
  capital (journal 2120 → 3100/partner capital).
- **Investment and withdrawal.** Existing partner register (E11): deposit against partner capital, withdrawal against
  partner current. Profit-sharing rules stay with B-2.
- **Money map page** (`/admin/finance` Overview, top): per person cash, banks, wallets, Steadfast receivable, EPS
  receivable, ad account balances, stock value, supplier dues, owner/partner capital; each figure links to its ledger.

## 3. Steadfast — automatic reconciliation (P2)

### 3.1 Per-parcel charge facts
New table `CourierChargeFact` (one row per consignment per charge kind, revisioned):
`orderId, consignmentId, kind (DELIVERY | COD | RETURN | ADJUSTMENT), amount, basis (ESTIMATED | ACTUAL), source
(RATE_CARD | PAYOUT_API | PAYOUT_FILE | MANUAL), rateCardVersionId?, payoutId?`.

**Rate card** (`CourierRateCard`, versioned by effective date): zone fee by delivery zone (inside Dhaka / sub-Dhaka /
outside), weight step, COD % , return charge rule. Edited in Settings › Courier.

### 3.2 Payout import
- Daily job pulls Steadfast payouts (`payments.list` → `payments.get(id)`), creates one **DRAFT `ClearingSettlement`**
  per payout (`reference` = Steadfast payment id, unique per clearing account → re-import is a no-op), one line per
  consignment, matched by `Order.courierConsignmentId` (fallback: invoice = order number).
- If the API doesn't return per-consignment charges, the owner uploads Steadfast's payout file as downloaded; a saved
  **Steadfast column preset** maps it (existing CSV import + preset).
- The owner opens the draft, confirms the net arrived in the destination bank/bKash, and posts. Optional auto-post
  when the destination statement line matches by amount and date.

### 3.3 Postings
| Moment | Journal |
|---|---|
| Delivery / return recorded (estimate, if enabled — Q2) | Dr 6600 Delivery & courier / Cr Steadfast COD clearing, revision `courier:<cid>:charge#r0` |
| Payout posted | Settlement journal (existing): Dr bank net, Cr clearing gross; per line the ACTUAL charge supersedes the estimate (`#r1`), difference stays in 6600 |
| Charge on a parcel with nothing collected (returned/cancelled) | Line amount 0, fee = charge → 6600 against that order (today this is flagged as unattributed; P2 makes it a recognised line type `CHARGE_ONLY`) |

Result: every order shows its real courier cost; profit per order is visible the day it is delivered (estimate) and
exact at payout.

### 3.4 Partial deliveries
The payout line's collected amount is the fact. When it differs from the order's COD amount, the order is listed for
the operator to record which items came back (existing partial-delivery/return flow), so revenue, stock and the payment
agree. Finance never edits the order.

### 3.5 Stale and lost parcels
- Check `courier.stale_parcels`: booked parcels with no terminal status after N days (setting, default 10).
- **Claim** workflow: mark lost → Dr 1540 *Courier claims receivable* / Cr 1610 at cost (new account) → compensation
  received via settlement line `CLAIM`, shortfall to 5200.

### 3.6 Daily checks (added to `reconciliation.service.ts`)
- `courier.balance`: books' Steadfast clearing balance vs Steadfast `get_balance` (difference listed by consignment).
- `courier.unsettled_age`: delivered COD not paid out after N days.
- `courier.status_mismatch`: order DELIVERED but courier not delivered (and the reverse), unless the order is marked
  *delivered outside courier*.

## 4. EPS (P2)
- **Fee rate card** per payment method (card, bKash via EPS, Nagad via EPS…), versioned by date.
- Payment received → optional fee estimate Dr 6700 / Cr EPS clearing (same pattern as §3.3).
- **EPS settlement import** preset (statement file from the EPS merchant panel); lines match by
  `providerTransactionId`; actual fee supersedes the estimate.
- Checks: `gateway.unsettled_age`, refunds awaiting deduction (exists).

## 5. Advertising (P3)

### 5.1 Campaign register
`AdCampaign`: platform (META | TIKTOK | GOOGLE | OTHER), ad account (`FinancialAccount` of kind AD_PLATFORM),
external campaign id, name, objective, start, end, budget type (DAILY | LIFETIME), budget amount, linked products or
landing page (`/lp/<slug>`), status.

### 5.2 Daily spend facts
`AdSpendDay` (campaign, date, amount, currency, basis PLANNED | ACTUAL, source PLAN | META_API | MANUAL | INVOICE),
unique per (campaign, date, basis).
- **Planned:** generated from the budget (daily budget × active days, or lifetime ÷ days).
- **Actual:** Meta Marketing API Insights (`/act_<id>/insights?level=campaign&time_increment=1`, needs `ads_read`
  via a system-user token stored in Settings › Integrations). Pulled daily for the last 7 days (Meta revises recent
  days), backfilled once for history. TikTok later, same shape. Manual entry for anything else.
- Actual supersedes planned per day.

### 5.3 Postings
| Moment | Journal |
|---|---|
| Daily spend (actual, else planned if Q-setting allows) | Dr 6510 Advertising — <platform> / Cr ad account, key `ads:<campaign>:<date>#r<n>` |
| Owner tops up / card is charged | Treasury TRANSFER bank/bKash/card → ad account (prepaid) |
| Meta invoice with VAT | Amount as billed; tax treatment waits on B-4 |

Ad account balance = payments − spend: positive = prepaid (asset), negative = payable (liability). A daily check
compares it with the platform's reported balance where the API gives one.

### 5.4 Reports
Per day / campaign / product: spend, orders attributed (existing `sessionId` + UTM attribution), delivered revenue,
cost per order, ROAS, **profit after ads** (§8).

## 6. Costs over time (P4)

### 6.1 Prepaid and period costs
`PeriodCost` (prepaid schedule): paid amount, expense account, service start, service end, method (DAILY | MONTHLY).
- Payment: Treasury withdrawal Dr 1720 Prepaid expenses.
- Monthly job: Dr expense / Cr 1720 for the period's share, key `prepaid:<id>:<YYYY-MM>`.
- Shows remaining value and end date; renewal reminder N days before the end (domain, hosting, rent advance).
- Costs used before being paid (electricity, internet) stay **recurring commitments** (exists).

### 6.2 Consumables used per order (packaging)
Packaging (polybag, box, sticker, thank-you card, cap package) becomes **stock-tracked materials** (`Product.kind =
MATERIAL`, existing), bought through Purchasing at actual cost.
- **Packing rules** (`PackingRule`): per category / product / variant / every order — material variant + quantity
  per unit or per parcel.
- When a parcel is handed to the courier (courier booked), `inventory.service` records `PACKAGING_USE` movements at
  moving-average cost → Dr 5300 *Packaging & fulfilment* (new, under COGS) / Cr 1610. Cancelled before pickup →
  reversed.
- **Run-out forecast:** average daily use over the last 30 days → "lasts until <date>", low-stock alert.
- Small untracked items (tape, glue) stay plain expenses on 6800.

## 7. Purchases with extra costs, and attar refills (P5)

### 7.1 Landed cost (caps bought 400/500 at a time)
New document `LandedCostVoucher`: one or more charges (transport, labour, customs, packing at source) paid to any
payee, allocated to one or more goods receipts by quantity, value or weight → `costing.revalueForDocumentInTx`
(existing engine: units still held are revalued, the sold share goes to 5150). The receipt then shows the **true cost
per piece**. Paid via Treasury or as a supplier bill.

### 7.2 Attar refill
- Materials: each attar oil (stock unit `ml`, or `0.1 ml` if half-ml sizes exist), bottles per size (pcs), roller /
  cap, label, box.
- **Recipe** = existing BOM per attar variant (e.g. 6 ml: 6 ml oil + 1 bottle 6 ml + 1 label, wastage %).
- **Quick refill batch** screen: pick variant(s) and quantity → one action creates an in-house production order,
  issues the materials, receives the finished bottles and closes it (the existing M1–M5 lifecycle, advanced
  automatically). Each bottle gets its exact cost; wastage beyond the recipe is reported.
- Needs the approval policy decision (§12 Q1): with a single owner the separate-approver rule must be relaxed for
  in-house refill batches only.

## 8. Profit views (P6)

**Contribution per order** = net sales − COGS − packaging (5300) − courier (6600, estimate → actual) − gateway fee
(6700) − allocated ad spend (by attributed campaign, else by day share).
Reports: per order, product, campaign, day and month; month P&L, balance sheet and cash flow (exist, E6).

## 9. Opening the books (P0)

**Recommendation: opening date 2026-10-01** (past, first of a month).
- Stock: the existing prefill rolls quantities back to the opening date (PR #41); the owner enters a unit cost per
  SKU → valuation cutover (B-1).
- Opening balances: each bank / wallet / cash holder at 2026-10-01, Steadfast receivable on that date (from the payout
  history), supplier dues, owner/partner capital (balancing figure → explained split between capital and earnings).
- From 2026-10-01: orders post automatically; October payouts, ad spend (API backfill) and expenses are entered.
- **Launch period 2026-08-11 → 2026-09-30:** a one-time report (not posted) from orders, Steadfast payouts, Meta spend
  and the owner's purchase list, so the owner knows the profit of the first two months. Its result is the
  explanation of the opening equity.

Why not from day one: 198 manual ADJUSTMENT and 33 RESTOCK stock-ins have no purchase documents; valuing each
retroactively is error-prone and would conflict with the cutover's single-valuation rule.

## 10. Routine (what the owner and manager actually do)

| When | Who | Task | Time |
|---|---|---|---|
| Each expense | anyone | Add expense with photo (phone) | 30 s |
| Each handover | sender + receiver | Record / confirm | 20 s |
| Daily | cash holder | Cash count | 1 min |
| On payout | owner | Open Steadfast / EPS draft, confirm, post | 1 min |
| Each purchase | owner | Purchase order → receive → bill (+ landed cost) | 3 min |
| Each refill batch | staff | Quick refill | 1 min |
| Monthly (1st) | owner | Close checklist: checks all green → lock month → read P&L | 15 min |

Everything else (sales, COGS, courier and gateway estimates, ad spend, prepaid amortisation, packaging use) posts by
itself.

## 11. Phases

| Phase | Content | Depends on |
|---|---|---|
| P0 | Decisions (§12); opening date; accounts and custodians; partners; SKU unit costs; valuation cutover; opening balances | owner data |
| P1 | Money map, custodians, handover confirmation, cash count, owner-paid expenses | P0 |
| P2 | Courier rate card, charge facts, Steadfast payout import, partial/lost/stale handling, checks; EPS fee card + import | P0 |
| P3 | Ad accounts, campaigns, daily spend (plan + Meta API), postings, ad reports | P0 |
| P4 | Prepaid schedules, packaging materials, packing rules, run-out forecast | P0 |
| P5 | Landed cost voucher; attar materials, recipes, quick refill | P0, Q1 |
| P6 | Contribution reports; launch-period report; month-close checklist | P2–P5 |

Each phase: failing Vitest first for posting rules, integration tests on a private test DB, guard tests (writers,
mapping keys), all reconciliation checks MATCHED, browser QA at 1440/375, its own branch and PR.

## 12. Owner decisions needed

1. **Approval policy:** single-owner mode (owner may approve own entries; staff entries need owner) or two-person
   rule (current).
2. **Courier / gateway estimates:** post estimated charges at delivery (recommended) or only at payout.
3. **Opening date:** 2026-10-01 (recommended) or another.
4. **Meta billing:** prepaid top-up (bKash/card) or automatic card billing; ad account currency (BDT / USD).
5. **People and places:** who holds cash; which banks / wallets.
6. **Partners:** owner only, or partners with capital.
7. **Attar:** sizes sold, typical wastage %, whether half-ml sizes exist. **Caps:** packaging per cap or per parcel.

## 13. New accounts and mapping keys (all through `accounts.ts` template + mappings)

| Code | Name | Mapping key |
|---|---|---|
| 1540 | Courier claims receivable | `asset.courier_claims` |
| 1720 | Prepaid expenses (exists, gains mapping) | `asset.prepaid` |
| 5300 | Packaging & fulfilment | `cogs.packaging` |
| 6510 | Advertising — platforms | `expense.advertising` |
| 6970 | Cash over/short | `expense.cash_over_short` |
| — | Ad account balances | `FinancialAccount` kind `AD_PLATFORM` |

## 14. What was built (2026-10-21)

### Decisions taken while the owner's answers (§12) were open — each is a setting, not code
| Question | Default built | Where to change it |
|---|---|---|
| Q1 approval policy | Unchanged: a movement needs approval only above an account's approval amount, or when the person may not post. Quick refills use no cost entries, so a single owner can run them. | Money accounts › approval amount |
| Q2 courier / gateway estimates | ON once a rate card / fee rate exists; withdrawn when the payout posts. | Finance › Setup › Courier & gateway rates |
| Q3 opening date | Not set by code — the owner chooses it in Start the books (recommended 2026-10-01). | Start the books |
| Q4 Meta billing | Both: top-ups are transfers into the ad account; spend comes out daily. A USD account needs `fxRate` in its details. | Money accounts (Ad account) |
| Q5–Q7 people, partners, attar sizes | Data, not code: cash holders, partners, recipes are entered in the UI. | — |

### Built
- **§2 custody:** `FinancialAccount.custodianAdminId`, handover = TRANSFER with `receiverAdminId` (only the receiver can confirm), `CashCount` (difference → 6970 cash over/short, waits for approval), expenses from held cash, owner-paid expenses (2120 or capital), money map (`GET /money-map`), permission `finance.custody` (all roles) and the **My cash** page. Service: `domain/finance/custody.service.ts`.
- **§3–§4 charges:** `CourierRateCard`, `GatewayFeeRate`; the commerce projector books `finance.courier.charge_estimated` / `finance.gateway.fee_estimated` (Dr 6600/6700, Cr 2140/2145) per order until a posted settlement names the order; Steadfast payout import (`courier-payouts.service.ts`, DRAFT settlements matched by consignment id), charge-only settlement lines, the **Steadfast check** page, check `charges.accrued`.
- **§5 ads:** `AdCampaign`, `AdSpendDay`, FinancialAccount kind `AD_PLATFORM` (group 1490); daily spend = actual (Meta Insights via `providers/ads/meta-insights.ts`, or typed) else the budget; posts Dr 6500 / Cr the ad account. **Ad spend** page; Settings › Integrations › Meta ad spend.
- **§6 costs over time:** `PrepaidCost` (payment Dr 1720, monthly share by days), `PackingRule` + `inventory.service.recordPackagingUse` (PACKAGING_USE → 5300). **Prepaid costs** and **Packaging** pages. The finance sync cron also runs `syncOwnerBooks()` (packaging, ads, prepaid).
- **§7:** `LandedCost` (Dr 2117 via Treasury; revalue through `costing.revalueForDocumentInTx`; Dr inventory / Cr 2117 event), **Landed costs** page; **Quick refill** (`domain/manufacturing/quick-refill.service.ts`) runs a production order start to finish from the product's approved BOM.
- **§8–§9:** `GET /profit` (per order and product, down to the books' net profit) and `GET /profit/launch` (estimate before the opening date); **Profit by order & product** page. Overview's "Where your money is" is the money map.

### Verified
API 1640+ tests (new: custody 11, charges 10, ads/prepaid/packaging 7, landed/refill 5, unit 22); web lint/tsc/unit 116; browser QA on a copy of production data at 1440 and 375 px (owner and manager).

### Not done / to verify live
- Steadfast's payout API fields are known only from a third-party SDK — the import parses defensively; check the first real import's draft before posting it. The payout-file import stays as the fallback.
- A landed cost can't be reversed yet (enter a correcting journal if one is wrong).
- Lost-parcel claims (§3.5) are listed (stale parcels) but not yet booked as a claim receivable; account 1540 exists for it.
