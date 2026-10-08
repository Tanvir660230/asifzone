# Customer account (signed-in area)

The signed-in account at `/account/*` is one place, not a set of separate pages: a persistent shell with section tabs, and
only the content below them changes. Design source: the "Asif Zone account home" canvas (desktop + 375px).

## Information architecture

Five sections (`apps/web/lib/account.ts` → `ACCOUNT_SECTIONS`). Sections with more than one page show a second row of pills.

| Section | Pages |
|---|---|
| Home | `/account` |
| Orders | `/account/orders` (`?show=open\|done`), `/account/orders/[id]`, `/account/orders/[id]/change`, `/account/returns` |
| Wallet | `/account/store-balance`, `/account/reward-points`, `/account/coupons` |
| Saved | `/account/saved` (wishlist), `/account/browsing-history` |
| Settings | `/account/settings` (profile, phone, password, notifications), `/account/addresses` |

`/wishlist` stays the guest (device) wishlist; a signed-in customer is sent to `/account/saved`.

## Home

Everything at a glance from **one request**, `GET /api/customers/me/summary` (`account-summary.service.ts`, shared type
`AccountSummary`): order in progress, up to three recent orders, store balance, points, active coupon count, wishlist
count, pending returns, default address, member-since date. The home refetches it on every visit (`staleTime: 0`) and
shows the cached copy meanwhile, so changes made elsewhere (orders, addresses, balance) show up without invalidation.

Blocks, top to bottom: greeting with one sentence about what matters now, member card, order in progress (or a
first-order welcome), recent orders, saved for later (falls back to recently viewed), "Finish setting up" (verify email /
phone, gone when done), delivery address. Editing lives in Settings; the home is for looking.

## Design rules for these pages

- Build from `components/account/account-ui.tsx`: `AccountTitle`, `SectionHeading`, `GroupedList` + `ListRow`, `RowIcon`,
  `OrderThumb`. Solid surfaces (`bg-surface` + `ring-line-subtle`), semantic tokens only — brands re-theme via variables.
- The member card (`member-card.tsx`) is the one bold element: inverse surface, store name from site settings (never
  hard-coded), store balance in the display face. Its settle-in and the order progress fill are the only motion that
  plays on its own; both are transform/opacity and follow reduced motion via `MotionConfig`.
- Every block handles loading (shape-matched skeletons from `account-skeleton.tsx`, never a full-page loader), empty and
  error (with retry) states, and works at 375px.
- Customer-facing words for statuses live in `lib/account.ts` (`orderHeadline`, `ORDER_PROGRESS_STEPS`,
  `RETURN_STATUS_LABEL`) — never show raw enum values.

## API notes

- `GET /api/customers/me/orders` leaves out trashed orders (their detail page is a 404 for the customer) and adds
  `previewImageUrl` (first line's product photo) for the order list.
- Tests: `apps/api/src/modules/customers/account-summary.integration.test.ts`.
- Local design data: `apps/api/scripts/seed-account-home-demo.ts` (local databases only).
