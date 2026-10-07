/**
 * Boundary conversions for the Financial Core: Decimal(18,2) columns ↔ integer minor units (the engines' `Money`
 * convention), and @db.Date columns ↔ business dates ("YYYY-MM-DD"). Nothing else in finance converts either.
 */
import { Prisma } from "@prisma/client";
import { fromMajor, minorDigits } from "@clothing-brand/shared";
import { AppError } from "../../lib/app-error";

/** Decimal / number / string major units → integer minor units of `currency`. */
export function toMinor(value: Prisma.Decimal | number | string | null | undefined, currency: string): number {
  return fromMajor(value === null || value === undefined ? 0 : value.toString(), currency).amount;
}

/** Integer minor units → an exact decimal string for a Decimal column (no float arithmetic). */
export function toDecimal(minor: number, currency: string): Prisma.Decimal {
  const digits = minorDigits(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
  const text = digits === 0 ? `${sign}${abs}` : `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
  return new Prisma.Decimal(text);
}

/** Integer minor units → a major-unit number for DTOs. */
export function toMajorNumber(minor: number, currency: string): number {
  return minor / 10 ** minorDigits(currency);
}

/** A business date → the Date Prisma stores in a @db.Date column (UTC midnight of that calendar date). */
export function dateColumn(businessDate: string): Date {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

/** A @db.Date column value → its business date. */
export function businessDateOf(column: Date): string {
  return column.toISOString().slice(0, 10);
}

/** Finance error with a stable `details.code` (the API error envelope used elsewhere, e.g. QUOTE_CHANGED). */
export function financeError(status: 400 | 404 | 409, code: string, message: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError(status, message, { code, ...extra });
}

/**
 * A violation raised by a finance database trigger (FINANCE_INVARIANT / FINANCE_AUDIT_REQUIRED) means a writer skipped a
 * rule the services check first — a bug, never a user error. It surfaces as 409 with the database's own message rather
 * than an opaque 500, so it is visible and the transaction is already rolled back.
 */
export function mapFinanceDbError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err);
  const match = /(FINANCE_INVARIANT|FINANCE_AUDIT_REQUIRED): ([^\n"]+)/.exec(message);
  if (match?.[1] && match[2]) return financeError(409, match[1], match[2].trim());
  return err;
}
