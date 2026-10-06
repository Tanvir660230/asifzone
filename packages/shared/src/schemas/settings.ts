import { isValidTimeZone } from "../metrics/business-time";
import { SUPPORTED_CURRENCIES, isSupportedCurrency } from "../engines/money";
import { z } from "zod";
import { nullableEmail, nullableString, nullableUrl } from "./common";

/** A number input left blank (or one this page disabled, like defaultTaxRate while tax is off) comes
 * through react-hook-form's `valueAsNumber` as NaN, not "" or undefined — treat it as "not provided"
 * rather than letting it fail z.number() and silently block the whole form submission. Unlike
 * `nullableNumber`, blank here means "leave the DB default alone" (undefined), not "set to null" —
 * these columns are NOT NULL with defaults, not nullable. */
function undefinedIfBlank(value: unknown) {
  if (value === "" || value === null) return undefined;
  if (typeof value === "number" && Number.isNaN(value)) return undefined;
  return value;
}

function optionalNonNegativeNumber(max?: number) {
  const base = max !== undefined ? z.number().min(0).max(max) : z.number().min(0);
  return z.preprocess(undefinedIfBlank, base.optional());
}

export const updateSettingsSchema = z.object({
  storeName: z.string().min(1).max(120).optional(),
  tagline: nullableString(200),
  logoUrl: nullableUrl(),
  logoOnDarkUrl: nullableUrl(),
  faviconUrl: nullableUrl(),
  // ISO 4217 code the money engine represents exactly (SUPPORTED_CURRENCIES). Locked once orders exist (Phase 6, P6-4);
  // validity is enforced here so an unsupported code can never become the implied currency of every amount (Phase 7 D-8).
  currency: z
    .string()
    .refine(isSupportedCurrency, { message: `Unsupported currency — use one of: ${SUPPORTED_CURRENCIES.join(", ")}` })
    .optional(),
  // IANA timezone (e.g. "Asia/Dhaka") — the store's business day for metrics and reports (docs/METRICS_REGISTRY.md §1).
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, "Unknown timezone")
    .optional(),
  contactEmail: nullableEmail(),
  contactPhone: nullableString(32),
  shippingFeeDhaka: optionalNonNegativeNumber(),
  shippingFeeOutsideDhaka: optionalNonNegativeNumber(),
  courierReturnFeeDhaka: optionalNonNegativeNumber(),
  courierReturnFeeOutsideDhaka: optionalNonNegativeNumber(),
  taxEnabled: z.boolean().optional(),
  defaultTaxRate: z.preprocess(
    (v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? null : v),
    z.number().min(0).max(100).nullable().optional(),
  ),
  /** D10: shipping carries VAT (inclusive, at the store rate). Stored in the TaxSetting authority, not StoreSetting. */
  shippingTaxable: z.boolean().optional(),
  rewardPointsPerCurrency: optionalNonNegativeNumber(),
  whatsappMessage: nullableString(500),
  whatsappLabel: z.string().min(1).max(40).optional(),
  callEnabled: z.boolean().optional(),
  callLabel: z.string().min(1).max(40).optional(),
  liveChatEnabled: z.boolean().optional(),
  liveChatLabel: z.string().min(1).max(40).optional(),
  tawkPropertyId: nullableString(60),
  tawkWidgetId: nullableString(60),
  paymentMethodsImageUrl: nullableUrl(),
  codEnabled: z.boolean().optional(),
  onlinePaymentEnabled: z.boolean().optional(),
  epsPaymentEnabled: z.boolean().optional(),
  googleSiteVerification: nullableString(255),
  // Phase 12 identity (D-2). Optional; blank clears.
  legalName: nullableString(200),
  addressLine: nullableString(300),
  addressCity: nullableString(100),
  addressRegion: nullableString(100),
  addressPostalCode: nullableString(20),
  addressCountry: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : v),
    z.string().regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code (e.g. BD)").nullable().optional(),
  ),
  legalJurisdiction: nullableString(120),
  supportHours: nullableString(200),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
