/**
 * The one money representation used by every pricing engine (docs/PRICING_INVARIANTS.md §1): an integer number of
 * minor units (paisa for BDT) plus an explicit currency. Engines never mix Decimal, string and float — conversion to and
 * from database/DTO values happens only at the boundary, through `fromMajor` / `toMajor`.
 */
export interface Money {
  /** Integer minor units (e.g. 12_345 = ৳123.45). */
  amount: number;
  currency: string;
}

/** Minor-unit digits per currency. Unknown currencies default to 2 (the ISO 4217 norm). */
const MINOR_DIGITS: Record<string, number> = { BDT: 2, USD: 2, EUR: 2, GBP: 2, INR: 2, JPY: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** Minor units in one major unit (100 for BDT). */
export function minorPerMajor(currency: string): number {
  return 10 ** minorDigits(currency);
}

function assertInteger(amount: number): void {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Money amount must be a safe integer of minor units, got ${amount}`);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency} (no implicit conversion)`);
}

export function money(amount: number, currency: string): Money {
  assertInteger(amount);
  return { amount, currency };
}

export function zero(currency: string): Money {
  return { amount: 0, currency };
}

/**
 * Boundary conversion from a stored/decimal value (Prisma Decimal, "123.45", 123.45) to minor units. Parses the decimal
 * text rather than multiplying a float, so "0.1" is exactly 10 paisa. Rounds half-up beyond the currency's digits.
 */
export function fromMajor(value: number | string | { toString(): string } | null | undefined, currency: string): Money {
  if (value === null || value === undefined) return zero(currency);
  const text = typeof value === "number" ? value.toFixed(10) : String(value).trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error(`Not a decimal amount: ${text}`);
  const [, sign, intPart = "", fracPart = ""] = match;
  const digits = minorDigits(currency);
  const kept = (fracPart + "0".repeat(digits)).slice(0, digits);
  const nextDigit = fracPart.length > digits ? Number(fracPart[digits]) : 0;
  let amount = Number(intPart || "0") * 10 ** digits + Number(kept || "0");
  if (nextDigit >= 5) amount += 1;
  return money(sign ? -amount : amount, currency);
}

/** Boundary conversion to a major-unit number for DTOs and Prisma Decimal columns. */
export function toMajor(m: Money): number {
  return m.amount / minorPerMajor(m.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) throw new RangeError("Quantity must be an integer");
  return money(a.amount * quantity, a.currency);
}

export function sum(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function min(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount <= b.amount ? a : b;
}

export function max(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount >= b.amount ? a : b;
}

/** Never below zero — the "no negative price" guard every engine applies to prices and discounted amounts. */
export function clampNonNegative(m: Money): Money {
  return m.amount < 0 ? zero(m.currency) : m;
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amount - b.amount;
}
