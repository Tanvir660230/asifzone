/**
 * The store's commerce configuration in the web app (Phase 7, docs/PHASE_7_AUDIT.md): currency and timezone come from the
 * store settings the root layout already fetches (`StoreConfig` sets them before any child renders), never from code, the
 * browser or an env var. Formatters (lib/format.ts) read them; nothing else should.
 */
export interface StoreConfigValue {
  /** ISO 4217 code of all store money. */
  currency: string;
  /** IANA timezone of the store's business day. */
  timezone: string;
}

let current: StoreConfigValue | null = null;

/** Called by <StoreConfig> during render, before its children — idempotent (every render passes the same store values). */
export function setStoreConfig(value: StoreConfigValue): void {
  current = value;
}

/** The configured store currency/timezone. Throws if read outside <StoreConfig> — a silent default here would reintroduce
 * a hard-coded currency or timezone. Server components that format money pass the amount's own currency instead. */
export function getStoreConfig(): StoreConfigValue {
  if (!current) throw new Error("Store configuration isn't loaded — render inside <StoreConfig> or pass the currency explicitly");
  return current;
}
