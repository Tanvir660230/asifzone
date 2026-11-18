# Business reports — targets, scorecard, team activity, scheduled reports

> For agentic workers: one commit per part, failing test first for every API change (CLAUDE.md, `test-driven-development`).
> Worktree `C:/dev/asifzone-business-reports`, branch `feat/business-reports` off `origin/main`; API :4970, web :3970,
> demo DB `business_reports_demo` (copy of premium_money_view), test DB `business_reports_test` (private, migrated + seeded).

**Owner (2026-11-18):** "I used to see the analysis nicely, now I can't. A business organisation needs everything —
why isn't it here? Add what's best." Picked all four: monthly targets, a one-page business scorecard, staff
activity, weekly / monthly reports. (The navigation part — analysis one click from Reports — is on feat/premium-ui,
6006120f.)

**Rules:** every business number comes from the metrics service (`computeMetrics`, docs/METRICS_REGISTRY.md) or the
books (`profitByDay`), never a new hand-written sum. Setting targets is owner-only (`settings.manage`); reading
progress needs `analytics.read`; profit figures need `finance.read` and are left out otherwise. Nothing is sent to
anyone unless the owner turns it on. Website UI in English. No price changes.

## Part 1 — Monthly targets

- [ ] Prisma `MonthlyTarget { month "YYYY-MM" @id, netSales Decimal?, orders Int?, profit Decimal?, updatedAt,
      updatedByAdminId }` + migration.
- [ ] Pure `targetProgress({ target, actual, elapsedDays, daysInMonth })` → per metric: actual, target, % done,
      expected-by-today, projected month-end (actual ÷ elapsed × days), status on-track / behind / no-target.
      Unit test first.
- [ ] `GET /api/targets/:month` (analytics.read) — targets + actuals for the store-local month: net sales =
      `realised_net_sales`, orders = `orders_placed`, profit = Σ `profitByDay` (finance.read only) — and progress.
      `PUT /api/targets/:month` (settings.manage) validates (positive, month format). Integration test first,
      including the permission matrix.
- [ ] Web: "This month" panel at the top of Reports › Overview and a compact one on the Dashboard: three progress
      bars (done, expected-by-today marker, projected), "Set targets" dialog for the owner, empty state that invites
      setting the first target.

## Part 2 — One-page business scorecard

- [ ] `GET /api/analytics/scorecard?month=` — one call, this month to date vs the same days last month vs target:
      net sales, orders, AOV, delivery success %, return rate, cancellations, ad spend, ROAS, profit (finance.read),
      cash held, owed to you (courier + gateways + customers), you owe (suppliers), stock value. Each figure from its
      existing source; status green / amber / red by a stated rule.
- [ ] Web: Reports › Overview opens on "Scorecard" (segmented control beside AI insights / Lifetime), print-ready
      (a "Print / save as PDF" button with a print stylesheet).

## Part 3 — Team activity

- [ ] `GET /api/analytics/team?from&to` — per admin from `OrderStatusHistory.changedByAdminId`: confirmed,
      cancelled, packed, shipped, delivered/returned marked; median time from placed to confirmed for orders they
      confirmed. Integration test first.
- [ ] Web: Reports › Operations gets a "Team" view.

## Part 4 — Weekly and monthly reports

- [ ] Settings › SMS notifications: "Weekly report" (Saturday morning) and "Monthly report" (1st of the month)
      toggles, **off by default**, sent to the existing admin alert phones — same channel as the morning brief.
- [ ] Job builds the text from the scorecard (sales, orders, delivery %, profit, vs target) — pure formatter with a
      unit test; the job reuses the daily-brief sending path.

## Verify

`pnpm --filter api test` (targeted files, then the full suite alone), `pnpm --filter web lint`, `pnpm --filter web
test`, screenshots at 1440 and 375 for every new screen, an e2e for setting a target and seeing progress.
