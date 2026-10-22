# Smart Analytics programme (2026-10-22)

Owner request: make analytics accurate, smart and complete — "every kind of data you could want", e.g. how many
parcels went to the courier today, compared with other days. Worktree `C:/dev/asifzone-analytics`, branch
`feat/smart-analytics` (from main c75ddef5). One commit per phase. Rules: docs/METRICS_REGISTRY.md (business time via
`resolveBusinessRange` / `utcInstant`, no ad-hoc revenue SQL — SSOT guard), docs/DESIGN_SYSTEM.md (admin light only).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (commit)

## Phases

- [x] **A. Daily pulse (operations by day).** API `GET /analytics/ops-pulse?date=` + `GET /analytics/ops-daily?from=&to=`.
  Per business date: orders placed (web / phone / landing page), confirmed, cancelled, parcels booked with the courier
  (+ COD value booked), shipped, delivered, partially delivered, returned/refused, follow-up holds. Compared with
  yesterday, the same weekday last week, and the 4-week same-weekday average. Hour-by-hour today vs typical. Per-staff
  confirmations / bookings / cancellations. Live queues: awaiting confirmation, on hold, confirmed-not-booked, in
  transit, stuck in transit (> 5 days). Day-by-day table for any range. UI: Analytics › Operations › "Daily pulse"
  (default view) + day picker.
- [x] **B. Accuracy.** Bot filter on PageView (`isBot`, excluded from sessions, visitors, funnels); click ids
  (fbclid / gclid / ttclid) + referrer → channel classifier (Facebook, Instagram, Google, TikTok, WhatsApp, direct…);
  order location from shipping district.
- [x] **C. Delivery outcomes.** Delivery success / refusal rate by district, product, payment method, order source,
  week; COD booked vs collected; average days to deliver by district; repeat refusers.
- [ ] **D. Customer risk score.** Phone-based history (refused, cancelled, returned, delivered) → risk level shown on
  the order; analytics of risky orders.
- [ ] **E. Anomaly detection + daily brief.** Today vs same-weekday baseline for key metrics → insights list +
  notification; morning brief text.
- [ ] **F. Product action list.** Restock / discount / pause ads / fix page (views high, add-to-cart low) in one list.
- [ ] **G. "Why did it change" decomposition.** Sales change split into traffic × conversion × order value, and by
  channel / product / district.
- [ ] **H. Ad spend + ROAS.** Meta Ads daily spend import (needs owner token with ads_read) → spend, CPA, ROAS, profit
  per campaign.
- [ ] **I. Drill-down + compare everywhere.** Every pulse number links to the matching order list; prior-period deltas.

## Resume notes
(update after each phase: what's done, what's next, how to verify)

- **A done.** Definitions in METRICS_REGISTRY §4.5. Real-data findings that shaped them: Steadfast goes PACKED → DELIVERED
  (SHIPPED ~never), a refused parcel is CANCELLED after booking, most orders skip CONFIRMED. Verify stack: private DBs
  `clothing_brand_test_analytics` (vitest, apps/api/.env.test) and `asifzone_analytics_demo` (copy of asifzone_demo +
  its store.* marker settings, migrated), API :4930 (`npx tsx src/server.ts`), web :3930 (`next dev -p 3930`), QA
  owner qa.analytics@local.test (password in the session notes only; recreate with a bcrypt upsert if needed). Redis
  not running locally (noise only).
- **B done** (METRICS_REGISTRY §4.6). Bots are rejected at ingestion (not flagged): only 0.1% of stored pageviews
  were bots, so no historical clean-up. Channel classifier + traffic sources regrouped + Marketing › Channels (sales by
  channel, last non-direct click with 30-day visitor lookback — moved 43% of "direct" orders in the demo data). Order
  location already used the shipping district (nothing to do).
- **C done** (METRICS_REGISTRY §4.7): Operations › Deliveries — success/refusal by week, value, district, product,
  channel, new vs returning, division; repeat refusers. Demo data: 88% delivered, Sylhet/Mymensingh refuse most, ৳2,000+
  orders refuse 20%, one cap colour 60%. `creditedChannels` is exported from traffic.service for reuse.
- Next: **D. Customer risk score** (reuse delivery-outcomes per phone; show on the order).
