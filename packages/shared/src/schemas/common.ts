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

/** Catches well-formed-but-not-real numbers — the kind typed to get through a required field
 * without giving a real one (01111111111, 01712345678, 01700000000, 01717171717, ...). Doesn't
 * catch every fake number (a fake-but-random one is indistinguishable from a real one by shape
 * alone), just the common dummy patterns; treat it as a signal to review, not proof either way. */
export function looksLikeFakePhone(raw: string): boolean {
  const normalized = normalizeBdPhone(raw);
  if (!PHONE_REGEX.test(normalized)) return false;
  const suffix = normalized.slice(3); // digits after the "01X" prefix — 8 of them

  // All one digit (01711111111) or a short cycle repeated across the whole suffix (01712121212).
  if (/^(\d{1,2})\1{3,}$/.test(suffix)) return true;

  // Strictly ascending or descending run (01712345678, 01787654321).
  const digits = suffix.split("").map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  return ascending || descending;
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
