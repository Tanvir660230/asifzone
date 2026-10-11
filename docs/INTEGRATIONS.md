# Integrations from the dashboard

Every store (Asif Zone, Nasihamart, any new installation) manages its own third-party keys in **Admin › Settings ›
Integrations**. Only owners (`settings.manage`) can see or change them.

| Group | Integrations |
|---|---|
| Online payments | SSLCommerz, EPS (Sandbox / Live mode) |
| Courier | Steadfast (API key, secret key, webhook token + Notify URL) |
| SMS, email & push | BulkSMSBD, Resend, web push (key pair generated in the dashboard) |
| Ads & analytics | Meta Pixel + Conversions API, TikTok Pixel, Microsoft Clarity |
| Customer sign-in | Google OAuth client ID |
| AI assistant | Claude (Anthropic) API key and model |

The catalog lives in `packages/shared/src/integrations.ts`. To add a provider: add it there, read its values through
`config/env.ts` getters (`integrationSetting("KEY")`), and register required credentials in `providers/selection.ts`.

## How it works

- **Precedence:** a value saved in the dashboard wins over the environment variable of the same name. Removing it in the
  dashboard falls back to the environment variable. Existing stores keep working with their `docker/.env` values
  unchanged.
- **Storage:** table `IntegrationSetting`, one row per key, value sealed with AES-256-GCM bound to its key name
  (`lib/secret-box.ts`). Key: `INTEGRATIONS_ENCRYPTION_KEY`, else derived from `JWT_ACCESS_SECRET`. If that secret
  changes, saved values can't be opened. They're ignored, and the dashboard shows "Needs re-entry".
- **Secrets never leave the API.** The view returns the source (dashboard / server / none) and the last four characters.
  Audit log entries (`settings.integrations_update`) record key names only.
- **Applied without a restart.** Values are kept decrypted in memory (`config/integration-overrides.ts`), reloaded after
  every save and every 60 s. Pixel, Google and push ids reach the storefront through the public settings
  (`integrationIds`), and the storefront cache is revalidated on save (needs `REVALIDATE_SECRET`, otherwise it updates
  within 5 minutes).
- **Guards:**
  - Live payment mode can only be saved on a `NODE_ENV=production` store, and is ignored anywhere else.
  - A credential that an explicitly selected provider (`SMS_PROVIDER=…` etc.) needs in production can't be removed.
  - The demo-mirror sanitiser deletes every `IntegrationSetting` row.

## What stays in the server environment

These are infrastructure, which a store needs before it can read its own database:

- `DATABASE_URL` and `REDIS_URL`
- the JWT secrets and `INTEGRATIONS_ENCRYPTION_KEY`
- the origins
- `INSTALL_ID`, `STORE_THEME` and `REVALIDATE_SECRET`
- provider kill-switches (`*_PROVIDER`, `PAYMENT_GATEWAYS`)
