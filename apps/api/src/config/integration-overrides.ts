/**
 * Dashboard-managed integration values (Settings › Integrations), decrypted and held in memory so config/env.ts can read
 * them synchronously. Filled at startup and after every save by modules/settings/integrations.service.ts; refreshed
 * periodically so a second API process converges too. Deliberately dependency-free — config/env.ts imports it.
 */

let overrides: ReadonlyMap<string, string> = new Map();

/** The dashboard value for an integration key (an environment variable name), if one is saved. */
export function integrationOverride(key: string): string | undefined {
  return overrides.get(key);
}

export function replaceIntegrationOverrides(next: ReadonlyMap<string, string>): void {
  overrides = new Map(next);
}

/** Environment variable first overridden by the dashboard: the effective configuration value for `key`. */
export function integrationSetting(key: string, fallback = ""): string {
  return overrides.get(key) ?? process.env[key] ?? fallback;
}

/** Tests only: layers `values` over the current overrides (as a dashboard save would) and returns a function that restores
 * the previous ones. An empty string means "set but empty" — it hides the environment variable. */
export function overrideIntegrationsForTests(values: Record<string, string>): () => void {
  const previous = overrides;
  overrides = new Map([...previous, ...Object.entries(values)]);
  return () => {
    overrides = previous;
  };
}
