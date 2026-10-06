import { publicRuntimeConfig } from "@/lib/runtime-config";

/**
 * Admin feature flags (P1.10) — the typed catalog of switchable admin features. Values come from the installation's
 * runtime configuration (`ADMIN_FEATURES`, @clothing-brand/shared runtime-config.ts), never from the build: one image, any
 * installation. The navigation manifest names a flag on a node (`featureFlag`) to hide a module that isn't switched on.
 *
 * `ADMIN_FEATURES` is a comma list: `id` switches a flag on, `-id` switches a default-on flag off. Unknown ids are ignored.
 */
export const FEATURE_FLAGS = {
  "ai-assistant": { defaultEnabled: true, description: "The AI assistant page (billed AI generation)." },
  "messages-inbox": { defaultEnabled: false, description: "Unified customer messages inbox (future module)." },
  "finance-ledger": { defaultEnabled: false, description: "Finance ledger and payouts beyond payments (future module)." },
} as const satisfies Record<string, { defaultEnabled: boolean; description: string }>;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureFlag(value: string): value is FeatureFlag {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, value);
}

/** The enabled flag set for a raw `ADMIN_FEATURES` value — pure, so tests (and the server) can call it with any string. */
export function parseFeatureFlags(raw: string): ReadonlySet<FeatureFlag> {
  const enabled = new Set<FeatureFlag>((Object.keys(FEATURE_FLAGS) as FeatureFlag[]).filter((f) => FEATURE_FLAGS[f].defaultEnabled));
  for (const token of raw.split(",").map((t) => t.trim()).filter(Boolean)) {
    const off = token.startsWith("-");
    const id = off ? token.slice(1) : token;
    if (!isFeatureFlag(id)) continue;
    if (off) enabled.delete(id);
    else enabled.add(id);
  }
  return enabled;
}

/** Whether a flag is on for this installation. Read at call time (runtime config may arrive after module load). */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return parseFeatureFlags(publicRuntimeConfig().adminFeatures ?? "").has(flag);
}
