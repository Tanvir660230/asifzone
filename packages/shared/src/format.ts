/**
 * Display formatting driven by the store's configuration (docs/PHASE_7_AUDIT.md) — the ONE place that turns an amount or an
 * instant into text. Callers pass the store currency / timezone (API: domain/config/commerce-settings; web: StoreConfig).
 * Nothing here knows a particular currency or timezone.
 */

/** Number/date presentation locale. Locale is not a configurable concept yet (TARGET §7 `CommerceSettings.locale` is
 * future work), so it is declared once here instead of in every formatter. */
export const DISPLAY_LOCALE = "en-BD";

/** "৳1,500" / "$1,500.25": the currency's own narrow symbol, up to 2 decimals, no forced trailing zeros. */
export function formatMoney(amountMajor: number, currency: string): string {
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountMajor);
}

/** The currency's narrow symbol alone ("৳", "$") — for input labels such as "Amount (৳)". */
export function currencySymbol(currency: string): string {
  const part = new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency, currencyDisplay: "narrowSymbol" })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? currency;
}

/** "1 Oct 2026, 00:30" — an instant as wall-clock time in the store timezone. */
export function formatDateTime(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(instant));
}

/** "1 Oct 2026" — the store-timezone calendar date of an instant (its business date). */
export function formatDate(instant: Date | string, timeZone: string, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(new Date(instant));
}

/** "18:30" — the store-timezone clock time of an instant. */
export function formatTime(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(instant));
}
