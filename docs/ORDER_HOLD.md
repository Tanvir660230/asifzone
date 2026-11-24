# Order hold

The customer asked us to wait — after payday, while they are away, until a date. A held order is neither called nor
booked until then. Owner decisions of 2026-11-22.

## What a hold is

- A flag on a **PENDING or CONFIRMED** order (`Order.holdUntil`, `holdReason`, `holdNote`), not a status. The order keeps
  its status; the state machine is unchanged.
- Every hold is also an `OrderHold` row (reason, until, whether it released stock, who started and ended it, outcome
  `RESUMED` / `CONFIRMED` / `CANCELLED` / `TRASHED`) for the timeline and the hold report.
- A reason and a date are required (`placeOrderHoldSchema`; "Other" needs a note). The date is in the future and at most
  30 days away. Not on a booked order, nor while a courier booking is in flight.
- Two holds per order; a third needs an owner or manager (`orders.escalations`).

## Stock

Units held for someone who may not buy are units a real buyer can't have (owner, 2026-11-22). So:

| Hold | Stock |
| --- | --- |
| First hold, one day or less | kept, like any unconfirmed order |
| Advance paid (≥ the delivery charge, any payment when delivery is free), up to 7 days | kept |
| Anything else | **released at once** — back on sale |

`holdKeepsStock` (packages/shared/src/order-hold.ts) is the rule; the admin dialog shows its answer before saving and the
server decides with its own clock and the payment ledger.

Released units go back through `releaseOrderLines` (the line's `restockedQuantity`, a CANCELLATION movement noted "order on
hold"); ending the hold takes them back through `reReserveOrderLines` — all-or-nothing, **409 `HOLD_SOLD_OUT`** when any of
them was sold meanwhile. Nothing is oversold, and nothing is released twice: a cancel or a trash afterwards finds the units
already back.

Products whose stock isn't tracked are unaffected.

## While held

- Out of Call now, Call later and Escalated, and out of Needs action. Take next call never hands it out.
- Out of Ready to book. Booking (single, bulk, linking a Steadfast parcel) is refused; the booking claim itself requires
  `holdUntil IS NULL`, so a hold placed mid-booking can't lose the race.
- No move forward (Processing, Packed, Shipped…): 409 `ON_HOLD`. No order modification (admin or customer).
- Listed in the **On hold** queue, with a chip on the row ("On hold · 26 Nov", then "Hold due").

## When the date comes

Nothing happens on its own. A pending order is back in Call now (its callback is the hold date, and the age rule waits a
day past it), the order counts in Needs action, and the banner says "Hold date reached". A person then:

- **Ends the hold** — back to its queue with its stock (or the sold-out 409);
- **confirms** it on the call — the hold ends and the stock is taken back in the same transaction;
- or **cancels** it.

## Code

- Rules: `packages/shared/src/order-hold.ts`
- Service: `apps/api/src/modules/orders/order-hold.service.ts` (`placeOrderHold`, `endOrderHold`, `endHoldInTx`,
  `holdTransitionEffect` — called by `applyOrderTransition`, `deleteOrder` ends the hold)
- Routes: `POST /api/orders/:id/order-hold`, `POST /api/orders/:id/order-hold/end` (orders.manage)
- Admin: `apps/web/components/admin/orders/detail/order-hold.tsx` (dialog + banner), `HoldChip` in the list
- Tests: `apps/api/src/modules/orders/order-hold.integration.test.ts`

The older "Hold — call back later" (`POST /:id/hold`, `Order.followUpAt`) is a call reminder, not a hold, and is unchanged.
