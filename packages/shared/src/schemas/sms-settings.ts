import { z } from "zod";
import { normalizeBdPhone, nullableString, PHONE_REGEX } from "./common";

/** Comma-separated local "01XXXXXXXXX" numbers — same shape PHONE_REGEX validates elsewhere, just
 * allowing more than one since a shop owner may want alerts on multiple phones. Each number is
 * normalized (spaces/dashes/+880 stripped) before the regex check, same as every other phone
 * field, so e.g. "+8801999454749" doesn't get rejected or silently fail to send later. */
const adminAlertPhonesField = z
  .string()
  .max(200)
  .transform((v) =>
    v
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .map(normalizeBdPhone)
      .join(","),
  )
  .refine(
    (v) => v === "" || v.split(",").every((p) => PHONE_REGEX.test(p)),
    "Enter valid Bangladeshi phone numbers, separated by commas",
  )
  .optional();

export const updateSmsSettingsSchema = z.object({
  adminAlertPhones: adminAlertPhonesField,
  adminOrderAlertEnabled: z.boolean().optional(),
  customerOrderPlacedEnabled: z.boolean().optional(),
  customerOrderConfirmedEnabled: z.boolean().optional(),
  customerOrderShippedEnabled: z.boolean().optional(),
  customerOrderDeliveredEnabled: z.boolean().optional(),
  customerOrderCancelledEnabled: z.boolean().optional(),
  // Blank/null means "use the built-in default template" — see DEFAULT_CUSTOMER_SMS_TEMPLATES.
  customerOrderPlacedTemplate: nullableString(320),
  customerOrderConfirmedTemplate: nullableString(320),
  customerOrderShippedTemplate: nullableString(320),
  customerOrderDeliveredTemplate: nullableString(320),
  customerOrderCancelledTemplate: nullableString(320),
});

export type UpdateSmsSettingsInput = z.infer<typeof updateSmsSettingsSchema>;
