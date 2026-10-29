# Order Operations — operator runbook

How the order workflow from the Order Operations plan (phases 0–5) runs day to day, what still needs a person outside
the code (M1, M6, M7), and how to release it. The design reasons live next to the code; this file is the checklist.

## Where things are

| Page | What it is for |
| --- | --- |
| Orders (`/admin/orders`) | The daily work list. Finished orders are left out; a search still finds every order. Queues: Needs action, Call now / Call later / Escalated, Ready to book, Handover pending, Coming back, To inspect, Discrepancy, Stuck in transit, Return overdue, Courier issues, refund queues. |
| Dispatch scan (`/admin/orders/dispatch`) | Scan parcels into the courier's hands; confirming the batch records the handover. |
| Returns in (`/admin/orders/returns-in`) | Scan parcels that came back; records receipt only. Stock moves at inspection, on the order. |
| Order history (`/admin/orders/history`) | Finished orders, read-only, searchable by order number, phone, tracking or consignment code, with date / payment / status filters. |
| System health › Courier | Webhook health (Phase 0): events received, refused calls, poll pace. |

### When is an order finished (Order history)?

`apps/api/src/modules/orders/order-history.ts` is the one definition. An order is finished only when it is delivered,
partly delivered, cancelled, returned or refunded **and** none of these is still open:

- money owed or held (delivered: fully paid; cancelled / returned: nothing of the customer's held)
- a COD delivery not yet in a Steadfast payout (the payout sync sets `Shipment.courierPayoutRef`)
- a shipment leg waiting for review (`NEEDS_REVIEW`, `EXCESS_REVIEW`)
- a partial delivery not reconciled
- a unit still due back, or a parcel in hand but not inspected
- a pending return / exchange request or a requested refund

Nothing is moved or archived. When new work appears (a refund request, a review flag, a second return), the order goes
back on the work list by itself. Customer name, phone and address of a finished order can't be edited (409
`ORDER_FINISHED`). Corrections go through refunds, returns, payments and the finance workflows, which keep their own trail.

## M1 — Steadfast callback URL and token (each store)

The webhook accepts a call only when it carries the store's own token, either as `?token=` or as the panel's "Auth
token" (`Authorization: Bearer`). The token is a value of our own choosing, stored in Settings › Integrations › Steadfast
(`STEADFAST_WEBHOOK_TOKEN`). Never paste it into chat or a ticket.

For **each store** (Asif Zone, Nasihamart):

1. Admin › Settings › Integrations › Steadfast: the webhook token shows as set. If it isn't, generate a long random
   value and save it there.
2. Steadfast merchant panel › API / Webhook:
   - Callback URL: `https://<store API domain>/api/courier/steadfast/webhook`. Each store points at its own domain.
   - Auth token: the same value as step 1, copied straight from one screen to the other.
3. Save, then wait for the next parcel status change, or ask Steadfast to resend one.
4. Check admin › System health › Courier. It should show events received in the last 48 hours and no new "bad token"
   or "missing token" refusals. Or run the read-only check under [After deploy](#after-deploy--read-only-checks).

If refusals appear with reason `bad_token`, the panel and the store hold different tokens: redo step 2. With reason
`not_configured`, step 1 is missing. Until the webhook is proven, the 15-minute status poll keeps orders moving, and
Phase 0 keeps that poll at its safe pace.

## M6 — Steadfast return sticker

Codes printed on our labels resolve: order number, tracking number and consignment id, plus label-URL forms of them. A
Steadfast return sticker's own code is not decoded, because we have no sample sticker. Such a scan is logged as
**Unknown code**, changes nothing, and the parcel is found by searching its order or consignment number. When a photo of
a real sticker is available, add its format to `scanCodeCandidates` (`packages/shared/src/parcel-scan.ts`) with a test.

## M7 — USB scanner acceptance checklist

Run once per scanner model, on the station's real computer and browser.

1. Scanner set to keyboard (HID) mode, US layout, **Enter** as suffix, no prefix.
2. Open Dispatch scan. The scan box has focus on load and keeps it after every scan.
3. Scan one booked parcel's label barcode. It shows green **Accepted** with a beep.
4. Scan the same label again. It shows **Already scanned in this batch**, with no second row.
5. Scan any non-store barcode (a product barcode). It shows **Unknown code** and nothing changes.
6. Scan 20 labels quickly, about one a second. All 20 rows appear, none are lost or merged.
7. Click elsewhere on the page, then scan. The code still lands in the scan box and no shortcut fires (for example
   **N** must not open New order).
8. Unplug the network and scan one label. It shows **Waiting**, and Confirm stays off. Plug it back: the scan is
   judged, then Confirm works.
9. Confirm the batch. The parcels show the handover time, and their order status is unchanged.
10. Returns in: scan a cancelled parcel's label. It is **Received**; its stock is unchanged until the order is inspected.
11. If a step fails, test the camera fallback (Scan with camera) on a phone: same results expected.

Record the scanner model, browser and result. A failure at step 1 or 6 is a scanner setting; steps 2–10 are app
behaviour, so report those.

## Why scan facts sit on the order

Handover and receipt times live on `Order`, not `Shipment`, for three reasons:

- A scanned code resolves to an order.
- Each physical parcel the store sends is one order's consignment. An exchange's replacement is its own order.
- Orders from before shipment legs existed have no `Shipment` row.

A second return on the same order is handled. Deciding it clears the earlier receipt on the order, so the new parcel is
expected back; the earlier receipt stays on the timeline and in its scan batch. Move these facts to `Shipment` only if
one order ever ships as several parcels; the app has no split shipments today.

## Settings that change behaviour

| Setting | Default | Meaning |
| --- | --- | --- |
| Shipped SMS trigger | Booking | When the "shipped" SMS goes out. Moving it to Handover (the dispatch scan) is an owner decision after the scanning pilot. |
| Confirmation: unanswered limit / escalate after / retry gap / next-day hour | 4 / 72 h / 120 min / 10:00 | Customer confirmation calls (phase 3). |
| Stuck in transit / Return overdue | 6 / 14 days | Parcel monitoring (phase 5). |

The Handover pending queue covers bookings from the last 7 days, so parcels shipped before scanning started don't fill it.

## Release

Migrations are additive (new columns with defaults, new tables, indexes, triggers; no DROP) and run in this order:

1. `20261201100000_courier_sync_health`: phases 0–1
2. `20261201200000_order_list_ux`: phase 2
3. `20261201210000_order_status_changed_at`: phase 2; backfills from the status timeline
4. `20261202100000_order_confirmation`: phase 3
5. `20261203100000_parcel_scans`: phase 4
6. `20261204100000_courier_automation`: phase 5

`deploy.sh` runs `prisma migrate deploy` per store, so deploy each store in turn. All six also applied cleanly to a
copy of the demo mirror.

## After deploy — read-only checks

Run through the read-only SQL access, once per store:

```sql
-- 1. All six migrations applied
SELECT migration_name, finished_at IS NOT NULL AS done FROM "_prisma_migrations"
WHERE migration_name >= '20261201100000' ORDER BY 1;
-- 2. statusChangedAt backfilled (expect 0)
SELECT count(*) FROM "Order" WHERE "statusChangedAt" < "createdAt";
-- 3. Behaviour unchanged by default (expect BOOKING, 6, 14)
SELECT "shippedSmsTrigger", "stuckInTransitDays", "returnNotBackDays" FROM "StoreSetting";
-- 4. Webhook health, last 48 h (M1)
SELECT count(*) AS events FROM "CourierWebhookEvent" WHERE "receivedAt" > now() - interval '48 hours';
SELECT reason, count(*) FROM "CourierWebhookRejection" WHERE "receivedAt" > now() - interval '48 hours' GROUP BY 1;
-- 5. Both triggers present (append-only call log; status-change time)
SELECT tgname FROM pg_trigger WHERE tgname IN ('OrderConfirmationAttempt_append_only', 'Order_status_changed_at');
-- 6. Work list vs history split (sanity: history holds most delivered orders)
SELECT status, count(*) FROM "Order" WHERE "deletedAt" IS NULL GROUP BY 1 ORDER BY 1;
-- 7. The daily courier check ran (after 08:30 store time the next day)
SELECT day, outcome, "stuckInTransit", "returnOverdue", "handoverPending", message FROM "CourierAutomationRun" ORDER BY day DESC LIMIT 3;
```

In the admin, check Orders › Order history and a queue view (Call now, Coming back). Each lists only its own orders.

Performance: `apps/api/scripts/perf/orders-list-p95.ts` (200-row pages, including the work list and history views) and
`scripts/perf/history-split.ts` (how a database splits between the two). Run them against a copy, never production.
