import {
  INTEGRATIONS,
  INTEGRATION_FIELDS,
  PUBLIC_INTEGRATION_KEYS,
  type IntegrationsView,
  type PublicIntegrationIds,
  type UpdateIntegrationsInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { integrationOverride, replaceIntegrationOverrides } from "../../config/integration-overrides";
import { AppError } from "../../lib/app-error";
import { openIntegrationValue, sealIntegrationValue } from "../../lib/secret-box";
import { captureError } from "../../lib/observability/error-capture";
import { credentialsNewlyMissing, generatePushKeyPair } from "../../providers/registry";
import { invalidateSettingsCache } from "./settings.service";

/**
 * Settings › Integrations — third-party credentials and ids an OWNER manages from the dashboard (catalog and precedence:
 * packages/shared integrations.ts). Values are sealed at rest (lib/secret-box.ts) and held decrypted in memory
 * (config/integration-overrides.ts), where config/env.ts reads them. Secrets never leave this module in a response: the
 * view carries only their source and last four characters.
 */

const REFRESH_INTERVAL_MS = 60_000;
/** Rows that would not open (encryption key changed, or a database copied from another store) — reported, never used. */
let unreadableKeys = new Set<string>();

export async function loadIntegrationOverrides(): Promise<void> {
  const rows = await prisma.integrationSetting.findMany();
  const values = new Map<string, string>();
  const unreadable = new Set<string>();
  for (const row of rows) {
    if (!INTEGRATION_FIELDS.has(row.key)) continue;
    const value = openIntegrationValue(row.key, row.value);
    if (value === null) unreadable.add(row.key);
    else values.set(row.key, value);
  }
  replaceIntegrationOverrides(values);
  unreadableKeys = unreadable;
}

let refreshTimer: NodeJS.Timeout | null = null;

/** Keeps a second API process (or one that missed a save) in step with the database. Started by server.ts. */
export function startIntegrationRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    loadIntegrationOverrides().catch((err) => captureError(err, { msg: "[integrations] refresh failed:" }));
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref();
}

const hint = (value: string) => (value.length > 8 ? `…${value.slice(-4)}` : "…");

export function getIntegrationsView(): IntegrationsView {
  return {
    integrations: INTEGRATIONS.map((integration) => {
      const fields = integration.fields.map((field) => {
        const dashboard = integrationOverride(field.key);
        const server = process.env[field.key]?.trim() || undefined;
        const effective = dashboard ?? server;
        return {
          key: field.key,
          source: dashboard !== undefined ? ("dashboard" as const) : server !== undefined ? ("server" as const) : ("none" as const),
          value: field.kind === "secret" ? null : (effective ?? null),
          hint: field.kind === "secret" && effective ? hint(effective) : null,
          ...(unreadableKeys.has(field.key) ? { unreadable: true } : {}),
        };
      });
      const configured = integration.fields.every((field, i) => !field.required || fields[i]!.source !== "none");
      return { id: integration.id, configured, fields };
    }),
    steadfastWebhookUrl: `${env.apiOrigin.replace(/\/+$/, "")}/api/courier/steadfast/webhook?token=`,
  };
}

/** Ids the storefront's browser code needs, as saved in the dashboard (the web app falls back to its own environment). */
export function publicIntegrationIds(): PublicIntegrationIds {
  return Object.fromEntries(
    Object.entries(PUBLIC_INTEGRATION_KEYS).map(([field, key]) => [field, integrationOverride(key) ?? ""]),
  ) as PublicIntegrationIds;
}

const labelOf = (key: string) => {
  const integration = INTEGRATIONS.find((i) => i.fields.some((f) => f.key === key));
  return `${integration?.name ?? "Integration"} ${INTEGRATION_FIELDS.get(key)?.label.toLowerCase() ?? key}`;
};

/** Refuses a change that would break this deployment: a live payment mode outside production, or removing a credential the
 * server's explicit provider selection (SMS_PROVIDER etc.) requires in production. */
function assertAllowed(changes: Map<string, string | null>): void {
  if (env.nodeEnv !== "production") {
    if (changes.get("SSLCOMMERZ_IS_LIVE") === "true" || changes.get("EPS_SANDBOX") === "false") {
      throw AppError.badRequest("Live payment mode can only be switched on in the production store — use Sandbox here.");
    }
  }
  const current = (key: string) => integrationOverride(key) ?? process.env[key] ?? "";
  const next = (key: string) => (changes.has(key) ? changes.get(key) || process.env[key] || "" : current(key));
  const missing = credentialsNewlyMissing((key) => Boolean(current(key)), (key) => Boolean(next(key)));
  if (missing.length) {
    throw AppError.badRequest(`This store's server configuration requires ${missing.map(labelOf).join(", ")} — enter a new value instead of removing it.`);
  }
}

/** Saves dashboard values (`null` or blank removes one, so the environment variable applies again). Returns the changed keys. */
export async function updateIntegrations(input: UpdateIntegrationsInput, adminId: string | null): Promise<string[]> {
  const changes = new Map(Object.entries(input.values).map(([key, value]) => [key, value ? value : null] as const));
  assertAllowed(changes);

  await prisma.$transaction(
    [...changes].map(([key, value]) =>
      value === null
        ? prisma.integrationSetting.deleteMany({ where: { key } })
        : prisma.integrationSetting.upsert({
            where: { key },
            create: { key, value: sealIntegrationValue(key, value), updatedById: adminId },
            update: { value: sealIntegrationValue(key, value), updatedById: adminId },
          }),
    ),
  );
  await loadIntegrationOverrides();
  // Pixel / sign-in / push ids are served with the public settings — the storefront's cached copy must not outlive the save.
  await invalidateSettingsCache();
  return [...changes.keys()];
}

/** A fresh VAPID pair for web push. Existing browser subscriptions were made with the old public key and stop receiving. */
export async function generateWebPushKeys(adminId: string | null): Promise<string[]> {
  const { publicKey, privateKey } = generatePushKeyPair();
  return updateIntegrations({ values: { WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey } }, adminId);
}
