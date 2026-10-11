# Phase 12 Sign-off: Store Identity & Provider Configuration

**Branch:** `phase-12/store-identity-provider-config` (from production `2ad99c7`; contract `818f1f6`).
**Contract:** [PHASE_12_IMPLEMENTATION_CONTRACT.md](PHASE_12_IMPLEMENTATION_CONTRACT.md). **Runbook:** [STORE_DEPLOYMENT.md](STORE_DEPLOYMENT.md).
**Status:** implemented and verified locally; **not deployed, not merged, not pushed** — awaiting review.

## 1. What changed

| WP | Result |
|---|---|
| W1 | `packages/shared/src/country/bd.ts` owns every Bangladesh rule (phone regex/normaliser, `880` form, Dhaka split + delivery days, divisions/districts/areas, `BD`/`Bangladesh`/gateway city constants). 5 duplicate `880` conversions removed. No behaviour change. |
| W2 | `apps/api/src/providers/`: `capabilities.ts`, `registry.ts`, `selection.ts`, `errors.ts`; implementations moved verbatim (`git mv`) to `sms/bulksmsbd`, `email/resend`, `push/web-push`, `courier/steadfast`, `payment/{sslcommerz,eps}`, `events/meta-capi`. |
| W3/W4 | One gateway selection point (`gatewayIdForPaymentMethod` + `payments.forNewSession` / `.adapter`); the duplicated ternaries in `payment.service` are gone. No application/domain module imports a concrete provider. |
| W5 | `PAYMENT_GATEWAYS`, `SMS_PROVIDER`, `EMAIL_PROVIDER`, `COURIER_PROVIDER`, `PUSH_PROVIDER`; unset = today's wiring; `none` = explicit NotConfigured (non-retryable 400); startup validation in production for explicit choices; messages name variables only. |
| W6 | Timeouts: SSLCommerz init/validate 20 s, EPS 20 s per attempt (3-attempt loop unchanged), Web Push 10 s. Timeouts classify as `provider_timeout`. |
| W7 | Credential query parameters (`api_key`, `store_passwd`, `token`, …) masked in logs, captured errors, BulkSMSBD transport errors and the outbox's persisted `lastError`. |
| W8 | Migration `20261007100000_phase12_store_identity`: 8 nullable identity columns on `StoreSetting`; `CatalogSetting.skuPrefix` default `"SKU"` for new rows only. |
| W9 | Footer/contact/terms/JSON-LD read identity from `StoreSetting`; "We Accept" only from the store's own `PaymentMethodOption`/image; neutral icons and placeholders; OTP SMS names the store; admin "Business identity" form; `GET /api/v1/ops/providers` + read-only Integrations panel. |
| W10 | Compose project/DB name and provider vars parameterised (defaults unchanged); nginx config is a template (`SERVER_NAME`, `SERVER_ALIASES`, `CERT_NAME`); `deploy.sh` preflight; backups use `POSTGRES_DB` and a required `GDRIVE_REMOTE`; CI writes the new inputs from repository variables. |

## 2. Verification (local, isolated databases only; `LIVE_PROVIDERS=off`, provider credentials blank)

| Gate | Result |
|---|---|
| TypeScript (api, web) | clean |
| ESLint (api, web) | 0 errors (2 pre-existing `<img>` warnings in web) |
| API build | clean |
| Web build | compiled, lint + types, 12/12 static pages; known Windows standalone `EPERM` at trace copy (accepted) |
| API suite | **918 / 918** passed, 76 files (incl. all Phase 4–11 guards and mutation suites) |
| Playwright (desktop + mobile, `next start`) | **194 passed, 2 skipped, 0 failed** (same baseline as Phase 10/11) |
| Second-store proof | API: `second-store.integration.test.ts` (5); browser: `e2e/second-store.spec.ts` (2 on desktop) |
| Mutation run (new decision logic) | **22 / 22 mutants killed** (selection, registry, none-implementations, gateway mapping, redaction, timeouts, OTP identity, concrete-import guard) |
| Fresh DB | 85 migrations applied, `migrate status` up to date, `migrate diff` no drift, seed OK |
| Production-shaped DB upgrade | Phase 12 migration applied; existing `StoreSetting`/`CatalogSetting` rows byte-identical in pre-existing columns; stored `AZ` prefix kept |

## 3. Deploy prerequisites for the existing store (owner)

1. Add to the server's `docker/.env` before deploying: `SERVER_NAME`, `SERVER_ALIASES`, `CERT_NAME`, `GDRIVE_REMOTE`
   (current values; `deploy.sh` refuses to start without them). For CI: matching repository variables.
2. After deploying, in Admin → Settings: legal name, address, governing law, support hours; confirm a favicon is
   uploaded (the built-in fallback icon is now neutral); add PaymentMethodOption entries or the payment-methods image
   if the footer should keep its "We Accept" row.
3. Phase 11 authenticated live verification must PASS before this phase is deployed (contract acceptance 11).

## 4. Known limitations / not done

- Admin hides no actions for unconfigured providers yet; it shows the Integrations status, and an unconfigured
  capability answers with a clear 400 (contract D-4 asked for hiding — **DECISION REQUIRED** whether that UI work is
  still wanted).
- Legacy one-off tooling (`migrate-to-new-vps.sh`, `zero-downtime-migrate.sh`, `migrate-vps.yml`, `deploy_vps.py`,
  `inspect_vps.py`) was **not** retired: the replacement for its deploy mode is `deploy.sh`, but its migration modes
  have no replacement and are the documented path for the production server today (D-14 — owner decision).
- Same-VPS multi-store, upload-URL relativization, worker split, Redis rate limiting, object storage, multi-country:
  deferred as in the contract.
- `main` is still behind production (51 commits, fast-forward possible — D-15, owner action).
