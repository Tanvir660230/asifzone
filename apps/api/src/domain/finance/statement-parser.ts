/**
 * Statement CSV parsing (Financial Core Phase 2, docs/FINANCE_PHASE_2.md §5) — pure, no database. A bank's CSV is read
 * through a COLUMN MAPPING (header names or 1-based positions) and a few options, never by assuming one bank's layout.
 *
 * Every row gets a dedupe key: its external id when the bank gives one, else a hash of its content plus how many identical
 * rows came before it in the same file. Re-importing the same rows (the same file, or an overlapping export) yields the
 * same keys, so the importer finds them instead of adding them; two genuinely identical rows in one statement stay two.
 */
import { createHash } from "node:crypto";
import { fromMajor, type StatementDateFormat } from "@clothing-brand/shared";
import { CsvParseError, parseCsv, unguardCell } from "../../lib/csv";

export interface StatementColumnMapping {
  date: string;
  valueDate?: string;
  description?: string;
  reference?: string;
  debit?: string;
  credit?: string;
  amount?: string;
  balance?: string;
  externalId?: string;
}

export interface StatementOptions {
  dateFormat: StatementDateFormat;
  amountConvention: "POSITIVE_IS_MONEY_IN" | "POSITIVE_IS_MONEY_OUT";
  hasHeader: boolean;
  skipRows: number;
}

export interface ParsedStatementRow {
  /** The CSV line the row came from. */
  line: number;
  transactionDate: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  /** Minor units, bank convention: debit = money out, credit = money in; exactly one is positive. */
  debit: number;
  credit: number;
  balance: number | null;
  externalId: string | null;
  dedupeKey: string;
}

export interface StatementRowError {
  line: number;
  message: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");

/** A statement date in the given format → "YYYY-MM-DD", or null when it isn't a real date in that format. */
export function parseStatementDate(raw: string, format: StatementDateFormat): string | null {
  const v = raw.trim();
  let y: number, m: number, d: number;
  const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : NaN);
  const parts = v.split(/[\s/.-]+/);
  switch (format) {
    case "YYYY-MM-DD":
      [y, m, d] = [num(parts[0]), num(parts[1]), num(parts[2])];
      break;
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
    case "DD.MM.YYYY":
      [d, m, y] = [num(parts[0]), num(parts[1]), num(parts[2])];
      break;
    case "MM/DD/YYYY":
      [m, d, y] = [num(parts[0]), num(parts[1]), num(parts[2])];
      break;
    case "DD-MMM-YYYY":
    case "DD MMM YYYY":
      [d, m, y] = [num(parts[0]), MONTHS[(parts[1] ?? "").toLowerCase()] ?? NaN, num(parts[2])];
      break;
  }
  if (parts.length < 3 || ![y, m, d].every(Number.isInteger)) return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** "1,234.50", "৳ 1,234.50", "(500.00)", "-500", "500.00 Dr", "BDT 20" → signed major-unit string; "" → null. Throws on junk. */
export function parseStatementAmount(raw: string): string | null {
  let v = unguardCell(raw).trim();
  if (!v || v === "-") return null;
  let negative = false;
  const suffix = /\s*(dr|cr)\.?$/i.exec(v);
  if (suffix) {
    negative = suffix[1]!.toLowerCase() === "dr";
    v = v.slice(0, suffix.index).trim();
  }
  if (/^\(.*\)$/.test(v)) {
    negative = !negative;
    v = v.slice(1, -1).trim();
  }
  // Any currency symbol or a short alphabetic currency code/abbreviation around the number ("$ 20", "20 EUR", "Rs. 20") —
  // the account's currency comes from the books, never from the statement text.
  v = v.replace(/^(\p{Sc}\s*|[a-z]{2,4}\.\s*|[a-z]{2,4}\s+)/iu, "").replace(/(\s*\p{Sc}|\s+[a-z]{2,4}\.?)$/iu, "");
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1).trim();
  } else if (v.startsWith("+")) v = v.slice(1).trim();
  v = v.replace(/,/g, "").replace(/\s/g, "");
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`"${raw.trim()}" isn't an amount`);
  if (/^0+(\.0+)?$/.test(v)) return "0";
  return negative ? `-${v}` : v;
}

function toMinorSigned(major: string, currency: string): number {
  const negative = major.startsWith("-");
  const minor = fromMajor(negative ? major.slice(1) : major, currency).amount;
  return negative ? -minor : minor;
}

function resolveColumns(mapping: StatementColumnMapping, header: string[] | null): { index: Partial<Record<keyof StatementColumnMapping, number>>; problems: string[] } {
  const index: Partial<Record<keyof StatementColumnMapping, number>> = {};
  const problems: string[] = [];
  const normalized = header?.map((h) => unguardCell(h).trim().toLowerCase());
  for (const [field, name] of Object.entries(mapping) as Array<[keyof StatementColumnMapping, string | undefined]>) {
    if (!name) continue;
    if (normalized) {
      const i = normalized.indexOf(name.trim().toLowerCase());
      if (i < 0) problems.push(`Column "${name}" (${field}) isn't in the header`);
      else index[field] = i;
    } else {
      const n = Number(name);
      if (!Number.isInteger(n) || n < 1) problems.push(`Without a header row, ${field} must be a column number (1, 2, …), not "${name}"`);
      else index[field] = n - 1;
    }
  }
  return { index, problems };
}

export function rowContentHash(r: Pick<ParsedStatementRow, "transactionDate" | "debit" | "credit" | "reference" | "description" | "balance">): string {
  return createHash("sha256")
    .update([r.transactionDate, r.debit, r.credit, r.reference ?? "", r.description.toLowerCase(), r.balance ?? ""].join("|"))
    .digest("hex")
    .slice(0, 40);
}

export function parseStatement(csv: string, mapping: StatementColumnMapping, options: StatementOptions, currency: string): { header: string[] | null; rows: ParsedStatementRow[]; errors: StatementRowError[] } {
  let records;
  try {
    records = parseCsv(csv);
  } catch (err) {
    if (err instanceof CsvParseError) return { header: null, rows: [], errors: [{ line: err.line, message: err.message }] };
    throw err;
  }
  records = records.slice(options.skipRows);
  const headerRecord = options.hasHeader ? records.shift() : undefined;
  const header = headerRecord ? headerRecord.cells : null;
  const { index, problems } = resolveColumns(mapping, header);
  if (problems.length) return { header, rows: [], errors: problems.map((message) => ({ line: headerRecord?.line ?? 1, message })) };

  const cell = (cells: string[], field: keyof StatementColumnMapping) => (index[field] === undefined ? "" : unguardCell(cells[index[field]!] ?? "").trim());
  const rows: ParsedStatementRow[] = [];
  const errors: StatementRowError[] = [];
  const seen = new Map<string, number>();

  for (const rec of records) {
    const c = rec.cells;
    const dateRaw = cell(c, "date");
    const amountCells = [cell(c, "amount"), cell(c, "debit"), cell(c, "credit")];
    // Spacer, totals or footer text: no amount anywhere and nothing that reads as a date. A dated row without an amount is
    // reported below, never skipped silently.
    if (amountCells.every((v) => !v) && !parseStatementDate(dateRaw, options.dateFormat)) continue;
    try {
      const transactionDate = parseStatementDate(dateRaw, options.dateFormat);
      if (!transactionDate) throw new Error(`"${dateRaw}" isn't a ${options.dateFormat} date`);
      const valueRaw = cell(c, "valueDate");
      const valueDate = valueRaw ? parseStatementDate(valueRaw, options.dateFormat) : null;
      if (valueRaw && !valueDate) throw new Error(`Value date "${valueRaw}" isn't a ${options.dateFormat} date`);
      let debit = 0;
      let credit = 0;
      if (mapping.amount) {
        const a = parseStatementAmount(cell(c, "amount"));
        const signed = a === null ? 0 : toMinorSigned(a, currency);
        const moneyIn = options.amountConvention === "POSITIVE_IS_MONEY_IN" ? signed : -signed;
        if (moneyIn > 0) credit = moneyIn;
        else debit = -moneyIn;
      } else {
        const d = parseStatementAmount(cell(c, "debit"));
        const k = parseStatementAmount(cell(c, "credit"));
        // A debit column holds money out; a sign there is decoration ("-500" and "500" both mean 500 out).
        debit = d === null ? 0 : Math.abs(toMinorSigned(d, currency));
        credit = k === null ? 0 : Math.abs(toMinorSigned(k, currency));
      }
      if (debit > 0 && credit > 0) throw new Error("The row has both a debit and a credit");
      if (debit === 0 && credit === 0) throw new Error("The row has no amount");
      const balanceRaw = parseStatementAmount(cell(c, "balance"));
      const description = cell(c, "description") || cell(c, "reference") || "(no description)";
      const base = {
        line: rec.line,
        transactionDate,
        valueDate,
        description: description.slice(0, 300),
        reference: cell(c, "reference").slice(0, 120) || null,
        debit,
        credit,
        balance: balanceRaw === null ? null : toMinorSigned(balanceRaw, currency),
        externalId: cell(c, "externalId").slice(0, 120) || null,
      };
      let dedupeKey: string;
      if (base.externalId) dedupeKey = `ext:${base.externalId}`;
      else {
        const hash = rowContentHash(base);
        const n = seen.get(hash) ?? 0;
        seen.set(hash, n + 1);
        dedupeKey = `row:${hash}:${n}`;
      }
      rows.push({ ...base, dedupeKey });
    } catch (err) {
      errors.push({ line: rec.line, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { header, rows, errors };
}
