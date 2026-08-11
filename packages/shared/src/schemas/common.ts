import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase, alphanumeric, hyphen-separated");

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** HTML forms submit blank optional fields as "" (or NaN for numbers) rather than omitting them — these normalize that to `null` so "cleared" is explicit and distinct from "field not sent" in a PATCH. */
export function blankToNull(value: unknown) {
  if (value === "") return null;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  // react-hook-form's `valueAsDate` reads an empty date input as `new Date("")` (Invalid Date),
  // not null/undefined — normalize that the same way as any other "field left blank" case.
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  return value;
}

export function nullableString(max = 500) {
  return z.preprocess(blankToNull, z.string().max(max).nullable().optional());
}

export function nullableUrl() {
  return z.preprocess(blankToNull, z.string().url().nullable().optional());
}

export function nullableCuid() {
  return z.preprocess(blankToNull, z.string().cuid().nullable().optional());
}

export function nullableNumber() {
  return z.preprocess(blankToNull, z.number().positive().nullable().optional());
}

export function nullableEmail() {
  return z.preprocess(blankToNull, z.string().email().nullable().optional());
}

export function nullableDate() {
  return z.preprocess(blankToNull, z.coerce.date().nullable().optional());
}

export const PHONE_REGEX = /^01[3-9]\d{8}$/;

/** Folds the ways a customer actually types a BD mobile number — spaces/dashes, a "+880"/"880"/
 * "00880" country code, or a missing leading 0 — down to the one canonical "01XXXXXXXXX" form
 * everything else (SMS sending, order-tracking lookup, courier booking) compares against. Without
 * this, e.g. "+8801999454749" gets stored verbatim and BulkSMSBD silently rejects it later. */
export function normalizeBdPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = digits.slice(3);
  if (!digits.startsWith("0")) digits = `0${digits}`;
  return digits;
}

export function bdPhoneSchema(message = "Enter a valid Bangladeshi phone number") {
  return z.preprocess(
    (v) => (typeof v === "string" ? normalizeBdPhone(v) : v),
    z.string().regex(PHONE_REGEX, message),
  );
}

/** Same as bdPhoneSchema, but blank/omitted stays null instead of failing validation — for
 * optional profile fields like the customer's own account phone. */
export function nullableBdPhone() {
  return z.preprocess(
    (v) => {
      const cleaned = blankToNull(v);
      return typeof cleaned === "string" ? normalizeBdPhone(cleaned) : cleaned;
    },
    z.string().regex(PHONE_REGEX, "Enter a valid Bangladeshi phone number").nullable().optional(),
  );
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
