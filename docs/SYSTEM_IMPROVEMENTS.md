# System improvements log

Gaps found while doing real work, with the evidence, so each one ends in a better system instead of a manual workaround.
Add to this list whenever a task needs a workaround. Business rules, live prices and stock decisions stay with the owner.

## Done

| Date | Gap | Evidence | Fix |
|---|---|---|---|
| 2026-11-06 | Courier estimates were re-booked every sweep while a parcel waited for the order status | About 1,700 journals a day, one parcel at 14 revisions, amounts unchanged | A waiting estimate keeps its date; a new one takes the courier's first report for that booking |
| 2026-11-06 | A partial push with `cod_amount` equal to the booked COD could be taken as money collected | 999 pushed, rider collected 100 | That figure is ignored; the payout line says what was collected |
| 2026-11-06 | The same return charge could be entered twice | HV2NHQ 120 twice; CUFVSN 100 + 60 | A second charge through the courier is refused, entered or re-marked |
| 2026-11-07 | A timeline note on a RETURNED order counted as a new RETURNED move, re-dating the uncollected write-off | `loadExtras` took the latest RETURNED history row; every cancel/void note writes one | `returnedAt` is when the order last moved into RETURNED (`enteredStatusAt`), notes don’t move it |
| 2026-11-07 | Returned parcels could only be received one at a time | 121 parcels went through a script | Orders › select › More › “These came back…”: a preview, then each parcel through the scanner’s own receive; a parcel where the courier collected an item’s price is left for a person |
| 2026-11-07 | Which item the customer kept was easy to miss when one of several came back | 5 parcels could not be closed from the money alone | When the courier collected at least one item’s price, the receive screen warns and starts on “Kept some”; bulk receive leaves such parcels for a person |
| 2026-11-07 | A mistaken return charge could not be removed; only its journal was reversed by hand | HV2NHQ, CUFVSN (journals 22387, 22388) | A real `VOIDED` payment status: "Entered by mistake" on the order's Payments, with a reason; it counts nowhere and the books follow on the next sweep (docs/PAYMENT_LEDGER.md §5d) |
| 2026-11-07 | A payout for a refused parcel left the order without its return charge | 31 parcels, 3,194 found only by a hand query | Posting a payout records the return charge on every refused parcel it names, at the payout’s figure (not the webhook’s); the receive screen prefers the payout figure |
| 2026-11-07 | A script file that failed to download (weak connection, or a page from before a deploy) left the page half-working; only a crash screen reloaded | ~90 ChunkLoadError + 35 truncated-script SyntaxErrors on product/category pages in 7 days | The error listener reloads the page once (at most once a minute) for a missing chunk or a cut-off `/_next/static` file |
| 2026-11-07 | Review dates caused a hydration mismatch on cached product pages | React #418 on /product/azhaar-elite, /product/royal-amber | "x days ago" is filled in after the page loads |
| 2026-11-07 | Wallet-extension and in-app-browser noise filled the error list | `window.ethereum…`, `Non-error thrown: {}` | Dropped as noise |
| 2026-11-07 | An EPS session expired while EPS was timing out, so a payment taken during the outage would be lost | EPS API timeouts since 11-06; 3 sessions expired with no successful verify in the logs | Before expiring, EPS is asked once more: paid → settled, no record → expired, no answer → kept open up to 24 h, then expired with an error to check in the EPS portal |
| 2026-11-07 | Inventory costing could not start on the opening day before 6 am Dhaka | `COSTING_BEFORE_OPENING`, Nasihamart 2026-11-07 | The check compares the store’s business date with the opening date |
| 2026-11-07 | A single-instance homepage section missing from the database could not be added | TRUST_STRIP on Nasihamart | It can be created once when no row of its type exists |
| 2026-11-07 | Two copies of one Steadfast webhook arriving together were both processed; the second failed to log | 51 unique-constraint errors on `CourierWebhookEvent` | The log row is written first and claims the Idempotency-Key; the second copy is a duplicate |
| 2026-11-07 | A Steadfast outage logged one error per parcel per sweep | 4,896 "HTTP 502" + 279 timeouts on 11-02..11-06 | Three failed checks in a row end the run; the rest stay due |
| 2026-11-07 | An EPS outage logged one error per stuck session every 5 minutes | 39 "Could not start the payment session" in reconciliation | The sweep stops at the first "EPS not answering" and tries again next run |

## Next

| Priority | Gap | Evidence | Suggested fix |
|---|---|---|---|
| Medium | A payout for a parcel the customer partly kept still needs a person | Which item was kept is unknown from the money alone | The receive screen now shows and prefills the payout figure; a worklist of these is still to come |
| High | Nothing proves a return reached the shop | Steadfast only sends `assigned` and `processing`; 1 of 81 parcels was scanned | Make the return scan the daily habit, and hold stock as *coming back* until it is scanned |
| Medium | `cod_amount` below the booked COD can still be wrong | CV4FU4 pushed 150, payout 100 | Show it as the courier's claim until the payout confirms it |
| Low | Stock counts have no clear "this is everything I have" marker | The last full count had to be found in old chat messages | A named full count with a date, shown on the stock page |
