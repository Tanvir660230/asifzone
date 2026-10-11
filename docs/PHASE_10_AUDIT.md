# Phase 10 Audit: Roles, Permissions & Authorization Hardening

**Status:** audit and design, 2026-10-01, branch `phase-10/authorization-hardening` (from Phase 9 `d12574f`).

**Question the system must answer:** who may perform this action, on which resource, under which conditions?

**Method:**
- Walked the **running Express router stack** rather than grepping. Every one of the 393 routes was printed with its
  real middleware chain, so router-level `.use()` ordering is accounted for.
- Traced the auth middleware, token issue and refresh, admin management, every customer-owned read, every response
  that reaches a customer, the web role checks, the webhook boundaries and the service-to-service calls.
- Checked against the approved target in TARGET_ARCHITECTURE §15 and the earlier finding R16
  (MASTER_ARCHITECTURE_AUDIT §12).

---

## A. Identity inventory

| Identity | Storage | Authentication | Role | Can access | Restrictions |
|---|---|---|---|---|---|
| **Customer** | `Customer` | Customer JWT access cookie (own secret, 15 min) + refresh JWT pinned to `tokenVersion` (password reset revokes); Google; phone OTP | none (ownership) | own profile, addresses, orders, returns, points, wishlist, cart, reviews, stock alerts, push subscriptions | every `/me` read is scoped to `req.customer.customerId`; another customer's order → 404 |
| **Guest** | none (order carries phone) | none | — | checkout; order tracking by **order number + phone**; payment retry by order number + phone | rate limited |
| **STAFF** | `AdminUser.role = STAFF` | Admin JWT access cookie (15 min, `{adminId, role}`) + DB-tracked rotating refresh tokens; Google links only to an invited email | `STAFF` | every admin route **except** the OWNER-only set (§F) | — |
| **OWNER** | `AdminUser.role = OWNER` | same as STAFF | `OWNER` | everything | can't deactivate or demote **themselves** |
| **Provider (webhook)** | — | SSLCommerz / EPS: server-to-server re-verification. Steadfast: shared token (constant-time) + status re-fetch | — | payment and courier callbacks | not user RBAC (§G-8) |
| **Internal (API → web)** | — | `X-Revalidate-Secret` shared secret | — | `POST /api/revalidate` (Next cache tags) | refuses when the secret is unset |
| **Workers (outbox, crons)** | — | in-process, no HTTP | system | domain services directly | system events, not operator actions (§H) |

No other identity exists: no vendor, API key or service-account model.

## B. API authorization inventory

- **393 routes in total.** 299 are admin-guarded, 23 customer-guarded and 71 public.
- **Public routes:** storefront reads, auth bootstrap, checkout and quote, guest tracking, analytics beacons, provider
  callbacks, and the public settings read. Each one was checked: none returns another party's data, and none mutates
  anything beyond its own request.
- **Customer routes:** every one resolves the resource through `req.customer.customerId`. Address edits go through
  `getOwnedAddress`; `getOrderForCustomer` compares `customerId`; return creation compares the order's customer.
- **Admin routes:** the table below groups families. "Permission (Phase 10)" is the proposed vocabulary (§Design). Its
  role mapping was checked by script against every one of the 299 routes: **0 differences** from today's OWNER/STAFF
  access.

| Endpoint | Method | Current guard | Role today | Resource check | Sensitive data | Permission (Phase 10) | Risk |
|---|---|---|---|---|---|---|---|
| `/api/auth/logout-all` | POST | requireAdmin | OWNER, STAFF | — | own session / notifications | `(self)` | M |
| `/api/auth/sessions` | GET | requireAdmin | OWNER, STAFF | — | own session / notifications | `(self)` | L |
| `/api/auth/me` | GET | requireAdmin | OWNER, STAFF | — | own session / notifications | `(self)` | L |
| `/api/auth/admins` | GET | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/auth/admins/:id/active` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/auth/admins/:id` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/auth/admins/:id/password` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/auth/admin-invites` | GET | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/auth/admin-invites` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/auth/admin-invites/:id` | DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | admin accounts, roles, credentials | `users.manage` | H |
| `/api/categories/` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/categories/stock-map` | GET | requireAdmin | OWNER, STAFF | — | stock ledger | `inventory.read` | L |
| `/api/categories/:id` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/categories/upload-image` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/upload-banner` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/reorder` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/:id` | PATCH | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/:id/move` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/:id` | DELETE | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/:id/restore` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/categories/:id/permanent` | DELETE | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/attributes/` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/attributes/:id` | PATCH | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/attributes/:id` | DELETE | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/catalog/types` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/types/manage` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/{types,templates,attributes,spec-groups,size-guides,care-guides,materials,sections,sku-settings}/…` (27 routes) | POST/PUT/PATCH/DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | store-wide catalog config | `catalog.configure` | M |
| `/api/catalog/templates` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/templates/:id` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/attributes` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/spec-groups` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/size-guides` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/care-guides` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/materials` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/sku-settings` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/catalog/sku/generate` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/catalog/sections` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/export/csv` | GET | requireAdmin | OWNER, STAFF | — | full catalog incl. cost | `catalog.export` | H |
| `/api/products/export/full` | GET | requireAdmin | OWNER, STAFF | — | full catalog incl. cost | `catalog.export` | H |
| `/api/products/import/template` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/import/validate` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | bulk catalog writes | `products.import` | M |
| `/api/products/import/commit` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | bulk catalog writes | `products.import` | M |
| `/api/products/` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/:id` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/:id/history` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/:id/sales-summary` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/:id/preview` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/products/bulk/delete` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/bulk/status` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/bulk/category` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id` | PATCH | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id` | DELETE | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id/restore` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id/duplicate` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id/permanent` | DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | irreversible delete | `catalog.purge` | H |
| `/api/products/:id/images` | POST | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id/images/reorder` | PATCH | requireAdmin | OWNER, STAFF | — | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id/images/:imageId` | DELETE | requireAdmin | OWNER, STAFF | parent ↔ child id | catalog, current cost price | `catalog.manage` | M |
| `/api/products/:id/images/:imageId` | PATCH | requireAdmin | OWNER, STAFF | parent ↔ child id | catalog, current cost price | `catalog.manage` | M |
| `/api/orders/` | GET | requireAdmin | OWNER, STAFF | — | customer PII, payments, refunds | `orders.read` | L |
| `/api/orders/admin` | POST | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/stats` | GET | requireAdmin | OWNER, STAFF | — | customer PII, payments, refunds | `orders.read` | L |
| `/api/orders/export/csv` | GET | requireAdmin | OWNER, STAFF | — | bulk customer PII | `orders.export` | H |
| `/api/orders/bulk/status` | POST | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/bulk/delete` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | irreversible delete | `orders.delete` | H |
| `/api/orders/bulk/permanent` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | irreversible delete | `orders.delete` | H |
| `/api/orders/bulk/courier/book` | POST | requireAdmin | OWNER, STAFF | — | shipments, courier charges | `courier.manage` | M |
| `/api/orders/bulk/courier/sync` | POST | requireAdmin | OWNER, STAFF | — | shipments, courier charges | `courier.manage` | M |
| `/api/orders/bulk/delivery-score` | POST | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/bulk/get` | POST | requireAdmin | OWNER, STAFF | — | customer PII, payments, refunds | `orders.read` | M |
| `/api/orders/:id` | GET | requireAdmin | OWNER, STAFF | — | customer PII, payments, refunds | `orders.read` | L |
| `/api/orders/:id/status` | PATCH | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/:id/details` | PATCH | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/:id/hold` | POST | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/:id/hold/clear` | POST | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/:id/price` | PATCH | requireAdmin | OWNER, STAFF | — | order money | `orders.adjust_price` | H |
| `/api/orders/:id/reconcile-partial-delivery` | PATCH | requireAdmin | OWNER, STAFF | — | order state, PII | `orders.manage` | M |
| `/api/orders/:id/refunds` | POST | requireAdmin | OWNER, STAFF | — | money out | `refunds.manage` | H |
| `/api/orders/:id/refunds` | GET | requireAdmin | OWNER, STAFF | — | customer PII, payments, refunds | `orders.read` | L |
| `/api/orders/:id/refunds/:refundId/complete` | POST | requireAdmin | OWNER, STAFF | order ↔ refund id | money out | `refunds.manage` | H |
| `/api/orders/:id/payment` | GET | requireAdmin | OWNER, STAFF | — | customer PII, payments, refunds | `orders.read` | L |
| `/api/orders/:id/payments` | POST | requireAdmin | OWNER, STAFF | — | money in (ledger) | `payments.record` | H |
| `/api/orders/:id/courier/book` | POST | requireAdmin | OWNER, STAFF | — | shipments, courier charges | `courier.manage` | M |
| `/api/orders/:id/courier/refresh` | POST | requireAdmin | OWNER, STAFF | — | shipments, courier charges | `courier.manage` | M |
| `/api/orders/:id/courier/unlink` | POST | requireAdmin | OWNER, STAFF | — | shipments, courier charges | `courier.manage` | M |
| `/api/orders/:id` | DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | irreversible delete | `orders.delete` | H |
| `/api/orders/:id/restore` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | irreversible delete | `orders.delete` | H |
| `/api/orders/:id/permanent` | DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | irreversible delete | `orders.delete` | H |
| `/api/coupons/` | GET | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | L |
| `/api/coupons/:id` | GET | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | L |
| `/api/coupons/` | POST | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/coupons/:id` | PATCH | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/coupons/:id` | DELETE | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/coupons/:id/restore` | POST | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/coupons/:id/permanent` | DELETE | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/bundles/` | GET | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | L |
| `/api/bundles/:id` | GET | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | L |
| `/api/bundles/` | POST | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/bundles/:id` | PATCH | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/bundles/:id` | DELETE | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/return-requests/` | GET | requireAdmin | OWNER, STAFF | — | exchanges, refunds due | `returns.manage` | L |
| `/api/return-requests/:id` | PATCH | requireAdmin | OWNER, STAFF | — | exchanges, refunds due | `returns.manage` | M |
| `/api/reviews/admin` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/reviews/admin/:id` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/reviews/admin/:id` | DELETE | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/redirects/` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/redirects/:id` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/redirects/` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | redirects, social links | `storefront.configure` | M |
| `/api/redirects/:id` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | redirects, social links | `storefront.configure` | M |
| `/api/redirects/:id` | DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | redirects, social links | `storefront.configure` | M |
| `/api/payment-admin/overview` | GET | requireAdmin | OWNER, STAFF | — | ledger, payer data | `payments.read` | L |
| `/api/payment-admin/search` | GET | requireAdmin | OWNER, STAFF | — | ledger, payer data | `payments.read` | L |
| `/api/payment-admin/ledger/drift` | GET | requireAdmin | OWNER, STAFF | — | ledger, payer data | `payments.read` | L |
| `/api/payment-admin/ledger/repair` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | repairs / redelivery | `ops.repair` | H |
| `/api/payment-methods/` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/payment-methods/upload-logo` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/payment-methods/` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/payment-methods/reorder` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/payment-methods/:id` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/payment-methods/:id` | DELETE | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/flash-sales/` | GET | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | L |
| `/api/flash-sales/:id` | GET | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | L |
| `/api/flash-sales/` | POST | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/flash-sales/:id` | PATCH | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/flash-sales/:id` | DELETE | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/flash-sales/:id/items` | POST | requireAdmin | OWNER, STAFF | — | price/discount rules | `promotions.manage` | M |
| `/api/flash-sales/:id/items/:itemId` | DELETE | requireAdmin | OWNER, STAFF | parent ↔ child id | price/discount rules | `promotions.manage` | M |
| `/api/banners/` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/banners/upload-image` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/banners/` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/banners/reorder` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/banners/:id` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/banners/:id` | DELETE | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/homepage-sections/` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/homepage-sections/upload-image` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/homepage-sections/` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/homepage-sections/reorder` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/homepage-sections/:id` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/homepage-sections/:id` | DELETE | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/social-links/` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/social-links/` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | redirects, social links | `storefront.configure` | M |
| `/api/social-links/:id` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | redirects, social links | `storefront.configure` | M |
| `/api/social-links/:id` | DELETE | requireAdmin + requireRole(OWNER) | OWNER | — | redirects, social links | `storefront.configure` | M |
| `/api/feedback/` | GET | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | L |
| `/api/feedback/:id/read` | PATCH | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/feedback/:id` | DELETE | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/customers/admin` | GET | requireAdmin | OWNER, STAFF | — | customer PII, CRM flags | `customers.read` | L |
| `/api/customers/admin` | POST | requireAdmin | OWNER, STAFF | — | CRM flags, admin notes | `customers.manage` | M |
| `/api/customers/admin/stats` | GET | requireAdmin | OWNER, STAFF | — | customer PII, CRM flags | `customers.read` | L |
| `/api/customers/admin/bulk/sms` | POST | requireAdmin | OWNER, STAFF | — | outbound SMS (cost, spam risk) | `customers.message` | H |
| `/api/customers/admin/:id` | GET | requireAdmin | OWNER, STAFF | — | customer PII, CRM flags | `customers.read` | L |
| `/api/customers/admin/:id/points` | POST | requireAdmin | OWNER, STAFF | — | points balance (value) | `loyalty.adjust` | H |
| `/api/customers/admin/:id` | PATCH | requireAdmin | OWNER, STAFF | — | CRM flags, admin notes | `customers.manage` | M |
| `/api/customers/admin/:id/sms` | POST | requireAdmin | OWNER, STAFF | — | outbound SMS (cost, spam risk) | `customers.message` | H |
| `/api/analytics/* (dashboards)` (73 routes) | GET | requireAdmin | OWNER, STAFF | — | financials, cost, margin, PII aggregates | `analytics.read` | L |
| `/api/analytics/export/*.csv` (3 routes) | GET | requireAdmin | OWNER, STAFF | — | bulk financial/customer data | `analytics.export` | H |
| `/api/bi/overview` | GET | requireAdmin | OWNER, STAFF | — | financials, cost, margin, PII aggregates | `analytics.read` | L |
| `/api/bi/automated-insights` | GET | requireAdmin | OWNER, STAFF | — | financials, cost, margin, PII aggregates | `analytics.read` | L |
| `/api/inventory/movements` | GET | requireAdmin | OWNER, STAFF | — | stock ledger | `inventory.read` | L |
| `/api/inventory/variants/:variantId/adjust` | POST | requireAdmin | OWNER, STAFF | — | stock truth | `inventory.adjust` | H |
| `/api/inventory/reconciliation` | GET | requireAdmin | OWNER, STAFF | — | stock ledger | `inventory.read` | L |
| `/api/uploads/editor-image` | POST | requireAdmin | OWNER, STAFF | — | storefront content | `content.manage` | M |
| `/api/audit-logs/` | GET | requireAdmin + requireRole(OWNER) | OWNER | — | admin activity, IPs | `audit.read` | L |
| `/api/notifications/` | GET | requireAdmin | OWNER, STAFF | — | own session / notifications | `(self)` | L |
| `/api/notifications/:id/read` | POST | requireAdmin | OWNER, STAFF | — | own session / notifications | `(self)` | M |
| `/api/notifications/read-all` | POST | requireAdmin | OWNER, STAFF | — | own session / notifications | `(self)` | M |
| `/api/settings/pricing-config-drift` | GET | requireAdmin | OWNER, STAFF | — | operational state | `ops.read` | L |
| `/api/settings/` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | store config, SMS provider settings | `settings.manage` | H |
| `/api/settings/upload-logo` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | store config, SMS provider settings | `settings.manage` | H |
| `/api/settings/upload-favicon` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | store config, SMS provider settings | `settings.manage` | H |
| `/api/settings/upload-payment-methods-image` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | store config, SMS provider settings | `settings.manage` | H |
| `/api/sms-settings/` | GET | requireAdmin + requireRole(OWNER) | OWNER | — | store config, SMS provider settings | `settings.manage` | H |
| `/api/sms-settings/` | PATCH | requireAdmin + requireRole(OWNER) | OWNER | — | store config, SMS provider settings | `settings.manage` | H |
| `/api/sms-templates/` | GET | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/sms-templates/` | POST | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/sms-templates/:id` | PATCH | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/sms-templates/:id` | DELETE | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/ai/status` | GET | requireAdmin | OWNER, STAFF | — | drafts, current cost (admin product read) | `catalog.read` | L |
| `/api/ai/generate` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | billed provider usage | `ai.use` | M |
| `/api/ai/image-alt-text` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | billed provider usage | `ai.use` | M |
| `/api/campaigns/` | GET | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/:id` | GET | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/` | POST | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/:id` | PATCH | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/:id` | DELETE | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/:id/schedule` | POST | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/:id/cancel-schedule` | POST | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/campaigns/:id/send` | POST | requireAdmin | OWNER, STAFF | — | bulk messaging | `campaigns.manage` | H |
| `/api/courier/steadfast/balance` | GET | requireAdmin | OWNER, STAFF | — | shipments, courier charges | `courier.manage` | L |
| `/api/v1/storefront/read-model/drift` | GET | requireAdmin | OWNER, STAFF | — | operational state | `ops.read` | L |
| `/api/v1/storefront/read-model/rebuild` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | repairs / redelivery | `ops.repair` | H |
| `/api/v1/metrics/` | GET | requireAdmin | OWNER, STAFF | — | financials, cost, margin, PII aggregates | `analytics.read` | L |
| `/api/v1/metrics/definitions` | GET | requireAdmin | OWNER, STAFF | — | financials, cost, margin, PII aggregates | `analytics.read` | L |
| `/api/v1/metrics/consistency` | GET | requireAdmin | OWNER, STAFF | — | operational state | `ops.read` | L |
| `/api/v1/outbox/status` | GET | requireAdmin | OWNER, STAFF | — | operational state | `ops.read` | L |
| `/api/v1/outbox/:id/retry` | POST | requireAdmin + requireRole(OWNER) | OWNER | — | repairs / redelivery | `ops.repair` | H |
| `/api/v1/ops/reliability` | GET | requireAdmin | OWNER, STAFF | — | operational state | `ops.read` | L |

| Permission | Routes | OWNER | STAFF |
|---|---|---|---|
| `(self)` | 6 | ✅ | ✅ |
| `ai.use` | 2 | ✅ | — |
| `analytics.export` | 3 | ✅ | ✅ |
| `analytics.read` | 77 | ✅ | ✅ |
| `audit.read` | 1 | ✅ | — |
| `campaigns.manage` | 12 | ✅ | ✅ |
| `catalog.configure` | 27 | ✅ | — |
| `catalog.export` | 2 | ✅ | ✅ |
| `catalog.manage` | 25 | ✅ | ✅ |
| `catalog.purge` | 1 | ✅ | — |
| `catalog.read` | 20 | ✅ | ✅ |
| `content.manage` | 28 | ✅ | ✅ |
| `courier.manage` | 6 | ✅ | ✅ |
| `customers.manage` | 2 | ✅ | ✅ |
| `customers.message` | 2 | ✅ | ✅ |
| `customers.read` | 3 | ✅ | ✅ |
| `inventory.adjust` | 1 | ✅ | ✅ |
| `inventory.read` | 3 | ✅ | ✅ |
| `loyalty.adjust` | 1 | ✅ | ✅ |
| `ops.read` | 5 | ✅ | ✅ |
| `ops.repair` | 3 | ✅ | — |
| `orders.adjust_price` | 1 | ✅ | ✅ |
| `orders.delete` | 5 | ✅ | — |
| `orders.export` | 1 | ✅ | ✅ |
| `orders.manage` | 8 | ✅ | ✅ |
| `orders.read` | 6 | ✅ | ✅ |
| `payments.read` | 3 | ✅ | ✅ |
| `payments.record` | 1 | ✅ | ✅ |
| `products.import` | 2 | ✅ | — |
| `promotions.manage` | 19 | ✅ | ✅ |
| `refunds.manage` | 2 | ✅ | ✅ |
| `returns.manage` | 2 | ✅ | ✅ |
| `settings.manage` | 6 | ✅ | — |
| `storefront.configure` | 6 | ✅ | — |
| `users.manage` | 7 | ✅ | — |

**Nested resources:** the refund must belong to the order, the flash-sale item to the sale, and the image to the
product. Each is checked in its service (`completeRefund`, `removeFlashSaleItem`, `deleteProductImage` /
`updateProductImage`, `syncVariantGallery`). ✅

## C. Frontend authorization audit

Every web decision derives from `GET /api/auth/me` (`role`). The Next middleware only checks that a cookie is present:
"the API independently verifies the JWT".

| Where | Decision | Backend enforcement | Class |
|---|---|---|---|
| `sidebar.tsx`, `settings-subnav.tsx` | hide Team, Audit Log, SMS Notifications | `requireRole(OWNER)` | UX-only |
| `orders/page.tsx`, `order-detail-panel.tsx` | bulk/permanent delete, trash | `requireRole(OWNER)` | UX-only |
| `products/page.tsx`, `products/import/page.tsx` | permanent delete, import | `requireRole(OWNER)` | UX-only |
| `settings/page.tsx`, `sms-notifications/page.tsx` | read-only for STAFF | `requireRole(OWNER)` | UX-only |
| `ai-assistant/page.tsx`, `image-uploader.tsx`, `product-form-state.ts` | AI entry points | `requireRole(OWNER)` | UX-only |
| `audit-log/page.tsx`, `team/page.tsx` | page gate | `requireRole(OWNER)` | UX-only |

**No security-critical frontend check exists.** Every hidden action is refused by the API. The weakness is
duplication: 15 files re-state the role rule as `role === "OWNER"`, so the two can drift. Fixed by returning
permissions from `/me` (§Design).

## D. Customer / admin boundary

| Data | Another customer's | The customer's own — returned today |
|---|---|---|
| orders, lines, addresses, phone, email, returns, points | ✅ refused (scoped / 404) | — |
| historical cost (`unitCostSnapshot`) | ✅ | ✅ never: global Prisma omit (Phase 6, I31) |
| **`Order.adminNotes`**, labelled in the admin UI *"Internal notes — not visible to the customer"* | ✅ | ❌ **returned** by `GET /me/orders`, `GET /me/orders/:id`, `POST /orders/track` (guest) and the checkout response |
| **staff identity**: `statusHistory[].changedByAdmin.name`, `changedByAdminId`, `deletedByAdminId`, `ReturnRequest.reviewedByAdminId` | ✅ | ❌ returned |
| **operational fields**: `callAttempts`, `followUpAt`, `courierSyncError`, `courierBookingStartedAt`, `partialDeliveryReconciledAt`, `idempotencyKey`, `paymentSessionKey`, `sessionId`, `couponReleasedAt`, `deletedAt` | ✅ | ❌ returned |
| **internal attribution**: `OrderItem.productIdSnapshot`, `categoryIdSnapshot`, `categoryNameSnapshot`, `brandSnapshot`, `listPriceSnapshot`, `flashSaleItemId` | ✅ | ❌ returned |
| **same-status timeline annotations**: follow-up holds ("On hold — follow up …: *asked to call after 6pm*"), address/price edit diffs, "Payment/Refund recorded …", admin annotations | ✅ | ❌ rendered on the customer's order page. The storefront shows every `statusHistory` note |
| return request `adminNote` | ✅ | shown as "Note from support" on a rejection, **by design** |
| customer profile | ✅ | `publicSelect`: `adminNotes`, `isBlocked`, `codRisk` and delivery score are excluded ✅ |

## E. Sensitive operations

| Operation | Today | Resource check | Audit log | Confirmation |
|---|---|---|---|---|
| Refund record / complete | STAFF+OWNER | refund ↔ order, `refundable` cap under lock (Phase 4) | generic (actor, path, entity) | UI dialog + idempotency key (Phase 9) |
| Manual payment | STAFF+OWNER | order lock | generic | key |
| Order price adjustment | STAFF+OWNER | not after booking/payment (Phase 4) | generic + timeline | reason field |
| Status override / bulk | STAFF+OWNER | state machine | generic + timeline | — |
| Order delete / restore / permanent | OWNER | — | generic | UI dialog |
| Stock adjustment | STAFF+OWNER | reason required, `StockMovement` | generic + ledger | — |
| Product cost / price edit | STAFF+OWNER | product history | per-field product audit | — |
| Coupon / flash sale / bundle | STAFF+OWNER (incl. **coupon permanent delete**) | — | generic | — |
| Category permanent delete | **STAFF+OWNER** | — | generic | — |
| Settings / currency | OWNER | currency lock (Phase 6) | generic | — |
| User / role change | OWNER | self-deactivation and self-demotion refused | generic `auth.update` (no before/after role) | — |
| Loyalty adjustment | STAFF+OWNER | row lock (Phase 9) | generic + points ledger with reason | — |
| Courier booking | STAFF+OWNER | claim (Phase 9) | generic | — |
| Outbox retry / ledger repair / read-model rebuild | OWNER | — | generic | — |
| Exports (orders, products, analytics CSV) | STAFF+OWNER | — | **none: GET is not audited** | — |

**Audit trail:** `auditMiddleware` records every successful admin write (actor, action, entity, IP, method and path).
`AuditLog` is OWNER-readable. It is adequate for traceability. The gaps: role and active changes carry no
before/after, and exports (bulk PII reads) leave no trace.

## F. Current role model (exactly as enforced today)

| Capability | OWNER | STAFF | CUSTOMER | Enforcement |
|---|:-:|:-:|:-:|---|
| Manage admins, invites, roles, admin passwords | ✅ | — | — | `requireRole(OWNER)` |
| Read audit log | ✅ | — | — | `requireRole(OWNER)` |
| Store settings, SMS provider settings, logo/favicon | ✅ | — | — | `requireRole(OWNER)` |
| Catalog configuration (types, templates, guides, SKU pattern, sections) | ✅ | read | — | `requireRole(OWNER)` on writes |
| Product import; product permanent delete | ✅ | — | — | `requireRole(OWNER)` |
| Order delete / restore / permanent (single, bulk) | ✅ | — | — | `requireRole(OWNER)` |
| Redirects, social links (writes) | ✅ | read | — | `requireRole(OWNER)` |
| Outbox retry, payment ledger repair, read-model rebuild | ✅ | — | — | `requireRole(OWNER)` |
| AI generation | ✅ | — | — | `requireRole(OWNER)` |
| Orders: read, create manual, status, details, hold, reconcile, export | ✅ | ✅ | own only | `requireAdmin` / ownership |
| Price adjustment, refunds, manual payments | ✅ | ✅ | — | `requireAdmin` |
| Courier booking / sync / unlink / balance | ✅ | ✅ | — | `requireAdmin` |
| Returns and exchanges review | ✅ | ✅ | create own | `requireAdmin` / ownership |
| Catalog CRUD, categories (incl. **permanent delete**), attributes, images | ✅ | ✅ | — | `requireAdmin` |
| Coupons (incl. **permanent delete**), bundles, flash sales | ✅ | ✅ | — | `requireAdmin` |
| Content: banners, sections, reviews, feedback, payment methods | ✅ | ✅ | own reviews | `requireAdmin` |
| Customers: read, CRM flags, ad-hoc and bulk SMS, points adjustment | ✅ | ✅ | own profile | `requireAdmin` |
| Campaigns and SMS templates | ✅ | ✅ | — | `requireAdmin` |
| Analytics, BI, metrics (incl. COGS/margin), CSV exports | ✅ | ✅ | — | `requireAdmin` |
| Inventory read / adjust | ✅ | ✅ | — | `requireAdmin` |
| Ops read (outbox status, reliability, drift reports) | ✅ | ✅ | — | `requireAdmin` |

## G. Authorization gaps

| # | Gap | Evidence | Severity |
|---|---|---|---|
| G-1 | **Stale privilege (R16).** `requireAdmin` trusts the JWT's `{adminId, role}` for its 15-min life with no DB check. A **deactivated** admin keeps full access, and a **demoted** OWNER keeps OWNER powers (e.g. user management) until the token expires. Refresh re-reads role and `isActive`; requests don't | `require-admin.ts`; `setAdminActive` revokes refresh tokens only | **High** |
| G-2 | **Token confusion depends on configuration.** Admin and customer tokens differ only by secret. If the secrets were ever configured equal, a customer token would pass `requireAdmin`: it checks neither `adminId` nor role, so every STAFF-level route would open. Nothing enforces distinct secrets | `jwt.ts`, `env.ts` | **High** (latent) |
| G-3 | **Customer responses carry staff-only data** (§D): `adminNotes` (promised internal), staff identities, operational and idempotency fields, internal attribution, same-status staff annotations on the timeline. This covers the customer's own order and **guest tracking** with order number + phone | `getOrderForCustomer`, `trackOrder`, `listCustomerOrders`, `createOrder` return raw rows | **High** |
| G-4 | **No canonical permission model.** Two role strings are checked at 60 route sites and in 15 web files. There is no permission vocabulary, and nothing guarantees a new admin route gets a deliberate authorization decision (it defaults to STAFF) | route files, web | Medium |
| G-5 | **No last-OWNER protection.** Two owners can demote or deactivate each other concurrently, leaving no OWNER, since the checks only prevent self-changes | `updateAdmin`, `setAdminActive` | Medium |
| G-6 | **Inconsistent destructive powers.** Permanent delete of **orders and products** is OWNER-only; permanent delete of **coupons and categories** is open to STAFF | route inventory | Policy (PD-10.1) |
| G-7 | **Role changes untraceable in detail.** `auth.update` is logged without the before/after role; exports aren't audited | `auditMiddleware` | Low |
| G-8 | Webhooks are **correctly outside** user RBAC: re-verified server to server or token-checked, idempotent (Phases 4, 9). Not a gap | — | ✅ |
| G-9 | Internal endpoints: ops, outbox, drift and repair are admin-only; repairs and retries are OWNER. None is customer-reachable ✅. `/api/revalidate` compares its secret without constant time | web route | Low |
| G-10 | 401 / 403: no or invalid identity → 401; authenticated without the role → 403 (generic "Forbidden"). A customer calling an admin API gets 401 (no admin identity). Consistent ✅ | middleware | ✅ |
| — | Not found: no route without auth that should have it; no service-level role checks scattered in business logic (role logic lives only in middleware); no direct DB mutation path that bypasses a route guard for operator actions | route walk, grep | ✅ |

---

# Phase 10 Decision Gate

### MUST FIX
1. **G-1 / G-2: authenticate against the database on every admin request.** Verify the JWT (with an explicit
   `typ: "admin"` claim), then load `AdminUser` by id. Missing or inactive → 401. The **current DB role** decides,
   not the token's. Deactivation and demotion take effect on the next request, and a customer token can't become an
   admin identity whatever the secrets are.
2. **G-3: one customer-facing order view.** A single serializer (`toCustomerOrder`) whitelists what a customer or
   guest may see. It is used by the checkout response, tracking, and the customer's order list and detail. Returns
   drop `reviewedByAdminId`. Same-status staff annotations are omitted from the customer timeline (interpretation
   P10-1).

### SHOULD FIX
3. **G-4: canonical permission model** (TARGET §15). One vocabulary and one role→permission map in
   `packages/shared/src/auth/permissions.ts`, preserving today's access exactly (0 differences, verified).
   `requirePermission()` replaces `requireRole()` on every admin route, with self-service routes named explicitly.
   `/auth/me` returns the admin's permissions, and the web asks `can(permission)` instead of comparing role strings.
4. **G-5: last-OWNER protection.** Demoting or deactivating an OWNER is refused (409) if it would leave no active
   OWNER. The check runs under a lock, so two concurrent changes can't both pass.
5. **G-7: audit role and active changes** with before/after values; audit exports as reads of bulk data.

### POLICY (owner decision; today's behaviour preserved until decided)
- **PD-10.1:** should permanent delete of coupons and categories be OWNER-only, like orders and products?
- **PD-10.2:** should STAFF keep refunds, manual payments, price adjustment, loyalty adjustment, bulk/ad-hoc SMS,
  exports and financial analytics (COGS/margin)? All STAFF-allowed today. Phase 6 recorded that no decision restricts
  STAFF from financial figures. With the permission model, any restriction is a one-line change to the role map.

### DEFER
- Custom roles or per-admin permission grants (needs a table and UI); per-staff data scoping. No second role
  exists yet, and no store needs it.
- Redis-backed rate limits (TARGET §15); encrypting provider credentials at rest (Phase 11+, ProviderConfig).
- Per-request customer token revocation (the customer access token lives 15 min; refresh already checks
  `tokenVersion`).
- Constant-time compare on `/api/revalidate`; public `courierReturnFee*` settings fields (store data, no PII).
- Installer/config packs, country packs, ProviderConfig, per-order currency, daily facts, event sourcing, Kafka,
  multi-region, UI redesign.

## Design (Phase 10)

```text
cookie → authenticateAdmin (JWT typ=admin → AdminUser by id: active? current role)   → 401 if not
       → requirePermission(p) (ROLE_PERMISSIONS[role] ∋ p)                            → 403 if not
       → validate → controller → domain service (resource / ownership checks, e.g. refund ↔ order)
customer cookie → requireCustomer → service resolves by req.customer.customerId       → 404 for another's resource
provider → webhook verification (signature / token / server-to-server re-fetch)       → never user RBAC
worker / cron → trusted in-process boundary (system events, not operator actions)
```

- **Permissions** live in `packages/shared`, so web and API read one definition. The web receives the admin's
  resolved list from `/me` and never re-derives it from the role.
- **Guards:** every admin route carries `requirePermission` or is an explicit self-service route. There is no
  `requireRole` and no role-string comparison outside the auth module. Customer order responses go through the
  serializer. Web role-string checks are banned.
- **No schema change:** permissions are code-level, mapped from the existing `AdminRole` enum. No migration is needed.
