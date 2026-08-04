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

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
