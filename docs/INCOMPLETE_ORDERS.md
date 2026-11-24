# Incomplete orders

Shoppers who typed their phone number at checkout or on a landing page and left without ordering. Before this, only a
logged-in customer's cart could be followed up (Abandoned carts, a handful a month), while thousands of checkout visits a
month ended without an order and left nothing to call. Owner decisions of 2026-11-22.

## Capture (storefront)

- `useLeadCapture` (apps/web/hooks/use-lead-capture.ts) on the checkout page and the landing-page order form: once the
  phone is a valid Bangladeshi mobile, the form and the bag are sent (debounced 1.5 s, again on every change) to
  `POST /api/checkout-leads/capture`. Fire-and-forget; the shopper never sees an error from it.
- A short line under the phone field says the details are kept to help if the order doesn't go through (English on
  checkout, Bangla on landing pages — one language per page).
- Server (`captureCheckoutLead`): one OPEN lead per phone (partial unique index), updated in place; a field the shopper
  cleared keeps what they typed before. Not recorded: a phone that asked not to be contacted, a blocked customer, a phone
  that ordered in the last 10 minutes, a bag with nothing real in it. Never holds or touches stock.

## Work list (admin › Orders › Incomplete)

- A lead appears after **30 quiet minutes**, only inside **calling hours 10:00–21:00** store time (a lead from the
  night waits for 10:00), and disappears once **any order from that phone** exists (online, staff-entered, inbox).
- Order: due to call first, then those who reached the address step, then cart value.
- Each card: name, phone, source, address, items (sold-out ones marked), value, earlier orders, a low courier score.
- Actions: **Call** (tel:), **WhatsApp** (prefilled Bangla message with the resume link; logged on the lead),
  **Create order** (opens New order filled in; saving closes the lead as ordered on the call), **No answer**,
  **Not interested** (a reason is required — price, delivery charge, just looking… — or "asked not to call again").
- Two unanswered calls at most: the first sets the last try for the next day at 10:00, the second closes the lead.
- No automatic SMS and no automatic discount (owner: decide after 14 days of calls).

## Ending

- An order from the same phone converts the lead inside the order's own transaction (`convertLeadsForOrder`):
  `ORDERED_ONLINE`, or `ORDERED_BY_STAFF` for a staff-entered order. New order from a lead also closes it by id, in case
  the number was corrected on the call.
- Daily at 04:34 store time (`checkout-lead-sweep`): open leads older than 3 days close as `EXPIRED`; leads older than
  30 days are deleted. A do-not-contact lead is kept with only the phone number so it is never called again.

## Resume link

`/checkout/resume/<leadId>.<HMAC>` (signed like the self-confirm link). It puts the bag back (sold-out items left out),
fills the checkout form once from session storage, and opens checkout — the normal quote prices and checks everything.

## Report

The top of the page: last 30 days — left without ordering, ordered after all, money brought in, top reason for "no".

## Code

- Rules and types: `packages/shared/src/checkout-lead.ts`
- API: `apps/api/src/modules/checkout-leads/` (service, routes, signed code), cron `jobs/checkout-lead-sweep-cron.ts`
- Admin page: `apps/web/app/admin/(shell)/orders/incomplete/page.tsx`
- Tests: `apps/api/src/modules/checkout-leads/checkout-lead.integration.test.ts`
