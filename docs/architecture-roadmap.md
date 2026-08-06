# Architecture Roadmap: Future-Ready Extensibility

Audit-only round — no application code was changed to produce this document. Scope, per explicit choice: **Multi-vendor/Multi-brand** and **API-first/Mobile/Headless/AI**. Multi-currency, multi-warehouse, and multi-language are real future goals too, but were deliberately deferred this round (see the note at the end) rather than diluted across everything at once.

The guiding principle throughout: "ready" does not mean "built." The goal is the minimum schema/contract groundwork that prevents a rewrite later, without building seller dashboards, payout splitting, or i18n infrastructure nobody needs yet. Every recommendation below is additive and backward-compatible with the single-tenant, single-currency, cookie-authenticated store that exists today.

## 1. Multi-vendor / Multi-brand readiness

### What's true today
The store is single-tenant at the schema level, not just in configuration:
- `StoreSetting` (`apps/api/prisma/schema.prisma:659`) is a literal singleton — `id` defaults to the string `"singleton"`, one row, ever.
- `Product.brand` (`schema.prisma:180`) is a free-text `String?`, not a foreign key to any brand entity — two products with "Nike" typed slightly differently are unrelated as far as the database is concerned.
- `AdminUser.role` (`schema.prisma:71`) is a global `OWNER | STAFF` enum — permissions aren't scoped to any vendor or brand, because there's no entity to scope them to.
- `Order` (`schema.prisma:456`) has no vendor/brand reference at all — every order belongs to "the store," full stop.
- There is no `Vendor`, `Seller`, or `Brand` model anywhere in the schema.

This isn't a bug — it's a correct, simple design for a single store. The risk is specifically that bolting on multi-vendor later means retrofitting a tenant reference onto `Product`, `Order`, `Category`, and `AdminUser` simultaneously, plus rewriting every query that currently assumes "there is exactly one of everything."

### Recommended low-risk groundwork (not full implementation)
Mirror the pattern that already works for `StoreSetting`: introduce the entity now, seed exactly one default row, and scope the obvious tables to it with a required foreign key defaulting to that row. Behavior stays 100% single-vendor; the schema stops being a blocker.

- Add a `Brand` model (`id`, `name`, `slug`, `logoUrl`, timestamps) and seed one default row matching today's store branding.
- Add `brandId String` (required, FK to `Brand`, defaulting to the seeded row) to `Product`. This directly replaces the free-text `brand` field's role for anything that needs real grouping (filtering, per-brand pages), while `brand` can stay as a display-name convenience or be deprecated later.
- Defer `Vendor`/`Seller` (a distinct concept from `Brand` — a vendor is a party who fulfills orders and gets paid; a brand is just a label) until there's a concrete second-vendor use case. Adding it speculatively now means guessing at a payout/commission model with no real requirements to design against — that's exactly the kind of premature abstraction that creates its own rewrite risk. When it's real, the same "seed one default row, add a required FK" pattern applies to `Order` and `AdminUser`.

## 2. API-first / Mobile / Headless / AI readiness

### What's already true (this is a real strength, not a gap)
- The architecture is genuinely headless already: `apps/api` is a standalone Express/REST service; `apps/web` is just one consumer of it over plain HTTP, with zero server-side coupling between them. A second frontend (mobile app, partner site, admin CLI) could talk to the same API today with no backend changes.
- Request/response shapes are already formally typed and validated via `packages/shared`'s Zod schemas — this is most of what an API contract needs; it's just not exposed as a machine-readable spec yet (see gap below).
- AI integration isn't theoretical — it's built and working today: `apps/api/src/modules/ai/ai.service.ts` wraps the Anthropic SDK for product descriptions, SEO fields, marketing copy, and image alt-text generation, with a clean pattern worth keeping as the template for future AI features (client constructed lazily so a missing API key never breaks server startup, `isAiConfigured()` checked before any route depends on it, real error handling for refusals/empty responses). "AI Integration Ready" is largely already achieved.

### Real gaps
- **Auth is cookie-only, with no bearer-token path.** `require-admin.ts:15` and `require-customer.ts:16` both read exclusively from `req.cookies`; nothing checks an `Authorization` header. A web browser handles this transparently, but it's friction for a native mobile app (managing a cookie jar against a JSON API is unusual) and a hard blocker for any server-to-server or AI-agent client (no browser, no cookie jar at all).
- **No API versioning.** Every route is `/api/products`, `/api/orders`, etc. — there's no `/api/v1/` namespace or version header. That's fine while `apps/web` is the only consumer and both deploy together, but the moment a second, independently-released client exists (a mobile app you can't force-update instantly), an unversioned breaking change breaks it with no recourse.
- **CORS allows exactly one hardcoded origin.** `apps/api/src/config/env.ts:21` (`webOrigin`) feeds directly into `cors({ origin: env.webOrigin, credentials: true })` (`apps/api/src/app.ts:37`) — a single string, not a list. A second legitimate web-based headless frontend would be silently rejected by CORS with no config path to allow it.
- **No machine-readable API contract.** The Zod schemas in `packages/shared` are real validation, but nothing publishes them as OpenAPI/Swagger. A future mobile team (or an AI agent integrating against the store) has to read the Express route files to know what exists.

### Recommended low-risk groundwork
All four are additive — none require touching existing behavior for the current web client:
1. In `require-admin.ts`/`require-customer.ts`, check `Authorization: Bearer <token>` as a fallback when no cookie is present, before falling through to the existing 401. Web behavior is byte-for-byte unchanged; a bearer-token client (mobile, AI agent, server-to-server) becomes possible with zero schema changes.
2. Change `webOrigin` to `webOrigins: string[]` (comma-separated env var, parsed at startup) and pass an origin-checking function to `cors()` instead of a single string. Trivial change, unblocks every future headless consumer.
3. Adopt a versioning *policy* now even before it's enforced structurally — e.g. document that breaking changes to a shipped route require a new `/api/v2/` path rather than mutating `/v1` in place. Cheap to decide now, expensive to retrofit after a mobile app exists in the wild.
4. Generate an OpenAPI spec from the existing Zod schemas (`zod-to-openapi` or similar) as a build step — this is close to free given the validation already exists, and immediately gives any future client (mobile, third-party, AI) a real contract to code against instead of reading source.

## Deferred this round: Multi-currency, Multi-warehouse, Multi-language

Not evaluated in depth here since the user chose to focus this round elsewhere — flagging briefly so they aren't forgotten:
- **Multi-currency**: `Product.basePrice` and friends are untyped `Decimal`s with an implicit BDT assumption (`StoreSetting.currency` is a single string, not per-price). Real support needs a currency code stored alongside every price plus an FX-rate strategy — a materially bigger, riskier change than the two groundwork items above, since it touches every price calculation in `order.service.ts`/`product.service.ts`, not just schema.
- **Multi-warehouse**: `ProductVariant.stock` (`schema.prisma:286`) is a single integer — stock isn't tied to any location. Real support means moving stock tracking to a `WarehouseStock(variantId, warehouseId, quantity)` join table and reworking every stock read/write (`order.service.ts` stock decrement, `product.service.ts` stock display) to sum or select per-warehouse. Bigger blast radius than brand/vendor groundwork; worth its own dedicated round.
- **Multi-language**: no i18n library or translation-key structure exists in `apps/web` today; all copy is hardcoded English/Bengali-mixed strings inline in components. Needs a real decision (next-intl vs. a custom solution) before any schema work, so it's a design conversation first, not a quick groundwork add.

## Suggested sequencing
1. Ship the two API-first groundwork items that are pure config/middleware (bearer-token fallback, CORS allowlist) — smallest diff, zero risk, immediately useful.
2. Add the `Brand` model + seeded default row + `Product.brandId` — one migration, mirrors the existing `StoreSetting` singleton pattern the codebase already trusts.
3. OpenAPI generation as a follow-up once the above stabilizes — most valuable once there's an actual second consumer motivating it.
4. Revisit multi-currency/multi-warehouse/multi-language as their own dedicated planning rounds when there's a real near-term driver (an actual second currency market, an actual second warehouse) — designing them speculatively now risks guessing wrong and needing the rewrite anyway.
