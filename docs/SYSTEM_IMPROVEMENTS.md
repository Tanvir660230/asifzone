# System improvements log

Gaps found while doing real work, with the evidence, so each one ends in a better system instead of a manual workaround.
Add to this list whenever a task needs a workaround. Business rules, live prices and stock decisions stay with the owner.

## Done

| Date | Gap | Evidence | Fix |
|---|---|---|---|
| 2026-11-06 | Courier estimates were re-booked every sweep while a parcel waited for the order status | About 1,700 journals a day, one parcel at 14 revisions, amounts unchanged | A waiting estimate keeps its date; a new one takes the courier's first report for that booking |
| 2026-11-06 | A partial push with `cod_amount` equal to the booked COD could be taken as money collected | 999 pushed, rider collected 100 | That figure is ignored; the payout line says what was collected |
| 2026-11-06 | The same return charge could be entered twice | HV2NHQ 120 twice; CUFVSN 100 + 60 | A second charge through the courier is refused, entered or re-marked |
| 2026-11-07 | Stock counts had no “this is everything I have” marker | The last full count had to be found in old chat messages | Count › “This is everything I have” needs every item on the sheet (0 for none); Stock › Today shows the last full count’s date, size and who counted |
| 2026-11-07 | An EPS session expired while EPS was timing out, so a payment taken during the outage would be lost | EPS API timeouts since 11-06; 3 sessions expired with no successful verify in the logs | Before expiring, EPS is asked once more: paid → settled, no record → expired, no answer → kept open up to 24 h, then expired with an error to check in the EPS portal |

## Next

| Priority | Gap | Evidence | Suggested fix |
|---|---|---|---|
| High | A mistaken return charge cannot be removed; only its journal can be reversed by hand, and the order page stays wrong | HV2NHQ, CUFVSN (journals 22387, 22388) | A real `VOIDED` payment status (a migration, so it needs the owner's OK). Reusing FAILED was tried and rejected: it turns the order's payment status to FAILED and shows fake failures in the payments overview. The design must also stop a voided charge being recreated by `settleCourierCollected`, warn when a posted payout covers the charge, and refuse deleted orders |
| High | Nothing shows a payout that has no money recorded on its order | 31 parcels, 3,194 found only by a hand query | A worklist of matched payout lines with no payment, and prefill the amount on the receive screen |
| High | Nothing proves a return reached the shop | Steadfast only sends `assigned` and `processing`; 1 of 81 parcels was scanned | Make the return scan the daily habit, and hold stock as *coming back* until it is scanned |
| Medium | A timeline note on a RETURNED order counts as a new RETURNED move, so the uncollected write-off can be re-dated | `loadExtras` takes the latest RETURNED history row as `returnedAt`; found in code review, not yet seen on live data | Mark bookkeeping notes so they are not status moves |
| Medium | Partial and cancelled parcels can only be received one at a time | 121 parcels went through a script | A bulk receive in Returns in, with a preview, for parcels marked good or damaged |
| Medium | Which item the customer kept is not captured when one of several came back | 5 parcels could not be closed from the money alone | Ask for the kept item when the amount looks like a partial sale |
| Medium | `cod_amount` below the booked COD can still be wrong | CV4FU4 pushed 150, payout 100 | Show it as the courier's claim until the payout confirms it |
| Low | Inventory costing can't start on the opening day before 6 am Dhaka | `activateInventoryCostingInTx` compares a UTC instant with the opening date at UTC midnight (`COSTING_BEFORE_OPENING`, Nasihamart 2026-11-07) | Compare business dates in the store's timezone |
| Low | A singleton section missing from the database can't be added through the API | `createHomepageSection` refuses TRUST_STRIP; only a Studio publish creates it | Allow create when no row of that type exists |
