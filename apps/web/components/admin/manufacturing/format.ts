import { storeCurrencySymbol } from "@/lib/format";

/** A cost per stock unit (e.g. ৳0.0125 per cm) — up to 4 decimals, since material units are small. */
export function formatUnitCost(value: number, unit: string | null): string {
  return `${storeCurrencySymbol()}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} / ${unit ?? "unit"}`;
}
