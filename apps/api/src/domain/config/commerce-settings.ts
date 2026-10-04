/**
 * Commerce settings — the ONE resolution path for the store's currency and timezone (docs/PHASE_7_AUDIT.md).
 *
 *   StoreSetting.currency / .timezone (storage owner; schema column defaults are the only system defaults)
 *     → settings.service getSettings() (the Redis-cached row; updateSettings is the only writer)
 *       → getCommerceSettings() / getCurrency() / getTimezone()   ← every consumer
 *
 * No consumer reads `getSettings().currency/.timezone` itself or re-declares a default (guard test). The currency is locked
 * once orders exist (P6-4) and validated on write (Phase 7 D-8), so what this returns is the recorded currency of every
 * money snapshot. The timezone only interprets UTC instants into business days; it never changes a stored fact.
 */
import { getSettings } from "../../modules/settings/settings.service";

export interface CommerceSettings {
  /** ISO 4217 code of all store money (engine-supported). */
  currency: string;
  /** IANA timezone of the store's business day. */
  timezone: string;
}

export async function getCommerceSettings(): Promise<CommerceSettings> {
  const s = await getSettings();
  return { currency: s.currency, timezone: s.timezone };
}

export async function getCurrency(): Promise<string> {
  return (await getCommerceSettings()).currency;
}

export async function getTimezone(): Promise<string> {
  return (await getCommerceSettings()).timezone;
}
