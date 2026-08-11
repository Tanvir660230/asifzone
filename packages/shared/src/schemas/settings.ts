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
  currency: z.string().min(1).max(8).optional(),
  contactEmail: nullableEmail(),
  contactPhone: nullableString(32),
  shippingFeeDhaka: optionalNonNegativeNumber(),
  shippingFeeOutsideDhaka: optionalNonNegativeNumber(),
  taxEnabled: z.boolean().optional(),
  defaultTaxRate: z.preprocess(
    (v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? null : v),
    z.number().min(0).max(100).nullable().optional(),
  ),
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
  googleSiteVerification: nullableString(255),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
